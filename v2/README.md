# CosyWorld runtime operations

The current player surface is the card game. Start with the
[source map](../docs/current-game.md) and [card guide](card-game/README.md).
Local play uses a browser save. Shared play runs the same rules on the Rust
server inside bounded C QuickJS and records accepted operations in SQLite.

## Run the current game

```sh
npm ci
npm run play:cards
```

The preview listens on `http://127.0.0.1:4177/`. Set
`COSYWORLD_CARD_TEXT_ORIGIN` to a Rust server for dialogue. The full server uses:

```sh
COSYWORLD_PRIMARY_GAME=cards npm run dev
npm run v2:status
```

The full server listens on `http://127.0.0.1:3102/`. The launch script reads local
`.env` and `.env.local` settings. Set `COSYWORLD_PRIMARY_GAME=cards` there too
when a local file supplies that setting. `npm run v2:stop` stops the local server.

## Public identity

- `/health` reports readiness; `/health/live` reports process liveness.
- `/meta.version` identifies the running release.
- `/meta.primary_game` identifies the surface selected for `/`.
- `/meta.card_game` gives the card entry URL, source directory, play modes,
  catalog URLs, and current shared rules version.
- `/meta.metadata_scopes` marks the classic world, worldpack, combat, and
  content-engine fields. Deployment and recovery tools retain these fields.

Both live sites select the card game at `/`. The testing site follows `main`;
Lonely Forest follows a versioned release. See the
[release guide](../docs/release.md) and [Fly operations](../docs/deployment/lonelyforest-fly.md).

## Persistence and compatibility

Use the [shared-world guide](docs/card-table/shared-worlds.md) for claims,
action queues, journals, checkpoints, and versioned rules. Preserve deployment
bundle guards and the existing volume during release. Historical classic
operations remain in the [runtime archive](../docs/archive/classic/v2/README.md).
