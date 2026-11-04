<img width="1511" height="799" alt="image" src="https://github.com/user-attachments/assets/d89a913b-8d18-4077-addf-7e5a824585f0" />
*gameplay*

# CosyWorld

CosyWorld is a small, strange world played through avatar, item, and location
cards. People carry things, make bargains, travel, and pursue their own wishes.
The same card game supports a local browser save and a shared world with friends.

Play at [Lonely Forest](https://lonelyforest.com/). The
[testing site](https://cosyworld.fly.dev/) follows `main`. Lonely Forest receives
versioned releases. Each site's `/meta` reports its running version and selected
game. The package version identifies this checkout.

## Summoning characters

CosyWorld summons characters through names and roles. A seed such as
"Antigone, daughter of Oedipus" deliberately draws on the language model's
cultural inheritance: the stories, voices, dispositions, and contradictions
associated with that figure. Keeping the seed sparse leaves room for qualities
we did not prescribe. "Raw" means minimally directed by an authored persona.

Each encounter gives that inherited figure a particular life. Possessions,
journeys, witnessed events, relationships, thoughts, and dreams give this
incarnation its own history. The rules establish what happens in the world;
generated speech and reflection draw on those facts and the character's
inheritance. A name calls the character into the world, and play gives them
something new to live through.

See the [seed-sentence guide](v2/docs/card-table/seed-sentences.md) for the
authored identities and how they enter play.

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
