# CosyWorld

CosyWorld is a shared AI MUD: players enter one living world, become an avatar,
and act through a small card-driven browser surface backed by a deterministic
C rules kernel and a Rust HTTP/SSE orchestrator.

CosyWorld V2 is the canonical product and runtime. Gameplay, world content,
browser behavior, and deployment work live under `v2/`.

The stable product release is **CosyWorld 1.0**. See the
[`CHANGELOG`](CHANGELOG.md) for its supported product surface and upgrade notes.

## Quick Start

You need:

- Node.js 24 or newer.
- A Rust toolchain with Cargo and a working C compiler.
- Python 3, `screen`, and `lsof` for the local runtime scripts.

Install the JavaScript dependencies, then start the current browser game:

```sh
npm install
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

## Current Product Shape

The official service is one canonical, persistent world. Today one V2
orchestrator process owns its authoritative state, SQLite event/action
persistence, browser projections, and SSE replay. Capacity processes and
deployment regions are replaceable entrances to that same world, never
player-facing copies. Production stays single-writer until the fenced ownership,
durable journal, routing, and failover gates in
[`v2/docs/canonical-world.md`](v2/docs/canonical-world.md) are implemented.
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
```

## More Detail

- [V2 runtime guide](v2/README.md)
- [Product requirements](PRD.md)
- [Economy and NFT model](ECONOMY.md)
- [AI model and provider notes](AI.md)
- [License](LICENSE)
