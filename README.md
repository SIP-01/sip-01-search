# SIP-01 Search

A static, serverless search client for the [SIP-01](https://github.com/SIP-01/SIP-01) Decentralized Search Index Protocol (Nostr kind `39697`).

The page connects straight from the browser to Nostr relays, sends a NIP-50 `search` filter, groups results by document (`d` tag), and ranks by how many independent indexers published the same document.

Every event is parsed and verified with the canonical protocol logic — a byte-compatible consumer port of [`sip-01-core`](https://github.com/SIP-01/sip-01-core) `src/protocol/webIndex.ts`:

- `d` is recomputed from the normalized `u` URL and must match — spoofed observations are dropped (spec §18 step 2)
- `x` (content hash) is verified against the published title/description when present; ≥2 indexers reporting the same hash show a `content ✓` badge
- `v` must be `"1"`; URLs are normalized per spec §7 (tracking params stripped, host lowercased, …) before hashing

The spec §13 test vectors are pinned by `node test/vectors.mjs` (no dependencies).

Performance: relay connections are persistent and reused across searches, events are deduplicated by id across relays, and rendering is batched to one frame. Searches are shareable — the query lives in the URL (`?q=…`).

Relay capabilities are discovered from each relay's NIP-11 document (`supported_nips`, `uncaged_index`) — operator queries only go to relays that advertise SIP-01 support, and the status line reports how many relays actually served events.

- Live: https://sip-01-search.vercel.app
- Protocol: https://github.com/SIP-01/SIP-01
- Core library: https://github.com/SIP-01/sip-01-core

## Run locally

No build step. Serve the folder with any static server:

```
npx serve .
```

## Test

```
node test/vectors.mjs
```

## Agent use

- Machine-readable results: append `&format=json` to any search URL — the page runs the search and emits `{ version, query, complete, pending, relays, generatedAt, documents, observations, dropped, results[] }` (each result carries `indexerPubkeys` for independence checks). Needs a JavaScript-capable reader; re-read while `complete` is false.
- [`agent/SKILL.md`](agent/SKILL.md) — drop-in instructions for AI agents (JSON view, direct relay `REQ`, verification rules).
- [`llms.txt`](llms.txt) — site description for LLM/agent crawlers.
- For tools, models, and other agents (kind `39698`), use [ORBSTR](https://github.com/SIP-01/Orbstr) — this client covers web documents (kind `39697`) only.

## Configure relays

Edit the `RELAYS` array near the bottom of `index.html`. Mark SIP-01-aware relays with `sip01: true` — operator queries (`site:`, `title:`, `topic:`, …) are only sent to those, because generic NIP-50 relays treat operators as plain search terms.

## Deploy

Import the repo in Vercel as a static project (framework: Other, no build command).

## License

MIT — see [LICENSE](LICENSE).
