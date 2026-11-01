# CosyWorld

> Historical guide for the classic game. Source: `readme.md` at commit
> `451ea91e945178c9255239a3b823ba3ae92e9318`, archived October 26, 2026.
> Read the [current game guide](../../../readme.md).


CosyWorld is a small, strange world played through avatar, item, and location
cards. Carry a lamp, bargain with a moth, travel with a companion, or wake a
badger who would rather be left alone. Residents act by the same rules as the
player. Their wants, belongings, journeys, and disagreements make the story;
generated dialogue gives those events a voice.

Play the shipping game at [lonelyforest.com](https://lonelyforest.com/).
The testing site at [cosyworld.fly.dev](https://cosyworld.fly.dev/) updates
automatically from `main`; Lonely Forest receives deliberate versioned releases.
Its root serves the card table prototype: one browser's deterministic world,
saved in localStorage. The longer-term direction is a shared, persistent world
built from general rules and generators. The existing shared runtime, with a C
rules kernel and Rust HTTP/SSE orchestrator, runs at `/classic`; the table is
not yet connected to that runtime's state, accounts, or rewards.

CosyWorld V2 is the canonical product and runtime. Gameplay, world content,
browser behavior, and deployment work live under `v2/`.

The stable product release is **CosyWorld 1.0**. See the
[`CHANGELOG`](../../../CHANGELOG.md) for its supported product surface and upgrade notes.

## Quick Start

You need:

- Node.js 24 or newer.
- A Rust toolchain with Cargo and a working C compiler.
- Python 3, `screen`, and `lsof` for the local runtime scripts.

Install the JavaScript dependencies, then start the card table:

```sh
npm install
npm run play:cards
```

Open [http://127.0.0.1:4177/](http://127.0.0.1:4177/). Saves stay in that
browser. The rules work locally; generated dialogue needs a configured Rust
text service. Point the lightweight server at it with
`COSYWORLD_CARD_TEXT_ORIGIN`, as described in the
[card table guide](../../../v2/card-game/README.md#local-play). Text-service failures
remain visible and can be retried without spending a turn.

To run the shared-world runtime instead:

```sh
npm run dev
```

The first run builds the Rust service, starts it in a detached session, and
opens [http://127.0.0.1:3102](http://127.0.0.1:3102). Local play does not
require a wallet or external AI credentials.

Check the running service, inspect its logs, or stop it with:

```sh
npm run v2:status
./v2/mvp.sh logs
npm run v2:stop
```

The full local gate also builds the browser-facing Rust model for WebAssembly.
Install that target once, then run the gate:

```sh
rustup target add wasm32-unknown-unknown
npm run check:local
```

## Repository Map

- `v2/`: canonical CosyWorld runtime, content, smoke tests, and deployment docs.
- `v2/core-c/`: deterministic C kernel for world rules and event emission.
- `v2/orchestrator-rust/`: Rust host, browser shell, HTTP routes, SSE, optional
  linked-avatar ownership, AI calls, persistence, moderation, and legacy audit.
- `v2/content/core/`: authored source pack for first-party rooms, actors, items,
  cards, factions, fronts, clocks, jobs, and access gates.
- `v2/worlds/official/`: official seed-world selection and integrity lock.
- `v2/content/official/`: generated, deterministic bundle consumed by the runtime.
- `v2/scripts/`: content compilers, contract checks, and local smoke tests.
- `infra/`: infrastructure and operational support for deployed services.
- `docs/`, `AI.md`, `ECONOMY.md`, `PRD.md`: product and system notes.

## The Current Card Table

Vale begins in Mirror attic holding an unlit lamp. Light it, discover Black
pond, meet Pip, and find the station and its keeper. Raise one card or a pair
to inspect an offer, then play it. Cast members take their turns after yours.

- Items have real holders and locations. A lamp carried away by Pip leaves
  with him; mentioning it in dialogue does not put it in Vale's hand.
- Entering Mirror attic from Black pond requires a lit, fueled, uncovered lamp
  physically at the pond. A departed carrier removes that route, including
  previously selected travel offers. Discovery preserves the way out of the attic.
- Gifts, trades, requests, company, and conflict use the recorded state and
  the other avatar's interests. An accepted accompany play records shared
  travel; independent journeys stay independent.
- Ringing an uncovered bell twice consecutively at the pond reveals the Forest
  Clearing and its Steam Clock for the next three turns. A ring at the pond
  refreshes an active window; after it closes, two rings reopen it. Entry needs
  the ringing bell physically at the pond, whether carried or on the ground.
  The return card also disappears when the bells fall silent. Ringing the
  Steam Clock's own bell in the clearing reopens the return for three turns,
  even when the hand bell was left behind. Badger sleeps there; a greeting wakes him.
  His speech remains grumpy even after the immediate irritation eases.
- Dialogue follows completed actions. Quiet departures let the moving cast
  speak for themselves; direct exchanges and a Stay without departures retain
  their relevant speakers. History and scene export retain the actual lines.
- Reload preserves inventory, quest steps, route discoveries and remaining
  ringing turns, moods, and
  validated dialogue. Slow or failed text generation does not roll back an
  action, invent a response, or require another world turn to retry.

Dynamic routes arise from items and places together: knowing a destination
does not keep its entrance open when its light or sound has gone away.

Quest steps currently advance immediately, and completing a program earns a
level and supplies another program. This can override an avatar's natural
contentment: Pip can receive a well-fueled lamp and immediately pursue oil.
Avatar downtime, novelty-based XP, optional daily quests, a real-time Paris
train, and a daily Steam Clock prophecy are **proposals**, not implemented
features. Their scope and open decisions are in the
[product direction](PRD.md#card-table-direction-under-review).

The shipping card engine is `v2/card-game/world.mjs`, with quests, resident
motives, life, memory, and pack rules in the modules beside it. Its opening
quests and item rules form the current game. Future work builds on this engine;
the [generated-world backlog](../backlog/generated-world-core.md) retains
the ideas explored by the retired standalone engine.

## Shared Runtime at `/classic`

The official service is one canonical, persistent world. Today one V2
orchestrator process owns its authoritative state, SQLite event/action
persistence, browser projections, and SSE replay. Capacity processes and
deployment regions are replaceable entrances to that same world, never
player-facing copies. Production stays single-writer until the fenced ownership,
durable journal, routing, and failover gates in
[`v2/docs/canonical-world.md`](../../../v2/docs/canonical-world.md) are implemented.
`COSYWORLD_PROCESS_ID` names the replaceable capacity process. The old
`COSYWORLD_V2_SHARD_ID` setting and `/meta.deployment.shard_id` remain matching
compatibility aliases; neither value is world identity.

The official bundle mounts CosyWorld Core with The Lantern Keeper, The Holy
Land, Ruby High: First Bell, and the Lonely Forest character pack. Versioned
SRD references and the executable SRD5 rules profile provide the shared rules
layer. Each expansion owns its rooms, actors, items, cards, and assets; explicit
composition packs connect expansion resources to Core. Players can create
avatars, chat through server-authored avatar lines, use moderated room speech,
move, collect and trade items, earn and spend Orbs, report players, and inspect
card presentations.

Generated avatar personas are first-person streams of consciousness: desires,
preferences, dislikes, and social instincts grounded in the character's actual
state. Persona generation and repair reject invented possessions, imaginary or
invisible companions, pets, familiars, and numeric fallback identities.

The certified **Think / Pass** action defers the avatar's turn and rolls a rare
DC 18 Intelligence check. Only a success queues an asynchronous interior
thought. A Rest that actually recovers fatigue, practice, travel, or an item
rolls the same DC against Wisdom; only a success queues an asynchronous dream.
Failed checks are ordinary deterministic game events and make no AI request.

## Production Runtime

The root `Dockerfile` builds the V2 Rust orchestrator. `fly.toml` runs it on the
production profile with `/data` mounted for generated assets and SQLite state.
The `cosyworld` Fly app is the development publication target. An ordinary
merge to `main` runs the deployment gates and deploys only that primary app.
Release tags or explicit workflow selections can also deploy Lonely Forest;
those are separate publication decisions. Deployment keeps volume-space,
worldpack-compatibility, backup, and readiness checks in place.

Production profile rejects dev shortcuts. It requires:

- Optional protected avatar-ownership feed URL and bearer token when the
  linked-avatar adapter is configured.
- SQLite event store.
- Moderation token.
- A unique `COSYWORLD_PROCESS_ID` per deployed process. If the legacy
  `COSYWORLD_V2_SHARD_ID` alias is also set, it must have the same value. Never
  use either label as world, player, room, or save identity.
- Signed wallet sessions for linked-avatar discovery and recovery.

Historical Box, pack, and item-materialization rows remain read-only audit
evidence. The runtime has no burn, reveal, collection, or materialization player
endpoint.

## Useful Commands

```sh
npm run v2:start
npm run v2:status
npm run v2:smoke
npm run v2:check
npm run v2:stop
npm run v2:worldpack
npm run v2:kernel
npm run v2:rust:test
npm run v2:syntax
npm test
node v2/scripts/smoke-card-pond-access.mjs
node v2/scripts/smoke-card-dialogue-recovery.mjs
node v2/scripts/check-card-awakening.mjs
```

The three card-table browser checks use local fixture dialogue and exercise
desktop and phone layouts without calling a paid text model.

## More Detail

- [V2 runtime guide](v2/README.md)
- [Card table rules, dialogue, and local play](../../../v2/card-game/README.md)
- [Product requirements](PRD.md)
- [Economy and NFT model](ECONOMY.md)
- [AI model and provider notes](AI.md)
- [License](../../../LICENSE)
