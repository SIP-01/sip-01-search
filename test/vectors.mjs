// Pins the protocol block inside index.html to the SIP-01 spec §13 test vectors
// and to sip-01-core's parse/verify behavior. No dependencies: node test/vectors.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const block = html.match(/\/\* === SIP-01 protocol[\s\S]*?\/\* === end SIP-01 protocol === \*\//);
if (!block) {
  console.error('FAIL: protocol block markers not found in index.html');
  process.exit(1);
}
const P = new Function(`${block[0]}
return { normalizeIndexUrl, documentId, contentHash, parseIndexEvent, verifyObservation, npubEncode };`)();

let checks = 0;
const eq = (actual, expected, msg) => { assert.equal(actual, expected, msg); checks++; };

// --- §13.1 URL identity vectors ---
const URL_VECTORS = [
  ['https://example.com/', 'https://example.com/', 'widx:0f115db062b7c0dd030b16878c99dea5'],
  ['HTTPS://WWW.Example.Com:443/page/?b=2&utm_source=x&a=1#top', 'https://example.com/page?a=1&b=2', 'widx:f68176b3eb966bd682c3c6eadcc5fe44'],
  ['https://example.com/page', 'https://example.com/page', 'widx:3641c5f2274c5471278ab5bf1df6d185'],
  ['https://github.com/NostrDanish/Crwalstr', 'https://github.com/NostrDanish/Crwalstr', 'widx:cdfd4df8c01d609fc9cdf943afa80197'],
];
for (const [input, normalized, d] of URL_VECTORS) {
  eq(P.normalizeIndexUrl(input), normalized, `normalize ${input}`);
  eq(await P.documentId(P.normalizeIndexUrl(input)), d, `d ${input}`);
}

// --- §13.2 content identity vectors ---
eq(await P.contentHash('Example'), 'e1762f14d9924e37b32f1c81dfd256410af462f5136415c96877efa8c80345d0', 'x Example');
eq(await P.contentHash('Example Page', 'A page about examples.'), '2a5cbdf44513f552fb571d6c6de2ddf16c5452b235cc887980b52898fb38e7c1', 'x Example Page');

// --- NIP-19 display vectors (real pubkeys → npub) ---
eq(P.npubEncode('8b7f13da3ad25e5cf6ef747d53898d798f917b6161a1a181957aa888767aa685'), 'npub13dl38k366f09eah0w3748zvd0x8ez7mpvxs6rqv4025gsan656zsn3d3vd', 'npub UNCAGED node 3');
eq(P.npubEncode('3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d'), 'npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6', 'npub fiatjaf');

// --- normalization edge cases (mirror of sip-01-core unit tests) ---
eq(P.normalizeIndexUrl('HTTPS://WWW.Example.COM/Page'), 'https://example.com/Page');
eq(P.normalizeIndexUrl('https://example.com/page?id=42&utm_source=twitter&utm_medium=social&fbclid=abc&page=2'), 'https://example.com/page?id=42&page=2');
eq(P.normalizeIndexUrl('https://example.com/a#section-2'), 'https://example.com/a');
eq(P.normalizeIndexUrl('https://example.com:443/a'), 'https://example.com/a');
eq(P.normalizeIndexUrl('http://example.com:80/a'), 'http://example.com/a');
eq(P.normalizeIndexUrl('https://example.com:8443/a'), 'https://example.com:8443/a');
eq(P.normalizeIndexUrl('https://example.com/docs/'), 'https://example.com/docs');
eq(P.normalizeIndexUrl('https://example.com/'), 'https://example.com/');
eq(P.normalizeIndexUrl('https://example.com/s?b=2&a=1'), 'https://example.com/s?a=1&b=2');
eq(P.normalizeIndexUrl('https://www.example.com/page/?utm_campaign=x#top'), P.normalizeIndexUrl('https://example.com/page'));
eq(P.normalizeIndexUrl('javascript:alert(1)'), null);
eq(P.normalizeIndexUrl('data:text/html,<script>'), null);
eq(P.normalizeIndexUrl('file:///etc/passwd'), null);
eq(P.normalizeIndexUrl('magnet:?xt=urn:btih:abc'), null);
eq(P.normalizeIndexUrl('not a url'), null);
eq(P.normalizeIndexUrl(''), null);

// --- parse + verify behavior (spec §18 step 2) ---
const mkEvent = async (over = {}) => {
  const url = over.url ?? 'https://example.com/page';
  const title = over.title ?? 'Example Page';
  const description = over.description ?? 'Desc';
  const tags = over.tags ?? [
    ['d', await P.documentId(url)],
    ['u', url],
    ['x', await P.contentHash(title, description)],
    ['v', '1'],
  ];
  return {
    id: 'e'.repeat(64), kind: 39697, pubkey: 'a'.repeat(64), created_at: 1754650000,
    content: over.content ?? JSON.stringify({ title, description }), tags,
  };
};

const ok = await mkEvent();
const obs = P.parseIndexEvent(ok);
assert(obs, 'parse accepts a well-formed event'); checks++;
eq(obs.url, 'https://example.com/page');
eq(obs.title, 'Example Page');
eq(obs.indexer, 'a'.repeat(64));
eq(await P.verifyObservation(obs), true, 'verify accepts a self-consistent observation');

eq(P.parseIndexEvent({ ...ok, kind: 30078 }), null, 'rejects wrong kind');
eq(P.parseIndexEvent(await mkEvent({ tags: [['d', 'widx:' + '0'.repeat(32)], ['u', 'https://example.com/page'], ['v', '999']] })), null, 'rejects unsupported version');
eq(P.parseIndexEvent({ ...ok, content: 'not json' }), null, 'rejects malformed content');
eq(P.parseIndexEvent(await mkEvent({ tags: [['d', 'widx:' + '0'.repeat(32)], ['u', 'javascript:alert(1)'], ['v', '1']] })), null, 'rejects non-http(s) u');
eq(P.parseIndexEvent(await mkEvent({ tags: [['d', 'not-a-widx-id'], ['u', 'https://example.com/page'], ['v', '1']] })), null, 'rejects bad d prefix');
eq(P.parseIndexEvent(await mkEvent({ tags: [['d', 'widx:' + '0'.repeat(32)], ['u', 'https://example.com/' + 'a'.repeat(2100)], ['v', '1']] })), null, 'rejects overlong u');
eq(P.parseIndexEvent(await mkEvent({ content: JSON.stringify({ title: '   ' }) })), null, 'rejects empty title');
eq(await P.verifyObservation({ ...obs, d: 'widx:' + '0'.repeat(32) }), false, 'verify rejects a spoofed d');
eq(await P.verifyObservation({ ...obs, contentHash: '0'.repeat(64) }), false, 'verify rejects a tampered x');

console.log(`✓ ${checks} checks passed — §13 vectors + normalization + parse/verify behavior`);
