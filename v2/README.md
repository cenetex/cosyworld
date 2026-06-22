# CosyWorld V2 Kernel Prototype

This folder is the first implementation slice of the C-kernel/Rust-orchestrated CosyWorld MMO design.

It intentionally lives outside the current Node service so the new runtime can prove its contracts without disturbing the existing app.

For the Orbs, Intricately Carved Wooden Boxes, Ruby High pack/burn adapter, and legacy migration plan, see `../ECONOMY.md`.

For the OpenRouter player payer, Orb-paid Chat fallback, real AI media, combat rewards, and self-expanding swarm design, see `../AI.md`.

## Layout

- `core-c/`: deterministic C rules kernel.
- `ai-model-rust/`: deterministic local AI generation model with native and WASM exports.
- `orchestrator-rust/`: Rust HTTP/SSE host that compiles and calls the C kernel through FFI.
- `orchestrator-rust/src/index.html`: one-button browser MUD shell served by the Rust host.
- `orchestrator-rust/src/seed_content.json`: seed actor/item/location labels and level-2 evolution tracks consumed by the Rust host.

## Current Capabilities

The prototype boots one shard with a tiny connected map:

- Location `1`: The Cosy Cottage.
- Location `2`: Rain-Soft Garden.
- Location `3`: Moonlit Trail.
- Locations `2` and `3`: Rain-Soft Garden and Moonlit Trail, public CosyWorld Core rooms.
- Locations `10`-`15`: Ruby High: First Bell expansion rooms. Science Class, Homeroom, Library, Cafeteria, Greenhouse, and Courtyard require their matching Ruby High location cards on the official shard.
- Locations `30`-`35`, `40`-`44`, `50`, and `60`-`63`: public CosyWorld Core seed rooms for free-world breadth.
- Exits: `1 <-> 2 <-> 3`, plus Cottage hub doors to public seed rooms and locked Ruby High expansion doors.
- Default public room: everyone can enter The Cosy Cottage without an NFT.
- Official expansion exits: Ruby High: First Bell locations require their matching location card in the request access context; each expansion room is still one shared global channel, never a private copy.
- NPC `1001`: Rati.
- NPC `1002`: Whiskerwind.
- NPC `1003`: Skull.
- NPC `1004`: Moonlit Echo, a non-Cottage sparring target on Moonlit Trail.
- Item `2001`: Hearth Tonic.
- Item `2002`: Dewbright Button.
- Item `2003`: Wolfprint Charm.
- Item `2004`: Moonwool Thread.
- Item `2005`: Story Button.
- Item `2006`: Hearthstone Tag.
- Item `2007`: Watch Bell.

## Access Model

CosyWorld Core is free and should feel complete: players can create an avatar, chat, listen, earn and spend Orbs, collect seed items, travel through public rooms, and resolve the public practice/combat loop without holding an NFT.

Official NFTs unlock official expansions, not the base game. The first expansion is **Ruby High: First Bell**. On the official shard, Ruby High rooms use the trusted ownership feed and require their matching Ruby High location card:

- `location-science-lab` unlocks Science Class.
- `location-homeroom` unlocks Homeroom.
- `location-library` unlocks Library.
- `location-cafeteria` unlocks Cafeteria.
- `location-greenhouse` unlocks Greenhouse.
- `location-courtyard` unlocks Courtyard.

Locked expansion doors can be shown as previews in the room state, but `/actions/move` and `/actions/flee` enforce access on the server. Self-hosted shards can define their own public rooms, gated rooms, and ownership adapters, while the official hosted shard only trusts official collection feeds.

The C kernel currently resolves:

- World bootstrap.
- Human actor creation with generated stats.
- Room speech as content IDs.
- Exit-gated movement.
- Blocked movement for missing or locked exits.
- Visible ability checks with deterministic dice.
- Item pickup.
- Potion use with rule validation.
- Evolution item handoff.
- Level 2 resident evolution after two unique evolution items.
- Defend, attack, and flee primitives.
- Combat rejection in safe locations; The Cosy Cottage remains non-combat.
- A reachable Moonlit Trail sparring encounter for one-button attack/defend/flee smoke coverage.
- Primary action offer flags.

The Rust orchestrator currently owns:

- HTTP routes.
- SSE broadcast.
- Actor/item/location/content labels.
- Native calls into the local Rust AI model for deterministic avatar identity, fallback chat, resident replies, and speech sanitizer behavior that can also run in WASM.
- Card projections for visible actors, items, and locations.
- Session-touched live human presence, so stale generated avatars do not crowd active rooms.
- Generated human avatar flavor: name, title, description, and runtime avatar card.
- Server-authored avatar chat from the `Chat` button; human operators do not type or choose dialogue lines.
- Optional OpenAI-compatible avatar and resident response generation, with deterministic local fallback.
- Event projection.
- Snapshot persistence.
- SQLite action journal and projected event feed.
- Durable Orb ledger rows for avatar grants, rule rewards, flee rewards, and server-paid Chat spends.
- Durable AI usage ledger rows for player-avatar Chat payer/provider/model/status accounting without storing player OpenRouter keys.
- Trusted ownership-feed projection for active Wooden Box NFTs and unopened avatar packs in `/state`.
- Signed-wallet staging routes for Wooden Box burn receipts and avatar pack opening/card grants.
- Resident replies are submitted back through the kernel as actor actions and broadcast one-to-many to everyone in the room.

## Run

For the browser MVP, from the repository root:

```sh
./v2/mvp.sh
```

That script builds the Rust orchestrator, starts it detached on `127.0.0.1:3102` with the dev wallet cards needed for the current playable loop, enables `/dev/reset`, opens `http://127.0.0.1:3102/?wallet=dev-wallet`, and prints health/status. Useful commands:

```sh
./v2/mvp.sh check
./v2/mvp.sh smoke
./v2/mvp.sh status
./v2/mvp.sh logs
./v2/mvp.sh stop
```

Use `./v2/mvp.sh check` as the local MVP gate. It runs the C kernel test, local AI model native tests plus WASM build, Rust format/tests/build, JavaScript and terminal-client syntax checks, starts a production-profile smoke against a protected local Ruby High-style ownership feed, restarts the detached browser server, runs the Playwright browser smoke, runs a non-typing terminal smoke, and leaves the verified server running.

The local AI model can be checked and built for browser use from the repository root:

```sh
npm run v2:ai-model:test
npm run v2:ai-model:wasm
```

The WASM build writes the raw `wasm32-unknown-unknown` artifact under `v2/ai-model-rust/target/wasm32-unknown-unknown/release/`. It exports JSON-string functions for the model manifest, avatar identity generation, avatar chat fallback, and resident replies.

From `v2/orchestrator-rust`:

```sh
cargo run
```

The server listens on `127.0.0.1:3102` by default.

## Deploy

The repository root `Dockerfile` builds the V2 release binary and runs `cosyworld-orchestrator`. The root `fly.toml` points at that Dockerfile, mounts `/data`, and runs the orchestrator on port `3000`.

The production Fly profile expects the protected Ruby High ownership feed, moderation token, and event store to be configured before boot:

```sh
fly secrets set COSYWORLD_RUBY_HIGH_WALLET_CARDS_BEARER=...
fly secrets set COSYWORLD_MODERATION_TOKEN=...
fly deploy
```

Before enabling production Box burns, set the chain verifier secrets:

```sh
fly secrets set COSYWORLD_BOX_BURN_SOLANA_RPC_URL=...
fly secrets set COSYWORLD_BOX_CORE_COLLECTION_ADDRESS=...
```

If the Node companion service is also deployed, set `COSYWORLD_V2_PUBLIC_URL` there so `/api/runtime` and the launch bridge point at this V2 service.

Override it with:

```sh
COSYWORLD_V2_ADDR=127.0.0.1:3200 cargo run
```

Enable local playtest reset with:

```sh
COSYWORLD_ENABLE_DEV_RESET=1 cargo run
```

Then open:

```text
http://127.0.0.1:3102/?reset=1
```

`reset=1` clears the browser's remembered avatar, calls the dev-gated `/dev/reset` endpoint when enabled, removes the reset flag from the URL, reseeds the world, clears the SQLite action journal/event feed, and returns the player to the explicit `Create Avatar` gate. Without `COSYWORLD_ENABLE_DEV_RESET=1`, the query still clears only the local browser avatar so a tester can start a new human without resetting the shared server.

For the current browser MVP smoke, run the shard with a dev wallet that can reach the Garden, Trail, and Science. `./v2/mvp.sh check` also seeds a deterministic throwaway signed smoke wallet with `location-library` so the smoke can verify the production-style wallet challenge/session path:

```sh
COSYWORLD_ENABLE_DEV_RESET=1 \
COSYWORLD_DEV_ALLOW_UNSIGNED_WALLET=1 \
COSYWORLD_RUBY_HIGH_WALLET_CARDS='dev-wallet:cosy-rain-soft-garden,cosy-moonlit-trail,location-science-lab|rati-wallet:rati,location-science-lab|DcfmEZ6tw7BGJo1a7TozkCoGJZNFJxCBJS5axj7oy4ES:location-library' \
cargo run
```

Then from the repository root:

```sh
node v2/scripts/smoke-browser.mjs
```

The browser smoke uses Playwright from `v2` when available, or the sibling `../app-ruby-high` workspace in this development checkout. It verifies runtime metadata, signed wallet challenge/session access, signed wallet avatar recovery, avatar creation, actor-session continuity, walletless `connect wallet`, one-button normal play, zero-Orb earning-action priority, no-typing `listen`, server-authored avatar chat, reload continuity, contextual verb labels, mobile and desktop viewport fit, generated seed-card art, Ruby High card asset delivery, card-gated travel, the Moonlit Trail combat encounter including flee, item pickup, wrong-resident gift filtering, all three level 2 resident evolutions, protected resident/human action boundaries, and disabled client-authored speech.

When the mobile and desktop visual shell checks pass, the smoke writes viewport screenshots plus JSON metadata and SHA-256 hashes to `v2/orchestrator-rust/.runtime/visual-smoke/`. It also compares those screenshots against the committed PNG baselines in `v2/tests/visual-baselines/` with a 3% max pixel mismatch ratio. Set `COSYWORLD_VISUAL_SNAPSHOT_DIR=/path/to/output` to collect runtime artifacts somewhere else, or run `COSYWORLD_UPDATE_VISUAL_BASELINES=1 node v2/scripts/smoke-browser.mjs` after an intentional UI change to refresh the baselines.

Enable AI-backed avatar chat and resident replies with an OpenAI-compatible provider:

```sh
COSYWORLD_AI_API_KEY=... COSYWORLD_AI_MODEL=gpt-4.1-mini cargo run
```

OpenRouter works too:

```sh
OPENROUTER_API_KEY=... OPENROUTER_CHAT_MODEL=openai/gpt-4.1-mini cargo run
```

Optional overrides:

```sh
COSYWORLD_AI_BASE_URL=https://api.openai.com/v1
COSYWORLD_AI_PROVIDER=openrouter
```

When no AI key is configured, avatar chat and resident replies use deterministic local fallback text. In both modes pressing `Chat` asks the server to author one line for the player's avatar, commits that avatar line through the C kernel as `CW_ACTION_SAY`, schedules the resident reply afterward, validates the resident speech contract, and broadcasts both as shared world events. The human operator never submits dialogue text.

The MVP economy is enabled by default:

- New human avatars receive 3 Orbs.
- Server-paid `Chat` costs 1 Orb after the avatar line commits.
- `Listen`, `Attack`, and `Flee` can award Orbs from committed kernel events.
- Automatic Orb rewards are claim-key gated by actor/context so repeated identical outcomes cannot mint duplicate rewards.
- If Chat is unaffordable, the browser prefers in-world earning actions such as `Listen` over AI setup only while that action can still claim a reward; a verified player OpenRouter key still makes explicit `Chat` actions cost zero Orbs while the result remains a public shared-room event.
- Orb mutations and player-avatar Chat AI usage are persisted to SQLite ledger tables when the event store is enabled.
- Trusted ownership feeds may include active Wooden Boxes and unopened avatar packs; the main room UI keeps those out of the normal transcript, while the top economy chip can focus account inventory/provenance and change the one contextual command to `Open Box` or `Open Pack`.
- `/nft/boxes/burn-prepare`, `/nft/boxes/burn-confirm`, and `/nft/packs/open` exist as signed-wallet endpoints. Local mode can still create staging receipts for fast development. Production profile requires a configured Solana/Core verifier; `burn-confirm` checks the submitted transaction signature for a confirmed Metaplex Core burn of the Box asset from the connected wallet and configured Box collection before creating a receipt. Production burn transaction building, reconciliation, and a richer account/card gallery UI are still missing.

Ambient room beats are enabled by default but sparse:

```sh
COSYWORLD_AMBIENT_ENABLED=1
COSYWORLD_AMBIENT_QUIET_SECS=75
COSYWORLD_AMBIENT_POLL_SECS=15
```

The scheduler only emits after the room has been quiet and only when a human avatar shares a room with an active resident. Ambient resident lines are committed through the same C `SAY` reducer. On occasional ticks, the resident instead performs a kernel-owned Wisdom check, producing an auditable `ability_check.rolled` event in the shared room timeline. Legacy branch records do not suppress ambient behavior.

By default, runtime state persists to:

```text
v2/orchestrator-rust/.runtime/cosyworld-v2-snapshot.json
```

Append-only source actions and projected event history persist to:

```text
v2/orchestrator-rust/.runtime/cosyworld-v2-events.sqlite
```

Override or disable persistence with:

```sh
COSYWORLD_V2_SNAPSHOT_PATH=/tmp/cosyworld-v2.json cargo run
COSYWORLD_V2_EVENT_DB_PATH=/tmp/cosyworld-v2-events.sqlite cargo run
COSYWORLD_V2_SNAPSHOT_PATH=off cargo run
COSYWORLD_V2_EVENT_DB_PATH=off cargo run
```

## Play In A Terminal

From `v2`:

```sh
./play.sh
```

`play.sh` reuses the local server when one is already running. Otherwise it starts the Rust orchestrator on `127.0.0.1:3102`, waits for `/health`, generates an avatar with an actor session, and launches the terminal client.

The default client is JRPG-style button mode:

```text
[Enter] primary contextual action
[Space] secondary contextual action, when present
[Tab]   rotate available context
[Q]     quit
```

The client offers actions from visible world state: nearby residents to chat with, visible items, matching evolution gifts, available exits, combat escape routes, and room rules. It does not ask the player to type chat text.

Normal play keeps the main verb as `Chat`: resident-specific details live in the button detail and thumbnail, while contextual states can still become `Give Item`, `Travel`, `Flee`, `Use`, or `Wait`. Empty room transcripts render an opening beat for the current location instead of a debug placeholder.

The current location tab participates in the same one-button surface: focusing it changes the command to `listen`, rolls a kernel-owned Wisdom check, and writes the auditable total/DC into the shared room transcript. Combat events use the same transcript style for attack rolls, AC, damage, HP remaining, knockouts, and fleeing instead of exposing a separate stat table.

You can connect the CLI to an existing server, or use the typed debug shell explicitly:

```sh
python3 cli/cosy_cli.py --base-url http://127.0.0.1:3102
python3 cli/cosy_cli.py --base-url http://127.0.0.1:3102 --actor-id 5000 --actor-session <session>
python3 cli/cosy_cli.py --base-url http://127.0.0.1:3102 --command-mode
```

## Play In A Browser

Open:

```text
http://127.0.0.1:3102/
```

The browser UX is intentionally chat/MUD-first: a terminal-style transcript, compact room presence, and one contextual command. It should not expose debug tables, stat grids, item spreadsheets, route IDs, text inputs, or dialogue choice sheets during normal play.

The transcript is a polite `role="log"` live region labeled as the shared room timeline. Whiskerwind remains visibly emoji-only, but Whiskerwind message rows include descriptive `aria-label` text so symbol-only speech is not inaccessible to screen readers.

First entry shows The Cosy Cottage with one command: `create avatar`. The browser intentionally migrates old local auto-created avatars out of the way once, so the first explicit avatar generation step is visible. Future avatars created through this flow are remembered locally.

Returning players keep their local avatar id plus an opaque `actor_session` minted by `/avatar`, and re-enter through `/state?actor_id=...&actor_session=...`. If the server no longer recognizes that actor/session pair, the state contract falls back to `Create Avatar` instead of silently fabricating a character or letting another browser drive the avatar by guessing its id.

When `/avatar` receives a signed `wallet_session`, the server treats the command as recover-or-create. The first call creates the human actor, records a durable wallet-to-avatar link, and returns an actor session. Later calls with the same signed wallet session recover that same live human actor and issue a fresh actor session without emitting duplicate `actor.created` world events. Dev reset clears those links along with the reseeded world.

Room presence is intentionally narrower than durable avatar existence. A human avatar persists in the world and can return with its actor session, but other players only see that human in room presence while the actor session has been touched recently by state/action/stream traffic. NPC residents stay visible according to world placement. This keeps shared rooms lively without filling them with closed-tab or old smoke-test avatars.

Visible actors, items, and locations now resolve through `state.cards`:

- actors use tall card art and render as round portraits in compact controls;
- items use square card art;
- locations use wide card art in the top tab and travel controls;
- Ruby High cards carry First Bell catalog/on-chain metadata;
- CosyWorld seed cards use the same shape with `seed_art` served from `/assets/generated/cards/{card_id}.svg` until the card pipeline adds full NFT records.

The Rust orchestrator mirrors the 24 live Ruby High: First Bell card profiles from `../app-ruby-high`, covering students, teachers, special cards, items, and locations. Exposed First Bell cards use `/assets/cards/{card_id}.png`, backed by `../app-ruby-high/assets/nft/cards`, and project the matching set number, profile id, subject, rarity, aspect, and Arweave image URI into `state.cards`.

For the current dev slice, the server owns wallet/card access through an ownership snapshot:

```sh
COSYWORLD_RUBY_HIGH_WALLET_CARDS='dev-wallet:cosy-rain-soft-garden,cosy-moonlit-trail,location-science-lab|rati-wallet:rati,location-science-lab' cargo run
```

By default, a browser can only claim a wallet after signing a Solana wallet challenge:

- `GET /wallet/challenge?wallet_address=<base58 public key>` returns the exact message to sign.
- `POST /wallet/session` verifies the Ed25519 signature and returns a short-lived `wallet_session`.
- `/state`, `/actions/move`, and `/actions/flee` use `wallet_session` to resolve server-owned Ruby High: First Bell expansion access.

The one-button browser shell exposes this as a contextual `connect wallet` command when a locked Ruby High expansion door is focused and no signed wallet session is present.

For local smoke/demo only, enable unsigned wallet hints explicitly, then open `http://127.0.0.1:3102/?wallet=dev-wallet`:

```sh
COSYWORLD_DEV_ALLOW_UNSIGNED_WALLET=1 \
COSYWORLD_RUBY_HIGH_WALLET_CARDS='dev-wallet:cosy-rain-soft-garden,cosy-moonlit-trail,location-science-lab|rati-wallet:rati,location-science-lab' \
cargo run
```

`wallet` and signed `wallet_session` values are persisted in browser local storage after first load. The browser may still send `cards` or `owned_card_ids`, but the server ignores client-provided card claims by default. Use `COSYWORLD_DEV_TRUST_CLIENT_CARD_IDS=1` only for throwaway local debugging.

The same snapshot can be loaded from a file:

```sh
COSYWORLD_RUBY_HIGH_WALLET_CARDS_PATH=.runtime/ruby-high-wallet-cards.txt cargo run
```

Production-style deployments can point at a trusted server-owned JSON feed:

```sh
COSYWORLD_RUBY_HIGH_WALLET_CARDS_URL=https://ruby-high.ai/api/apps/ruby-high/nft/internal/cosyworld/wallet-cards \
COSYWORLD_RUBY_HIGH_WALLET_CARDS_BEARER=... \
cargo run
```

Ruby High protects that endpoint with `RUBY_HIGH_COSYWORLD_EXPORT_TOKEN` and exports only active, minted Hall Pass card NFTs with an owner wallet address. The remote feed is fetched on v2 startup, merged with inline/path feeds, and refreshed every 60 seconds by default. Startup and refresh both merge durable local Box/pack receipts into the effective ownership index, so opened-pack card grants stay visible between Ruby High feed updates. Refresh failures keep the last good ownership index so a transient Ruby High/network outage does not lock players out. Tune the loop with `COSYWORLD_RUBY_HIGH_WALLET_CARDS_REFRESH_SECS`; set it to `0` to disable background refresh.

For a public deployment, turn on the explicit production profile:

```sh
COSYWORLD_DEPLOY_PROFILE=production \
COSYWORLD_RUBY_HIGH_WALLET_CARDS_URL=https://ruby-high.ai/api/apps/ruby-high/nft/internal/cosyworld/wallet-cards \
COSYWORLD_RUBY_HIGH_WALLET_CARDS_BEARER=... \
COSYWORLD_MODERATION_TOKEN=... \
cargo run --release
```

`COSYWORLD_DEPLOY_PROFILE=production` makes startup use the strict ownership-feed path and aborts if the protected remote feed or bearer token is missing, the SQLite event store is disabled, moderation is not configured, or local dev shortcuts such as unsigned wallet hints, dev reset, trusted client card ids, or avatar chat delay are enabled. Configure Box burn verification with `COSYWORLD_BOX_BURN_SOLANA_RPC_URL` and `COSYWORLD_BOX_CORE_COLLECTION_ADDRESS`; until those are present, production Box burn endpoints stay closed with `501` responses. `/meta` exposes the active deployment profile and `nft.box_burn_verifier_configured` so deploy smoke checks can confirm whether chain verification is enabled.

The local production-profile smoke uses the same guardrails without real Ruby High credentials:

```sh
cargo build
node v2/scripts/smoke-production-profile.mjs
```

It launches a temporary bearer-protected ownership feed, starts the orchestrator with `COSYWORLD_DEPLOY_PROFILE=production`, and verifies `/meta` reports production mode, remote ownership, moderation, persistence, configured Box burn verification for the smoke process, and disabled dev shortcuts.

The file uses the same line format:

```text
wallet-a:rati,location-science-lab
wallet-b:rati,cosy-rain-soft-garden
```

The same path or env var also accepts trusted JSON exports:

```json
[
  { "walletAddress": "wallet-a", "cardIds": ["rati", "location-science-lab"] },
  { "wallet_address": "wallet-b", "cards": "location-library location-greenhouse" },
  {
    "walletAddress": "wallet-c",
    "hallPassCards": [
      { "characterId": "location-courtyard", "status": "active" },
      { "characterId": "location-library", "status": "burned" }
    ]
  }
]
```

or:

```json
{
  "wallet-a": ["rati", "location-science-lab"],
  "wallet-b": "location-library location-greenhouse"
}
```

This is the adapter seam for replacing the dev snapshot with Ruby High wallet/session NFT ownership. The feed is server-owned; browser `cards` query params remain ignored unless the explicit local debug flag is enabled.

The world remains shared: `location-science-lab`, `location-homeroom`, `location-library`, `location-cafeteria`, `location-greenhouse`, and `location-courtyard` unlock travel to their one global rooms. They do not create per-wallet rooms or teacher DMs.

Chat is server-authored avatar speech, not a human text box or branch picker:

- Focusing Rati, Whiskerwind, or Skull and pressing `Chat` calls `/actions/chat`.
- The server validates the actor session, target resident, shared location, and rate limit.
- The server asks the configured LLM to write one in-character line for the player's avatar, or uses deterministic fallback text when no model is configured.
- The avatar line is committed through the C kernel as a normal `message.created` world event.
- The chosen resident then replies as another normal world event, using the same shared one-to-many timeline as ambient and combat output.
- A human avatar can have only one server-authored Chat turn in flight; overlapping Chat submissions for the same actor return `409` and emit no events.
- Client-authored `/actions/say` is disabled; humans do not type, submit, or pick dialogue text in the normal product.
- Legacy branch records in old snapshots are ignored by `/state` and do not change the primary action.

Items can now drive resident evolution through the C kernel:

- `Dewbright Button` waits in Rain-Soft Garden.
- `Wolfprint Charm` waits on Moonlit Trail.
- `Moonwool Thread`, `Story Button`, `Hearthstone Tag`, and `Watch Bell` seed the next resident-specific tracks.
- A human can carry matching items back to a resident.
- When a held evolution item and an active resident who needs it are in the same room, focusing the resident chip or held item chip makes the single primary command become `give item`.
- Giving two unique required items to a resident emits `item.given` and then `avatar.evolved`; the resident reaches level 2 in shared world state.
- The C kernel rejects wrong-resident gifts before transfer. In the current seed, Rati needs `Moonwool Thread` plus `Story Button`; Whiskerwind needs `Dewbright Button` plus `Wolfprint Charm`; Skull needs `Hearthstone Tag` plus `Watch Bell`.
- Evolved residents project into the same card system with `level`, `evolved`, evolved rarity, and updated title/blurb. The browser reflects this in compact room chips and action details instead of a stats table.

The Rust host loads actor names, item descriptions, location labels, combat flags, and level-2 evolution tracks from `orchestrator-rust/src/seed_content.json`. Startup tests validate that this manifest has unique ids, references real item ids, matches seeded kernel entities, and keeps each evolution track at exactly two unique items. The C kernel still owns rule enforcement for movement, item transfer, and evolution.

Resident placement can be simulated with an aggregate ownership snapshot:

```sh
COSYWORLD_RUBY_HIGH_WALLET_CARDS='w1:rati,location-science-lab|w2:rati,cosy-rain-soft-garden' cargo run
```

Each wallet holding a resident avatar card contributes the unique location cards in that wallet. The resident appears in the highest-scoring shared location, with daily deterministic rotation across ties. With no overlap, residents default to The Cosy Cottage. Placement is recomputed from the server-owned ownership index on boot, reset, and ownership refresh, so stale snapshots cannot strand a resident in a gated room after ownership changes.

Access and gravity are separate: The Cosy Cottage is public even without a card, but a `cosy-cottage` card can still count as a placement vote when a wallet also holds a resident avatar card.

Live refreshes and dev resets emit normal `actor.moved` events when placement moves a resident, then persist and broadcast those events through the shared room timeline. Boot-time placement stays quiet so process restarts do not replay movement noise.

## Shared Live Rooms

Locations are live channels:

- `/state?actor_id=...` returns the actor's current location, visible presence, available actions, and room-scoped recent events.
- `/world?actor_id=...&actor_session=...&wallet_session=...` returns the shared room map, gated/public status, accessible room contents, and locked-room summaries without exposing locked actor/item details.
- `/stream?actor_id=...&actor_session=...&wallet_session=...` broadcasts accepted world events over SSE after filtering to public Cottage events plus rooms visible to that actor/wallet.
- `/events` uses the same visibility query parameters for replay; walletless requests only receive public Cottage-visible events. Replay defaults to the latest 80 visible events, accepts `limit=...`, and caps explicit requests at 500.
- Human presence in `/state` and `/world` is filtered to the current actor plus recently touched actor sessions; durable old avatars are not treated as online occupants.
- The browser appends matching live events to the current room transcript and refreshes presence/actions when movement, item, actor, or combat state changes.
- Moving between locations swaps to that room's transcript instead of carrying the prior room log forward.

This keeps AI output one-to-many: a resident reply is committed as a world event and broadcast to everyone present, not regenerated as a private response for each player.

## Endpoints

- `GET /health`
- `GET /meta`
- `GET /state`
- `GET /state?actor_id=5000&actor_session=<session>`
- `GET /state?actor_id=5000&actor_session=<session>&wallet_session=<wallet-session>`
- `GET /world`
- `GET /world?actor_id=5000&actor_session=<session>&wallet_session=<wallet-session>`
- `GET /events`
- `GET /events?after=12&limit=80`
- `GET /moderation/events?after=12&limit=80` with `Authorization: Bearer <COSYWORLD_MODERATION_TOKEN>`
- `POST /moderation/actors/{actor_id}/suspend` with `Authorization: Bearer <COSYWORLD_MODERATION_TOKEN>`
- `POST /moderation/actors/{actor_id}/unsuspend` with `Authorization: Bearer <COSYWORLD_MODERATION_TOKEN>`
- `GET /stream`
- `POST /dev/reset` when `COSYWORLD_ENABLE_DEV_RESET=1`
- `POST /avatar`
- `POST /presence/leave`
- `POST /actions/chat`
- `POST /actions/say` returns `410` for disabled client-authored speech
- `POST /actions/move`
- `POST /actions/check`
- `POST /actions/pick-up`
- `POST /actions/use-item`
- `POST /actions/give-item`
- `POST /actions/attack`
- `POST /actions/defend`
- `POST /actions/flee`

`/health` is intentionally minimal readiness. `/meta` is the deploy/smoke metadata endpoint: package version, debug/release build profile, deployment profile, non-secret feature flags such as server-authored Chat and disabled client-authored speech, persistence mode, ownership-feed mode, and current world counters. `./v2/mvp.sh status` prints a one-line summary from it.

Protected operator audit routes require `Authorization: Bearer <COSYWORLD_MODERATION_TOKEN>`. `/moderation/events` returns bounded all-room event replay. `/moderation/economy` returns bounded Orb ledger, AI usage ledger, Wooden Box receipt, and avatar pack opening rows without exposing player OpenRouter keys.

Public action endpoints accept active human actors only when the matching `actor_session` is present. The Rust orchestrator can still commit avatar and resident `SAY` events internally for Chat, AI replies, ambient beats, and placement, but browser-submitted actions cannot provide message content or act as Rati, Whiskerwind, Skull, other residents, or another human avatar by id alone.

Public mutation endpoints also pass through lightweight in-memory rate limits before they touch the world reducer:

- Avatar creation: 8 attempts per client IP per 10 minutes.
- Wallet challenge/session: 30 attempts per client IP per minute.
- Chat actions: 45 attempts per actor per minute, with a broader shared IP mutation cap.
- Movement, item, check, and combat actions: 180 attempts per actor per minute, with the same shared IP mutation cap.

Client-submitted `/actions/say` no longer enters the action journal. The supported dialogue path is `/actions/chat`, where the server authors the avatar line and commits it through the same C `SAY` event shape used by resident replies.

The limits are intentionally generous for normal play and local smoke tests. They are MVP guardrails for the single shared public world, not a replacement for full moderation.

## Moderation

Set `COSYWORLD_MODERATION_TOKEN` to enable protected moderation endpoints:

```sh
COSYWORLD_MODERATION_TOKEN=... cargo run
```

`GET /moderation/events?limit=80` requires `Authorization: Bearer <token>` and returns a bounded chronological replay across all rooms, bypassing player room/card visibility filters for operator review. It uses the same default replay limit of 80 and hard cap of 500 as player `/events`.

`POST /moderation/actors/{actor_id}/suspend` stores a durable actor suspension, clears the actor's active sessions, hides the avatar from active presence, and makes future player actions for that actor return `403`. `POST /moderation/actors/{actor_id}/unsuspend` removes that suspension. This is an operator API only; there is no player-facing moderation UI, report queue, deletion workflow, or retention automation yet.

Example:

```sh
curl -s -X POST http://127.0.0.1:3102/avatar \
  -H 'content-type: application/json' \
  -d '{"name":"Mira"}'
```

```sh
curl -s -X POST http://127.0.0.1:3102/actions/chat \
  -H 'content-type: application/json' \
  -d '{"actor_id":5000,"actor_session":"...","target_actor_id":1001}'
```

```sh
curl -s -X POST http://127.0.0.1:3102/actions/move \
  -H 'content-type: application/json' \
  -d '{"actor_id":5000,"actor_session":"...","wallet_session":"...","destination_location_id":2}'
```

## Verify

From the repository root:

```sh
cc -std=c11 -Wall -Wextra -Werror \
  -I v2/core-c/include \
  v2/core-c/src/cosy_kernel.c \
  v2/core-c/tests/test_kernel.c \
  -o /tmp/cosy_kernel_test && /tmp/cosy_kernel_test
```

From `v2/orchestrator-rust`:

```sh
cargo test
```

## Design Rule

All meaningful world mutation must pass through the C kernel.

Rust may store content, call AI, manage streams, schedule NPCs, persist events, and project state. Rust should not decide whether movement, item use, evolution, combat, or stat checks succeed.

`GET /state?actor_id=...&actor_session=...` is room scoped: it follows that actor's current location, returns visible actors/items for the room, returns exits from that room, and includes the kernel-derived primary action options. Actor id without the matching session falls back to the public Cottage avatar gate.

The SQLite database stores three different layers:

- `action_journal`: the source record of accepted client/system actions, deterministic seeds, and Rust-owned label/content upserts.
- `world_events`: the projected event feed produced by replaying actions through the C kernel.
- `actor_sessions`: opaque local browser sessions for generated human avatars. These survive process restarts alongside the action journal and are cleared by dev reset.

On startup, the orchestrator replays `action_journal` when it is present. JSON snapshots are an accelerator and fallback, not the source of truth.
