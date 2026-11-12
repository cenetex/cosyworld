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

Required env: `DISCORD_TOKEN`. For Talk: `COSYWORLD_BOT_TOKEN` (the service
token the orchestrator trusts). Optional: `ORCHESTRATOR_URL`,
`DISCORD_BINDINGS_FILE`.

## Test

```sh
npm test
```

The core modules (`bindings`, `identity`, `commands`) are injected and tested
without a Discord client or network. `src/index.mjs` is the only file that
imports discord.js.

## Status

Phase 1a: bind (`/setup`), room view (`/who`), unbind, privacy card.
Phase 1c/1d: `src/talk.mjs` routes a message to the shared `/talk` endpoint
(target resolution, request build, line parsing) — tested with mocks. The
remaining integration is world/avatar resolution (the `/card-game/shared/worlds`
list format) and posting the resident lines as per-message webhooks in
`index.mjs`'s `messageCreate`.
