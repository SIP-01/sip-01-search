# SIP-01 Search — agent skill

Use this when a task needs to find web documents in the SIP-01 decentralized index (Nostr kind `39697`). No API key, no login, no backend.

## Search

Two ways in.

**1. Machine-readable page** (browser-capable agents): open

    https://sip-01-search.vercel.app/?q=<query>&format=json

The page runs the search and outputs a JSON document:

    { version, query, complete, pending, relays, generatedAt,
      documents, observations, dropped,
      results: [ { url, title, description?, d, x?, xIndexers?, indexers, indexerPubkeys, source?, observedAt } ] }

- `relays` = `[{ url, name?, sip01, delivered }]` — the relays queried; `name` and `sip01` (operator support) come from each relay's NIP-11 document; `delivered` says whether it actually served events (a relay can be up but empty).
- `indexerPubkeys` = hex pubkeys of the distinct indexers (encode as `npub` per NIP-19 for display). Distinct pubkeys = independent observations.
- `complete: false` means relays are still streaming — re-read until true.
- `indexers` = distinct pubkeys that published a verified observation for the document (the rank signal).
- `x` + `xIndexers` = the content hash most indexers agree on, and how many agree on it.
- `observedAt` = `created_at` of the newest observation, unix seconds.

**2. Direct relay query** (recommended for Nostr-capable agents): `REQ` kind `39697` with a NIP-50 `search` filter:

    ["REQ", "<sub>", { "kinds": [39697], "search": "<query>", "limit": 40 }]

Relays this client uses (all NIP-50):

- `wss://sip-relay-3.uncaged-sip.workers.dev`
- `wss://sip-relay-2.sip-booster-relay.workers.dev`
- `wss://sip-relay-4.sip-relay-4.workers.dev`
- `wss://relay.ditto.pub`

Relay capabilities come from each relay's NIP-11 document (`supported_nips`, `uncaged_index`); the client checks it before sending operators.

SIP-01-aware relays (the three UNCAGED nodes) also accept operators: `site:`, `domain:`, `url:`, `inurl:`, `title:`, `topic:`, `type:`, `platform:`, `category:`, `network:`, `country:`, `mime:`, `filetype:`, `source:`, `lang:`, `before:`, `after:`, `distinct:domain` — each with a negated `-op:` form. Send operators only to SIP-01-aware relays; generic NIP-50 relays treat them as plain terms.

## Verify before you trust

1. Recompute `d` = `widx:` + first 32 hex chars of `sha256(normalizeIndexUrl(u))` — drop mismatches.
2. When `x` is present, check `x` = `sha256(title + "\n" + description)`.
3. Group by `d`; distinct pubkeys = independent observations. Never treat a single relay, indexer, or engine as authoritative.

Reference implementations: `sip-01-core` (`src/protocol/webIndex.ts`), `sip-01-skill` (normalization/hashing toolkit).

## Do not

- Treat a kind `39697` observation as a service listing. For tools, models, and other agents, use ORBSTR (kind `39698`).
- Trust `d`/`x` values you have not verified.
- Expect plain HTTP: `format=json` needs a JavaScript-capable reader (browser automation).

## Related

- Protocol: https://github.com/SIP-01/SIP-01
- Core: https://github.com/SIP-01/sip-01-core
- ORBSTR — directory of AI agents and tools: https://github.com/SIP-01/Orbstr
