# CosyWorld

CosyWorld is a small, strange world played through avatar, item, and location
cards. People carry things, make bargains, travel, and pursue their own wishes.
The same card game supports a local browser save and a shared world with friends.

Play at [Lonely Forest](https://lonelyforest.com/). The
[testing site](https://cosyworld.fly.dev/) follows `main`. Lonely Forest receives
versioned releases. Each site's `/meta` reports its running version and selected
game. The package version identifies this checkout.

## Start here

Read the [current source map](docs/current-game.md) before changing gameplay.
The shipping model, browser, and cast live in `v2/card-game/`. The Rust service
runs the same model in a bounded C interpreter for shared games and stores the
accepted history. See the [shared-world guide](v2/docs/card-table/shared-worlds.md).

The [classic archive](docs/archive/classic/index.md) preserves earlier product,
RPG, worldpack, and character guides. The `/classic` client is retired.

## Local play

Use Node.js 24 or later. Install the dependencies, then open the card preview:

```sh
npm ci
npm run play:cards
```

Open `http://127.0.0.1:4177/`. Generated dialogue uses a Rust service selected by
`COSYWORLD_CARD_TEXT_ORIGIN`. For the full server, install Rust, the C compiler,
Python 3, `screen`, and `lsof`, then run:

```sh
COSYWORLD_PRIMARY_GAME=cards npm run dev
```

The full server opens `http://127.0.0.1:3102/`. Use `npm run v2:status` to inspect
it, `./v2/mvp.sh logs` for logs, and `npm run v2:stop` to stop it.

## Guides

- [Card game](v2/card-game/README.md): play, presentation, catalogs, and local setup.
- [Product](PRD.md): the current player experience.
- [Engineering](ENG.md): rules, persistence, and source ownership.
- [AI and voices](AI.md): dialogue and character sources.
- [Contributing](CLAUDE.md): worktrees, checks, and PRs.
- [Operations](v2/README.md): server configuration and metadata.
- [Release process](docs/release.md): testing and production releases.
- [Documentation index](docs/index.md): current guides and history.
