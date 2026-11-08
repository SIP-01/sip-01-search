# SIP-01 Search

A static, serverless search client for the [SIP-01](https://github.com/SIP-01/SIP-01) Decentralized Search Index Protocol (Nostr kind `39697`).

The page connects straight from the browser to Nostr relays, sends a NIP-50 `search` filter, groups results by document (`d` tag), and ranks by how many independent indexers published the same document.

- Live: https://sip-01-search.vercel.app
- Protocol: https://github.com/SIP-01/SIP-01
- Core library: https://github.com/SIP-01/sip-01-core

## Run locally

No build step. Serve the folder with any static server:

```
npx serve .
```

## Configure relays

Edit the `RELAYS` array near the bottom of `index.html`.

## Deploy

Import the repo in Vercel as a static project (framework: Other, no build command).
