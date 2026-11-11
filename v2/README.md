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
npm run dev
npm run v2:status
```

The full server listens on `http://127.0.0.1:3102/`. The launch script reads local
`.env` and `.env.local` settings. `npm run v2:stop` stops the local server.

## Public identity

- `/health` reports readiness; `/health/live` reports process liveness.
- `/meta.version` identifies the running release.
- `/meta.primary_game` is `card-table`, the surface served at `/`.
- `/meta.card_game` gives the card entry URL, source directory, play modes,
  catalog URLs, and current shared rules version.
- `/meta.deployment`, `/meta.persistence`, `/meta.features` and `/meta.ai`
  report the profile, event store health and size, and dialogue provider. The
  hosted server boots card-only, so `/meta` has no classic world, worldpack or
  combat fields.

Both live sites select the card game at `/`. The testing site follows `main`;
Lonely Forest follows a versioned release. See the
[release guide](../docs/release.md) and [Fly operations](../docs/deployment/lonelyforest-fly.md).

AI provider error diagnostics read at most 64 KiB, including streamed replies.
The gateway keeps a short summary and redacts echoed image data or bearer tokens.

## Persistence and compatibility

Use the [shared-world guide](docs/card-table/shared-worlds.md) for claims,
action queues, journals, checkpoints, and versioned rules. Preserve deployment
bundle guards and the existing volume during release.
