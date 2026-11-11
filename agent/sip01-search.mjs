#!/usr/bin/env node
/**
 * SIP-01 Search — agent tool. Node 22+ (global WebSocket) plus pinned nostr-tools@2.26.0 for NIP-01 signature verification.
 *
 *   node agent/sip01-search.mjs "query" [--limit N]   one search, JSON on stdout
 *   node agent/sip01-search.mjs --mcp                 MCP stdio server (tool: search)
 *
 * One source of truth: SIP-01 protocol logic (normalization, hashing, parse, d/x verification)
 * and the relay list are extracted from ../index.html — the same code the web
 * client runs. NIP-01 event ids/signatures are verified with nostr-tools before SIP-01 d/x checks; results are deduplicated and ranked by distinct indexers.
 */
import { readFileSync } from 'node:fs';
import { verifyEvent } from 'nostr-tools/pure';
import { classifyEoseHints, nextPaginationCursor } from './completeness.mjs';

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

async function queryRelayPage(url, filter, page) {
  const subId = 'sip01-agent-' + String(page);
  return new Promise(resolve => {
    let ws;
    let settled = false;
    const result = { events: [], eose: false, hints: [], completeness: 'pending', error: null };
    const finish = (completeness, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      result.completeness = completeness;
      result.error = error ? String(error).slice(0, 200) : null;
      try { ws?.close(); } catch {}
      resolve(result);
    };
    const timer = setTimeout(() => finish('timeout', 'timeout waiting for EOSE'), RELAY_TIMEOUT_MS);
    try { ws = new WebSocket(url); }
    catch { finish('error', 'connection could not be created'); return; }
    ws.onopen = () => {
      try { ws.send(JSON.stringify(['REQ', subId, filter])); }
      catch (error) { finish('error', error?.message || 'request send failed'); }
    };
    ws.onmessage = (m) => {
      let d;
      try { d = JSON.parse(m.data); } catch { return; }
      if (!Array.isArray(d) || !d.length) return;
      if (d[0] === 'EVENT' && d[1] === subId && d[2]) {
        result.events.push(d[2]);
      } else if (d[0] === 'EOSE' && d[1] === subId) {
        result.eose = true;
        result.hints = Array.isArray(d[2]) ? d[2].map(String) : [];
        const state = classifyEoseHints(result.hints);
        if (state === 'auth-required') finish('auth-required', 'relay indicates more data may require AUTH');
        else if (state === 'more-available') finish('more-available');
        else if (state === 'complete') finish('complete');
        else finish('legacy', 'no definitive NIP-67 hint; use bounded legacy pagination');
      } else if (d[0] === 'CLOSED' && d[1] === subId) {
        finish('closed', d[2] || 'subscription closed before completion');
      } else if (d[0] === 'NOTICE' && d[1]) {
        result.error = String(d[1]).slice(0, 200);
      }
    };
    ws.onerror = () => finish('error', 'websocket error');
    ws.onclose = () => {
      if (!settled) finish('closed', 'websocket closed before EOSE');
    };
  });
}

async function queryRelay(relay, filter) {
  const events = [];
  const seen = new Set();
  let pageFilter = { ...filter };
  let completion = 'unknown';
  let error = null;
  let eose = false;
  let eoseHints = [];
  let pages = 0;
  const maxPages = 10;

  for (let page = 0; page < maxPages; page++) {
    const response = await queryRelayPage(relay.url, pageFilter, page);
    pages += 1;
    eose = response.eose;
    eoseHints = response.hints;
    const fresh = [];
    for (const event of response.events) {
      if (event?.id && !seen.has(event.id)) {
        seen.add(event.id);
        fresh.push(event);
        events.push(event);
      }
    }

    if (response.completeness === 'complete') {
      completion = 'complete';
      error = null;
      break;
    }
    if (response.completeness === 'more-available' || response.completeness === 'legacy') {
      const cursor = nextPaginationCursor(response.events, fresh, pageFilter.until);
      if (!cursor.ok) {
        const legacy = response.completeness === 'legacy';
        completion = legacy ? 'unknown' : 'partial';
        error = legacy
          ? 'legacy EOSE pagination stopped without a safe next cursor; completeness remains unknown'
          : 'NIP-67 more hint received but pagination could not make safe progress';
        break;
      }
      pageFilter = { ...filter, until: cursor.until };
      completion = response.completeness === 'legacy' ? 'legacy-pagination' : 'more-available';
      continue;
    }

    completion = response.completeness;
    error = response.error;
    break;
  }

  if (['more-available', 'legacy-pagination'].includes(completion) && pages >= maxPages) {
    completion = 'partial';
    error = 'pagination stopped at the 10-page safety limit; additional stored events may remain';
  }
  relay.events = events;
  relay.eose = eose;
  relay.eoseHints = eoseHints;
  relay.completeness = completion;
  relay.pages = pages;
  relay.error = error;
  relay.delivered = events.length > 0;
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
      let signatureOk = false;
      try { signatureOk = verifyEvent(ev); } catch {}
      if (!signatureOk) { dropped++; continue; }
      let obs = null;
      try { obs = P.parseIndexEvent(ev); } catch {}
      if (!obs) { dropped++; continue; }
      let observationOk = false;
      try { observationOk = await P.verifyObservation(obs); } catch {}
      if (!observationOk) { dropped++; continue; }
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

  const queriedRelayStates = active.map(r => ({
    url: r.url,
    name: r.name,
    sip01: r.sip01,
    delivered: r.delivered,
    eose: !!r.eose,
    eoseHints: r.eoseHints || [],
    completeness: r.completeness || 'unknown',
    pages: r.pages || 0,
    eventCount: r.events.length,
    error: r.error,
  }));
  const complete = queriedRelayStates.length > 0 &&
    queriedRelayStates.every(r => r.completeness === 'complete');
  const partial = queriedRelayStates.some(r =>
    ['partial', 'timeout', 'closed', 'error', 'auth-required', 'more-available'].includes(r.completeness)
  );

  return {
    version: 1,
    query: q,
    complete,
    partial,
    completeness: complete ? 'complete' : partial ? 'partial' : 'unknown',
    completenessScope: 'only the relays listed below; this does not prove global index completeness',
    cryptographicSignatureVerification: 'nostr-tools@2.26.0 verifyEvent (NIP-01 id + BIP-340 signature)',
    pending: 0,
    queriedRelays: active.length,
    operatorsRestrictedToSIP01AwareRelays: opQuery,
    relays: queriedRelayStates,
    generatedAt: Math.floor(Date.now() / 1000),
    documents: docs.size,
    observations,
    dropped,
    results,
  };
}

const TOOL = {
  name: 'search',
  description: 'Search the SIP-01 decentralized web index (Nostr kind 39697): web documents observed by independent indexers, verified and ranked by how many distinct indexers agree. Tracks per-relay NIP-67 completeness, paginates explicit more hints (maximum 10 pages) and reports unknown/partial results honestly. Supports NIP-50 operators (site:, title:, topic:, type:, lang:, before:, after:, …) on SIP-01-aware relays.',
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
