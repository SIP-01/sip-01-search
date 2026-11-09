#!/usr/bin/env node
/**
 * SIP-01 Search — agent tool. Zero dependencies, Node 22+ (global WebSocket).
 *
 *   node agent/sip01-search.mjs "query" [--limit N]   one search, JSON on stdout
 *   node agent/sip01-search.mjs --mcp                 MCP stdio server (tool: search)
 *
 * One source of truth: the protocol logic (normalization, hashing, parse, verify)
 * and the relay list are extracted from ../index.html — the same code the web
 * client runs. Results are verified, deduplicated, and ranked by distinct indexers.
 */
import { readFileSync } from 'node:fs';

if (typeof WebSocket === 'undefined') {
  console.error('sip01-search: Node 22+ required (global WebSocket).');
  process.exit(1);
}

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const block = html.match(/\/\* === SIP-01 protocol[\s\S]*?\/\* === end SIP-01 protocol === \*\//);
if (!block) { console.error('sip01-search: protocol block not found in index.html'); process.exit(1); }
const P = new Function(`${block[0]}
return { WEB_INDEX_KIND, parseIndexEvent, verifyObservation };`)();

const relaysSrc = html.match(/const RELAYS = (\[[\s\S]*?\]);/);
const RELAYS = new Function(`return ${relaysSrc[1]};`)();
const opReSrc = html.match(/const OPERATOR_RE = (\/[^\n]+?\/);/);
const OPERATOR_RE = new Function(`return ${opReSrc[1]};`)();

const DEFAULT_LIMIT = 40;
const RELAY_TIMEOUT_MS = 15000;
const clampLimit = (n) => Math.min(Math.max(Number.isFinite(n) ? Math.trunc(n) : DEFAULT_LIMIT, 1), 200);

// NIP-11 discovery — operator queries only go to relays that advertise SIP-01 support.
async function relayInfo(relay) {
  let sip01 = !!relay.sip01, name;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(relay.url.replace(/^ws/, 'http'), { headers: { Accept: 'application/nostr+json' }, signal: ctrl.signal });
    clearTimeout(timer);
    const info = await res.json();
    if (typeof info.name === 'string') name = info.name;
    if (info.uncaged_index && typeof info.uncaged_index.sip01 === 'boolean') sip01 = info.uncaged_index.sip01;
  } catch {}
  return { url: relay.url, sip01, name, delivered: false, error: null, events: [] };
}

function queryRelay(relay, filter) {
  return new Promise(resolve => {
    let ws;
    try { ws = new WebSocket(relay.url); } catch (e) { relay.error = 'connect failed'; return resolve(); }
    const timer = setTimeout(() => { relay.error = relay.error || 'timeout waiting for EOSE'; try { ws.close(); } catch {} resolve(); }, RELAY_TIMEOUT_MS);
    const done = () => { clearTimeout(timer); try { ws.close(); } catch {} resolve(); };
    ws.onopen = () => ws.send(JSON.stringify(['REQ', 'sip01-agent', filter]));
    ws.onmessage = (m) => {
      let d; try { d = JSON.parse(m.data); } catch { return; }
      if (d[0] === 'EVENT') { relay.delivered = true; relay.events.push(d[2]); }
      else if (d[0] === 'EOSE') done();
      else if (d[0] === 'CLOSED') { if (d[2]) relay.error = String(d[2]).slice(0, 160); done(); }
      else if (d[0] === 'NOTICE' && d[1]) relay.error = String(d[1]).slice(0, 160);
    };
    ws.onerror = () => { relay.error = relay.error || 'connection error'; done(); };
  });
}

export async function search(query, limit = DEFAULT_LIMIT) {
  const q = String(query || '').trim();
  const opQuery = OPERATOR_RE.test(q);
  const relays = await Promise.all(RELAYS.map(relayInfo));
  const active = relays.filter(r => !opQuery || r.sip01);
  const filter = { kinds: [P.WEB_INDEX_KIND], limit: clampLimit(limit) };
  if (q) filter.search = q;
  await Promise.all(active.map(r => queryRelay(r, filter)));

  const docs = new Map();
  const seen = new Set();
  let observations = 0, dropped = 0;
  for (const r of active) {
    for (const ev of r.events) {
      if (!ev || !ev.id || seen.has(ev.id)) continue;
      seen.add(ev.id);
      let obs = null;
      try { obs = P.parseIndexEvent(ev); } catch {}
      if (!obs) { dropped++; continue; }
      let ok = false;
      try { ok = await P.verifyObservation(obs); } catch {}
      if (!ok) { dropped++; continue; }
      observations++;
      let entry = docs.get(obs.d);
      if (!entry) { entry = { d: obs.d, url: obs.url, title: obs.title, description: obs.description, source: obs.source, latest: 0, indexers: new Set(), xAgree: new Map() }; docs.set(obs.d, entry); }
      entry.indexers.add(obs.indexer);
      if (obs.contentHash) {
        let set = entry.xAgree.get(obs.contentHash);
        if (!set) { set = new Set(); entry.xAgree.set(obs.contentHash, set); }
        set.add(obs.indexer);
      }
      if (obs.observedAt >= entry.latest) {
        entry.latest = obs.observedAt;
        entry.title = obs.title;
        entry.description = obs.description;
        if (obs.source) entry.source = obs.source;
      }
    }
  }

  const results = [...docs.values()]
    .sort((a, b) => b.indexers.size - a.indexers.size || b.latest - a.latest)
    .map(it => {
      let x, xIndexers = 0;
      for (const [hash, set] of it.xAgree) if (set.size > xIndexers) { x = hash; xIndexers = set.size; }
      const out = { url: it.url, title: it.title, d: it.d, indexers: it.indexers.size, indexerPubkeys: [...it.indexers], observedAt: it.latest };
      if (it.description) out.description = it.description;
      if (it.source) out.source = it.source;
      if (x) { out.x = x; out.xIndexers = xIndexers; }
      return out;
    });

  return {
    version: 1,
    query: q,
    complete: true,
    pending: 0,
    relays: active.map(r => ({ url: r.url, name: r.name, sip01: r.sip01, delivered: r.delivered, error: r.error })),
    generatedAt: Math.floor(Date.now() / 1000),
    documents: docs.size,
    observations,
    dropped,
    results,
  };
}

const TOOL = {
  name: 'search',
  description: 'Search the SIP-01 decentralized web index (Nostr kind 39697): web documents observed by independent indexers, verified and ranked by how many distinct indexers agree. Supports NIP-50 operators (site:, title:, topic:, type:, lang:, before:, after:, …) on SIP-01-aware relays.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query. Operators like site:example.com are supported.' },
      limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Max observations per relay (default 40).' },
    },
    required: ['query'],
  },
};

function mcpServe() {
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.method === 'initialize') {
        send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'sip01-search', version: '1.0.0' } } });
      } else if (msg.method === 'tools/list') {
        send({ jsonrpc: '2.0', id: msg.id, result: { tools: [TOOL] } });
      } else if (msg.method === 'tools/call') {
        const args = (msg.params && msg.params.arguments) || {};
        try {
          const result = await search(args.query, args.limit);
          send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } });
        } catch (e) {
          send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'search failed: ' + ((e && e.message) || e) }], isError: true } });
        }
      } else if (msg.id !== undefined && msg.method === 'ping') {
        send({ jsonrpc: '2.0', id: msg.id, result: {} });
      } else if (msg.id !== undefined) {
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found: ' + msg.method } });
      }
    }
  });
}

const argv = process.argv.slice(2);
if (argv.includes('--mcp')) {
  mcpServe();
} else if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
  console.log(`SIP-01 Search — agent tool (zero deps, Node 22+)

  node agent/sip01-search.mjs "query" [--limit N]   one search, JSON on stdout
  node agent/sip01-search.mjs --mcp                 MCP stdio server (tool: search)

Operators (SIP-01-aware relays): site: domain: url: inurl: title: topic: type:
platform: category: network: country: mime: filetype: source: lang: before:
after: distinct:domain — each with a negated -op: form.`);
} else {
  let limit = DEFAULT_LIMIT;
  const li = argv.indexOf('--limit');
  if (li >= 0 && argv[li + 1]) limit = parseInt(argv[li + 1], 10);
  const query = argv.filter((a, i) => !a.startsWith('--') && !(li >= 0 && i === li + 1)).join(' ').trim();
  const result = await search(query, limit);
  console.log(JSON.stringify(result, null, 2));
}
