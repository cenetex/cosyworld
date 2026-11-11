# CosyWorld Discord gateway

The companion bot: it renders CosyWorld into Discord channels it is assigned
to, one webhook per channel, residents answering under their own name and
portrait. See `docs/design/discord-gateway.md` for the design and the security
law (no customer credentials, ever).

## Run

```sh
cd v2/discord-gateway
npm install
DISCORD_TOKEN=... ORCHESTRATOR_URL=http://127.0.0.1:3102 npm start
```

Required env: `DISCORD_TOKEN`. Optional: `ORCHESTRATOR_URL`,
`DISCORD_BINDINGS_FILE`.

## Test

```sh
npm test
```

The core modules (`bindings`, `identity`, `commands`) are injected and tested
without a Discord client or network. `src/index.mjs` is the only file that
imports discord.js.

## Status

Phase 1a: bind (`/setup`), room view (`/who`), unbind, privacy card. Talk
routing needs a server-side narrative endpoint (the browser's `/card-game/text`
expects a same-origin, fully-built scene) and lands in Phase 1b.
