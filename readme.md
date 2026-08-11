# CosyWorld

CosyWorld is a shared AI MUD: players enter one living world, become an avatar,
and act through a small card-driven browser surface backed by a deterministic
C rules kernel and a Rust HTTP/SSE orchestrator.

CosyWorld V2 is the canonical product. The older Node service still exists in
this repository as a companion for legacy integrations and experiments, but new
gameplay work should target `v2/`.

## Start Here

Run the current browser game:

```sh
npm run dev
```

Run the local V2 gate:

```sh
npm run check:local
```

Run only the legacy Node companion:

```sh
npm run dev:node
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
- `src/`: legacy Node companion service and inherited social/community tooling.
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

The current public world mounts CosyWorld Core and Ruby High: First Bell as peer
world packs. Ruby owns its school rooms, rules context, cards, faction, and assets;
optional bridge rows connect its resources to Core
when both packs are mounted. Players can create avatars, chat through
server-authored avatar lines, use moderated room speech, move, collect and trade
items, earn and spend Orbs, report players, and inspect card presentations.

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

## Legacy Node Companion

The Node service was the original multi-platform community/agent tool. It still
contains Discord, X, Telegram, AI-provider, media, admin, and migration code that
may remain useful as companion infrastructure. It is not the source of truth for
the CosyWorld V2 game loop.

Use `npm run dev:node` when working on that companion surface. Keep new gameplay
rules, world content, browser MUD behavior, and production deployment changes in
the V2 runtime unless a task explicitly targets legacy integrations.

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

- V2 runtime guide: `v2/README.md`
- Product requirements: `PRD.md`
- Economy and NFT model: `ECONOMY.md`
- AI model/provider notes: `AI.md`
