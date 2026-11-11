# SIP-01 Search

A static, serverless search client for the [SIP-01](https://github.com/SIP-01/SIP-01) draft decentralized web index on Nostr (kind 39697).

The browser app queries Nostr relays, groups verified observations by document identity (`d`) and ranks documents by distinct indexer pubkeys. It verifies each event's normalized URL identity (`d`) and content hash (`x`) using protocol logic shared with [sip-01-core](https://github.com/SIP-01/sip-01-core).

## Verification and result completeness

Each queried relay reports its own EOSE and completeness state. The CLI/MCP tool:
- verifies and deduplicates received observations;
- interprets NIP-67 `finish`, `more` and `auth` hints;
- paginates explicit `more` hints using an `until` cursor, with a 10-page safety limit;
- reports timeout, CLOSED, connection errors, AUTH requirements, unknown completeness and safety-limit stops as incomplete.

The top-level `complete` field is true only when every selected relay reports NIP-67 `finish`. A plain EOSE means completeness is unknown. `pending: 0` means the selected requests have settled; it does not mean the result set is exhaustive. Completeness applies only to the listed relays, not the global decentralized index.

The direct web page has its own client-side result lifecycle. Do not assume its `complete` field has the same guarantees as the CLI/MCP tool unless it explicitly reports the new per-relay completeness metadata.

## Protocol checks

- `d` is recomputed from the normalized `u` URL.
- `x`, when present, is checked against the published title and description.
- `v` must be `"1"`.
- Multiple relay copies of the same event are deduplicated by event id.
- Distinct author pubkeys are counted per `d`; this is an agreement signal, not proof of truth or Sybil resistance.

SIP-01 is a draft, optional protocol profile, not an accepted NIP. The canonical specification and current status are at https://github.com/SIP-01/SIP-01.

## Run locally

No build step is needed for the static web client:

~~~bash
npx serve .
~~~

The CLI/MCP tool requires Node 22 or newer:

~~~bash
node agent/sip01-search.mjs "privacy tools" --limit 40
node agent/sip01-search.mjs --mcp
~~~

## Tests

~~~bash
node test/vectors.mjs
node --check agent/sip01-search.mjs
~~~

## Agent skill

The portable Agent Skill package is [skills/sip01-search/SKILL.md](skills/sip01-search/SKILL.md). Install it into a directory named `sip01-search` so the directory matches the frontmatter name:

~~~bash
git clone https://github.com/SIP-01/sip-01-search <skills-root>/sip01-search
~~~

The skill explains JSON, direct relay REQ, CLI/MCP, verification and honest completeness reporting.

For tools, models and other agents, use [ORBSTR](https://github.com/SIP-01/Orbstr) (companion capability profile, kind 39698). This repository searches web documents (kind 39697).

## Configure relays

Edit the `RELAYS` array near the bottom of `index.html`. Mark SIP-01-aware relays with `sip01: true`. Operator queries are relay-specific; only send SIP-01 operators to relays that advertise support through NIP-11 metadata.

## Deploy

Import this repository in Vercel as a static project (framework: Other, no build command).

## License

MIT — see [LICENSE](LICENSE).
