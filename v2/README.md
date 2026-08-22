# CosyWorld V2 Runtime

This folder contains the canonical CosyWorld runtime: a deterministic C rules
kernel, a Rust HTTP/SSE orchestrator, a browser MUD shell, content worldpack
data, and the local smoke/deployment gates.

The older Node service remains in the repository as a legacy companion for
integrations and migration work. Gameplay truth lives here.

ADR 0006 accepts a wallet-optional core with an avatar-NFT-only bridge. The
Box/pack, keepsake, wallet-gate, and item/location materialization player
surfaces are removed. Their historical rows remain replayable operator-audit
data. New external-ownership work belongs only in the optional linked-avatar
adapter.

For Orbs, linked avatars, legacy receipt inventory, and the migration plan, see
`../ECONOMY.md`.

For free public Chat, community-funded evolving card art, combat rewards, and self-expanding swarm design, see `../AI.md`.

## Layout

- `core-c/`: deterministic C rules kernel.
- `ai-model-rust/`: deterministic local AI generation model with native and WASM exports.
- `orchestrator-rust/`: Rust HTTP/SSE host that compiles and calls the C kernel through FFI.
- `orchestrator-rust/src/ai_gateway.rs`: OpenAI-compatible/OpenRouter text,
  image, embeddings, rerank, speech-synthesis, and dormant transcription
  primitives with exact-model binding, bounded retries and responses, typed
  failures, and request telemetry.
- `orchestrator-rust/src/routes.rs`: HTTP route table extracted from the runtime bootstrap.
- `orchestrator-rust/src/world_simulation.rs`: deterministic played-time weather, trade, faction, and conflict reducer.
- `orchestrator-rust/src/index.html`: one-button browser MUD shell served by the Rust host.
- `orchestrator-rust/src/mud.rs`: typed command protocol, parser aliases, response formatting, fuzzy matching, and direction canonicalization.
- `content/core/`: authored first-party world pack.
- `content/lonely-forest/` and `content/ruby-high-first-bell/`: asset and external-catalog packs.
- `content/rules-srd-5.1/` and `content/rules-srd-5.2.1/`: separately attributed, non-authoritative fifth-edition rules references.
- `content/rules-profile-srd5/`: executable `cosyworld.srd5/1` action profile, conformance matrix, and item/equipment/Magic contracts.
- `content/the-lantern-keeper/`: short campaign pack and its character-creation profile.
- `worlds/official/`: selected packs and reproducible integrity lock.
- `content/official/`: generated bundle consumed by the Rust host. See `docs/worldpacks.md`.

The reference packs remain non-authoritative; the official world selects the
versioned `cosyworld.srd5/1` profile through `cosyworld.rules/2`. Stable SRD
5.2.1 action identities sit beneath presentation cards for avatars, items, and locations,
with weapons, skill charms, spells, and containers as playable Item roles. The
implemented architecture is documented in
[`docs/systems/04-action-system.md`](../docs/systems/04-action-system.md) and
its acceptance/evidence ledger is tracked in
[`docs/backlog/srd-action-card-foundation.md`](../docs/backlog/srd-action-card-foundation.md).
Expansion authors should start with
[`docs/action-pack-authoring.md`](docs/action-pack-authoring.md); the deliberately
non-shipping ordinary-action draw experiment is recorded in
[`docs/deck-gated-action-spike.md`](docs/deck-gated-action-spike.md).

## Current Capabilities

The official service has one canonical player world. The current production
shape still boots one orchestrator, backed by a durable fenced commit point:

- SQLite atomically commits actions, globally ordered events, command receipts,
  entity versions, claims, partition fences, and outbox jobs. The process owns
  a replayable projection and one SSE fan-out, not an independent world save.
- `COSYWORLD_PROCESS_ID` is the process label in `/meta`; it defaults to
  `local` for local profile and `public-1` for production profile.
  `COSYWORLD_V2_SHARD_ID` remains a compatibility input/output alias and must
  match when both settings are present. Neither is world, room, actor, or save
  identity.
- The C kernel is built with fixed in-process capacities of 512 actors, 1024
  items, 256 locations, 1024 exits, 256 emitted events per kernel call, and 128
  evolution tracks. `/meta` exposes the live counters and these compiled caps.
- Capacity processes can register exact routes, forward canonical commands,
  converge durable projections, relay ephemeral presence, rendezvous stable
  profile/invite references, atomically hand off hot rooms, checkpoint split
  ownership ranges, and promote a hash-verified recovery prefix under higher
  regional and partition fences. The current Fly deployment remains one
  orchestrator per app until exact per-process routes and a release-specific
  recovery drill pass. Starting isolated public-world copies—or using a shared
  load-balancer URL as an owner route—is forbidden. See
  `docs/canonical-world.md` for the operator contract.

Seed world content:

- Location `1`: The Cosy Cottage.
- Location `2`: Rain-Soft Garden.
- Location `3`: Moonlit Trail.
- Locations `2` and `3`: Rain-Soft Garden and Moonlit Trail, public CosyWorld Core rooms.
- Locations `10`-`15`: public Ruby High: First Bell expansion rooms: Science Class, Homeroom, Library, Cafeteria, Greenhouse, and Courtyard.
- Locations `30`-`36`, `40`-`44`, `50`, and `60`-`65`: public CosyWorld Core seed rooms for free-world breadth.
- Exits: `1 <-> 2 <-> 3`, plus Cottage hub doors to public seed and Ruby High rooms.
- Every official room is shared and independent of wallet or NFT ownership.
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
- Item `2012`: Patchwork Satchel, an equippable physical-capacity card.
- Item `2013`: Moonlit Practice Blade, an equipped weapon-profile card.
- Item `2014`: Steady Light, a prepared/exhaustible bounded spell card.

## Access Model

CosyWorld Core and mounted expansions are complete ordinary play without a
wallet. Players can create an avatar, chat, listen, earn and spend Orbs, collect
physical world items, travel, and resolve practice/combat through world rules.
Cards present actors, items, locations, spells, and actions; they are not an
ownership or access plane.

The one optional external boundary is the linked-avatar adapter. A signed
wallet can discover a supported avatar NFT and recover its one durable,
autonomous world actor. Custody grants no direct control, place access, item,
action, reward, progression, or private media.

The C kernel currently resolves:

- World bootstrap.
- Human actor creation with generated stats.
- Room speech as content IDs.
- Exit-gated movement.
- Blocked movement for missing or locked exits.
- Visible ability checks with deterministic normal, Advantage, and Disadvantage d20 resolution.
- Item pickup.
- Potion use with rule validation.
- Evolution item handoff.
- Level 2 resident evolution after two unique evolution items.
- Defend, attack, and flee primitives, including derived Bloodied state and nonlethal 1-HP knockouts.
- Combat rejection in safe locations; The Cosy Cottage remains non-combat.
- A reachable Moonlit Trail sparring encounter for one-button attack/defend/flee smoke coverage.
- Ranked primary action offers with typed category, target, cost, risk, effect, claim-key, source, disabled-state, and inspector metadata.
- Append-only profile Search, Study, Influence, Magic, and theft actions;
  authoritative item zones, equipped weapon/container profiles, and spell
  exhaustion.

The Rust orchestrator currently owns:

- HTTP routes.
- SSE broadcast.
- Actor/item/location/content labels.
- Native calls into the local Rust model for deterministic avatar identity and speech sanitizer behavior that can also run in WASM; dialogue is generated only through configured AI inference.
- Card projections for visible actors, items, and locations.
- Rules-bound legal-action envelopes, a deterministic three-slot Story Hand
  with exact per-card Think certificates, composition traces, and stale/tampered
  submission rejection.
- Read-only legacy item-materialization migration receipts and possession
  provenance. No materialize or Collection-return mutation remains; the
  verified avatar-NFT actor adapter is a separate seam.
- Session-touched and heartbeat-refreshed direct-input presence, so stale
  directly controlled avatars do not crowd active rooms.
- Controller-based safety policy: directly controlled avatars cannot be theft
  or combat targets without durable consent, blocks fail closed, and private
  economy details are visible only to the controlling avatar.
- Generated human avatar flavor: name, title, description, and runtime avatar card.
- Bounded avatar-to-resident `Chat` exchanges and advancement-backed `Befriend`, with no player-authored speech surface.
- OpenAI-compatible contextual resident replies with no deterministic dialogue substitute when inference is unavailable.
- Event projection.
- Snapshot persistence.
- SQLite action journal and projected event feed.
- Durable Orb ledger rows for avatar grants, rule rewards, flee rewards, and community image contributions; image generation is the sole Orb sink.
- Durable AI usage ledger rows for system-funded resident and community-image payer/provider/model/status accounting without storing player OpenRouter keys.
- Optional protected ownership adapter for supported linked avatars; legacy
  Box/pack receipts are visible only in protected moderation audit.
- Resident replies are submitted back through the kernel as actor actions and broadcast one-to-many to everyone in the room.
- Every sixth committed player world tick advances one deterministic frontier pulse. Ambient weather is harmless; opportunity effects move or strain authored stock, affect faction momentum/influence, and change visible conflict pressure. Pressure cannot cross into stakes unless that same turn records a relevant action at the affected frontier; only then may the pulse advance its active danger clock. The journal replays this history and its exact causal link, snapshots persist it, and `/state` exposes only locally visible conditions. See `docs/world-simulation.md`.

## Agent Play Loop

AI agents should play through the same server rules as browser players:

1. Create or recover an ordinary avatar through `POST /avatar` and retain its
   `actor_session`.
2. Observe with `GET /state?actor_id=<id>&actor_session=<actor_session>`.
3. Submit commands through the same certified action endpoints as other
   clients.
4. Watch room changes with `/events` or `/stream` using the same actor session.

A wallet session is needed only when discovering or recovering a supported
linked avatar; it is not the general agent authentication path.

For the optional linked-avatar narrative delegation, the owner wallet signs once:

```text
CosyWorld narrative move delegation
Wallet: <owner_wallet>
Delegate: <ephemeral_wallet>
Session: <wallet_session>
Character: <actor_id>
Issued: <issued_at_unix>
Expires: <expires_at_unix>
```

Then the ephemeral key signs each move:

```text
CosyWorld delegated narrative move
Wallet: <owner_wallet>
Delegate: <ephemeral_wallet>
Session: <wallet_session>
Character: <actor_id>
Command: <normalized_command>
Nonce: <nonce>
Issued: <issued_at_unix>
```

`/actions/narrative-move` verifies the signed wallet session, wallet-to-avatar link, delegation, move signature, timestamp freshness, and nonce replay protection before dispatching through the normal MUD command handler. Mutation endpoints still reject bare wallet-session requests; the delegated relay is the agent action path.

## Run

For the browser MVP, from the repository root:

```sh
./v2/mvp.sh
```

That script builds the Rust orchestrator, starts it detached on
`127.0.0.1:3102`, enables `/dev/reset`, opens the wallet-free first tale, and
prints health/status. Useful commands:

```sh
./v2/mvp.sh check
./v2/mvp.sh smoke
./v2/mvp.sh status
./v2/mvp.sh logs
./v2/mvp.sh stop
```

Use `./v2/mvp.sh check` as the local MVP gate. It runs the content worldpack check, the C kernel test, local AI model native tests plus WASM build, Rust format/tests/build, JavaScript and terminal-client syntax checks, starts a production-profile smoke against a protected local Ruby High-style ownership feed, restarts the detached browser server, runs the Playwright browser smoke, runs a non-typing terminal smoke plus a typed terminal command-mode speech smoke, and leaves the verified server running.

The browser and terminal portions of this gate deliberately clear remote AI
credentials before starting their local server. They exercise the explicit
AI-unavailable behavior deterministically; live provider integration is a
separate operational check and cannot make the local release gate flaky.

The local AI model can be checked and built for browser use from the repository root:

```sh
npm run v2:ai-model:test
npm run v2:ai-model:wasm
```

The WASM build writes the raw `wasm32-unknown-unknown` artifact under `v2/ai-model-rust/target/wasm32-unknown-unknown/release/`. It exports JSON-string functions for the model manifest and avatar identity generation; the shared Rust library also provides speech sanitizers.

From `v2/orchestrator-rust`:

```sh
cargo run
```

The server listens on `127.0.0.1:3102` by default.

## Deploy

The repository root `Dockerfile` builds the V2 release binary and runs `cosyworld-orchestrator`. The root `fly.toml` points at that Dockerfile, mounts `/data`, and runs the orchestrator on port `3000`.

### Shutdown contract

The first `SIGINT` or `SIGTERM` begins a bounded drain. The listener stops
accepting connections, existing SSE responses close so clients can reconnect
with their `Last-Event-ID`, and requests arriving on an existing keep-alive
connection receive JSON `503` responses with `Retry-After: 1` and
`Connection: close`. `/health/live` remains available during the drain so an
operator can distinguish a restarting process from a dead one.

`COSYWORLD_SHUTDOWN_DRAIN_MS` sets the HTTP drain deadline. It defaults to
`3000` and startup accepts only `100` through `4000` milliseconds, preserving
time before Fly's next shutdown escalation. A second signal or the deadline
force-finishes the HTTP server; the final snapshot is flushed after that
bounded drain. Structured `shutdown_signal_received`,
`shutdown_drain_started`, `shutdown_drain_forced`, and `shutdown_complete`
records report timing, signal count, forced drains, and notified or remaining
streams. Clients must treat a closed stream or a draining `503` as a reconnect
boundary and reuse the same `intent_id` when retrying a command.

The production Fly profile requires moderation and the event store. Configure
the protected avatar feed only when linked-avatar discovery is enabled:

```sh
fly secrets set COSYWORLD_PROCESS_ID=public-1
# During migration the old alias may remain, but must match:
fly secrets set COSYWORLD_V2_SHARD_ID=public-1
fly secrets set COSYWORLD_AVATAR_OWNERSHIP_FEED_BEARER=...
fly secrets set COSYWORLD_MODERATION_TOKEN=...
fly deploy
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

The avatar gate begins with an immediate character question and carries that answer through the visible game as the avatar's purpose. A quiet transcript frames `a new tale is waiting`; the completed Begin lands as a visible arrival beat and arms the first resident heartbeat. The new avatar sheet describes moments and people still ahead, calls a local session a `local tale`, and reports the Pack by physical weight rather than a fixed card count.

The browser frames onboarding as `Your first tale`: Notice a clue, watch the Journal settle the earned growth in that same action, then keep exploring or use advancement through a relevant character surface. Chat starts a short system-funded exchange with an eligible nearby resident; Befriend spends one advancement point to begin a friendship and opens a resident picker when several eligible new friends are nearby. Advancement never creates a charm, skill, spell, or weapon card. Remember handles mature friendships separately.

Multi-target verbs stay compact: Take, Use, Give, Trade, Attack, and Chat put legal targets inside one card instead of duplicating hand slots. Long connections remain ordinary segmented geography—Search reveals one adjacent pathway and Travel enters it. Player-facing copy describes story outcomes rather than exposing raw d20, damage, HP, or clock arithmetic. The collapsed room `LOG` names who did what and what changed; the expanded history preserves the audited sequence. That log is also supplied to resident inference, so a delayed reply can refer to cards played and changes that happened in the channel instead of inventing an isolated conversation.

Pathway Scout and Travel remain ordinary dealt actions: discovering a stretch never moves the player, commits them to the destination, or hides room interactions. A player may continue, backtrack, choose another route, stay and act, or Think about one focused card. During an active journey the browser gives that actor a provisional travelling-party treatment with a destination, evolving way name, segmented progress bar, co-present faces, and a travelling-party label over the room transcript. This remains orientation rather than shared-party authority: `JourneyState` is actor-scoped, the faces are not certified Company members, conversation is still room-scoped, and every actor moves independently. [ADR 0009](../docs/decisions/0009-companies-ventures-formations-and-shared-travel.md) defines the accepted replacement—consensual Company membership, a shared Venture, Formation and readiness, vehicles as independent world objects, atomic departure for the ready subset, detachments, and honest route/voyage/Delve progress. Destinations remain places (`Emmaus`); connective names such as `Road to Emmaus` belong to the way system, whose current traffic-derived presentation grows from unmarked way through track, cairn path, trail, road, avenue, and highway. ADR 0009 requires a future replay-compatible revision to distinguish wear, wayfinding, construction, maintenance, and normalized use rather than letting raw per-edge traffic stand in for every kind of development. Each revealed waypoint atomically joins the authoritative room and simulation projections as risky frontier with three derived milestones: a durable fixture earns Anchor, an actor-causal physical delivery earns Connection, and three non-repeatable contributions from at least two avatars earn Settlement. Settlement opens a bounded building proposal, extended only by revealed natural features; it does not create a sanctuary or construct anything. `choice` keeps the policy and alternatives in Journal, while `support`, `choose`, and explicit delegation write one-line Journal events through a replayable governed-choice state machine; selection preserves every support record and never depends on controller kind, title, Calling, or practice. The browser uses authored location art; the unfinished pathway/dungeon SVG renderer is not part of play.

A governed selection now claims one major footprint and opens a shared construction question rather than completing a building; completion installs only pack-authored capabilities, leaves natural features intact, creates no passive cargo, and exposes its clocks, empty reward caches, recipe tags, and bounded follow-up work to avatars through room state without adding main-page panels.

Authored search reveal percentages are real per-attempt thresholds. Candidates
are checked in deterministic priority order, and when every roll misses the
search reveals nothing rather than forcing the first hidden candidate.

The Story Hand never deals a standalone growth-settlement or generic bracelet card. A successful Notice records and settles its earned marks in one authoritative action while leaving ordinary discovery reachable. Pack & Loadout exposes `Make room for <Charm>` only when the current bracelet is full, that specific unworn charm is carried, earned advancement is ready, and the slot cap has not been reached. Spending opens one slot without creating or equipping the charm. The room stays chat-first; the `Journal` button beside the location name opens an image-only daily Journal. Short rests append private Journaler context, while the first hearth/long rest for an avatar on a UTC day publishes at most one first-person generated page image. Raw events, room memory, open threads, meters, and growth sheets never render in the book.

Generated avatar titles are short portable card epithets rather than room descriptions. Model-added suffixes such as `at The Cosy Cottage` are removed on creation and when older profiles are replayed, so arrival copy names the room once and the title still makes sense after travel. Identity generation asks for a small fondness, harmless habit, and gentle curiosity; a server-side tone guard repairs titles, descriptions, visual prompts, and older profiles that drift into grudges, ravenous scheming, hostility, cruelty, or villain language.

After `Your first tale` finishes, the client may derive one grounded **room thread** from projected world state: a wanted gift, urgent care, shared work, danger, an open path, something still hidden, a nearby voice, or finally the room's authored hook. That client-only suggestion cannot reorder or annotate the authoritative Story Hand. The server-authored first-tale projection is the only story guide that may pin and label a matching Story card.

Choice-bearing cards keep one confirmation flow while making the selected option feel concrete. Avatar, Item, Location, Give, Trade, Travel, Take, Attack, friendship, and mixed Use choices carry their corresponding cards; selecting another option immediately swaps the preview and accessible image name. Portrait and square art use a contained preview instead of being cropped into the wide action frame.

For the current browser MVP smoke, run the single-writer service without wallet
or ownership configuration:

```sh
COSYWORLD_ENABLE_DEV_RESET=1 \
cargo run
```

Then from the repository root:

```sh
node v2/scripts/smoke-browser.mjs
```

The browser smoke uses Playwright from `v2` when available, or the sibling
`../app-ruby-high` workspace in this development checkout. `npm run v2:smoke`
runs both the deterministic visual/accessibility pass and the longer
living-world journey. Together they verify runtime metadata, avatar creation,
actor-session continuity, one-button wallet-free play, zero-Orb
earning-action priority, no-typing `listen`, bounded Chat, advancement-backed Befriend,
contextual resident heartbeats, moderation/report flows, two-browser
fanout and presence leave, compass/typed command behavior, weighted-deck item
take/drop/retake behavior, multiple loose cards at one location, reload
continuity, contextual verb labels, viewport fit, seed-card art, public travel,
resident item handoffs, project-clue use and completion,
autonomous resident delivery, emoji-only speech accessibility, and protected
resident/human action boundaries.

When the mobile and desktop visual shell checks pass, the smoke writes viewport screenshots plus JSON metadata and SHA-256 hashes to `v2/orchestrator-rust/.runtime/visual-smoke/`. It also compares those screenshots against the committed PNG baselines in `v2/tests/visual-baselines/` with a 3% max pixel mismatch ratio. Set `COSYWORLD_VISUAL_SNAPSHOT_DIR=/path/to/output` to collect runtime artifacts somewhere else, or run `COSYWORLD_UPDATE_VISUAL_BASELINES=1 node v2/scripts/smoke-browser.mjs` after an intentional UI change to refresh the baselines.

Enable AI-backed resident replies with an OpenAI-compatible provider:

```sh
COSYWORLD_AI_API_KEY=... COSYWORLD_AI_MODEL=openai/gpt-5.6-luna cargo run
```

OpenRouter works too:

```sh
OPENROUTER_API_KEY=... OPENROUTER_CHAT_MODEL=mistralai/mistral-nemo cargo run
```

OpenRouter development defaults keep avatar voice on the small Mistral Nemo
route while `intent_json` and `world_content` use `openai/gpt-5.6-sol`.
Override the higher-power lane with `OPENROUTER_METACOGNITIVE_MODEL`.

OpenRouter readiness begins with an immediate bounded `/key` probe and is
reported without balances or secrets at `/meta.ai.readiness`. HTTP 401/402
blocks the account until a later successful scheduled probe; 429, 5xx, and
transport/timeouts cool down only the exact endpoint-and-model route. Affected
Chat and exact-model offers are withheld and revalidated on submission, while
deterministic play and `/health` remain healthy. Set
`COSYWORLD_AI_LOW_CREDIT_THRESHOLD` to a finite value from 0 through 10000
(default `5`) for a warning-only `ai_credits_low` signal before exhaustion;
invalid values stop startup. Room-scoped Chat completions also send one stable
OpenRouter `session_id` per canonical room. Resident speech, planning,
reflections, and room-memory summaries from the same room therefore share
sticky routing and observability grouping; non-room inference and other
providers do not receive that OpenRouter-specific field.

Resident action selection can use the pure-Rust all-card ranker while the LLM
only narrates the already committed instinct. Start with shadow mode; live mode
is currently scoped to moderator-created treasure objectives:

```sh
COSYWORLD_CARD_POLICY_MODE=shadow
COSYWORLD_CARD_POLICY_MODEL_PATH=../../output/card-policy/card-policy.cwrank
COSYWORLD_CARD_POLICY_TOP_K=3
```

See [`docs/card-policy-ranker.md`](docs/card-policy-ranker.md) for synthetic
training, population simulation, objective collection, per-avatar online
history, promotion gates, and live rollout behavior.

Optional overrides:

```sh
COSYWORLD_AI_BASE_URL=https://api.openai.com/v1
COSYWORLD_AI_PROVIDER=openrouter
COSYWORLD_AI_VISION_MODEL=openai/gpt-5-image-mini
COSYWORLD_AI_VISION_REASONING_EFFORT=low
```

Text selection can instead use a versioned capability registry and
capability-specific configured defaults:

```sh
COSYWORLD_AI_REGISTRY_JSON='{"schema_version":1,"snapshot_version":"catalog-1","declared":[...],"discovered":[...]}'
COSYWORLD_AI_CAPABILITY_MODELS_JSON='{"voice":"provider/tiny-chat","intent_json":"provider/planner","world_content":"provider/generator"}'
```

The immutable snapshot may retain hundreds of candidates, but a request pins
and sends only one. Provider discovery never grants eligibility by itself,
mutable aliases require concrete returned-model attribution, and production
operator-registry inference fails closed unless the selected declaration
explicitly prohibits retention and training. Pack-bound exact interactions are
separate: their inputs contain only server-authored world, catalog, and visible
room-message facts, so both ZDR and non-ZDR endpoints are eligible while profile
metadata preserves
the truthful policy. A ZDR profile adds the provider privacy constraint; a
non-ZDR profile does not pretend otherwise. See
[`docs/ai-capability-registry.md`](docs/ai-capability-registry.md) for the
schema, capability boundaries, privacy contract, and replay provenance.

Elysium's checked-in per-model interaction snapshot distinguishes provider
availability from implemented runtime support. Ready exact models use native
`Talk`, `Illustrate`, `Speak`, `Find resonance`, or `Rank echoes` paths. Raw
Talk sends no blanket reasoning control: only models advertising the parameter
start with effort `none`, and one precise HTTP 400 may retry with mandatory
reasoning enabled-and-excluded or with an unsupported reasoning object omitted.
Unsupported modalities are withheld rather than misrouted as Chat.
Transcription remains dormant because there is no microphone, upload, or
player-authored speech surface; asynchronous video, mixed audio/music, and
vector-only SVG output await dedicated safe adapters. Players choose only a
certified actor and target—there is no arbitrary speech or prompt input.
`Find resonance` freezes the latest visible room message as its query and up to
eight earlier visible room messages as its corpus, then publishes the three
closest earlier messages without exposing vectors. `Rank echoes` gives the
same frozen corpus to the exact rerank model. Both actions remain unavailable
until at least four earlier messages exist, so the three published results are
selected rather than merely echoing the entire corpus.

Server-side generative world content is separately controlled and defaults to
off. Enable only reviewed features, or run them in shadow mode to validate and
audit proposals without publishing them:

```sh
COSYWORLD_GENERATION_DEFAULT_MODE=off
COSYWORLD_GENERATION_FEATURE_MODES_JSON='{"pathway_content":"auto_bounded"}'
```

`pathway_content` generates the hidden name, title, description, persona, and
landscape detail for every waypoint when an Explorer first opens a route. The
server requires strict structured output and validates every narrative field;
invalid, unavailable, disabled, or shadowed generation keeps the deterministic
fallback. Generated names are stored in the pathway snapshot but are shown only
as their corresponding Explore edges are revealed. AI cannot alter topology,
movement, access, danger, jobs, clocks, inventory, rewards, or economy state.

Generate Avatar can also draw a full avatar card through Replicate. The server
downloads the returned image immediately and stores the full bytes plus content
type locally, so temporary Replicate URLs can expire safely:

```sh
REPLICATE_API_TOKEN=...
COSYWORLD_REPLICATE_AVATAR_MODEL=black-forest-labs/flux-dev-lora
COSYWORLD_REPLICATE_AVATAR_LORA=immanencer/mirquo
COSYWORLD_REPLICATE_AVATAR_LORA_INPUT=lora_weights
COSYWORLD_REPLICATE_AVATAR_LORA_SCALE_INPUT=lora_scale
COSYWORLD_REPLICATE_AVATAR_PROMPT_PREFIX="MRQ, cozy storybook trading-card portrait"
COSYWORLD_GENERATED_ASSET_DIR=/data/generated
```

Optional Replicate overrides include `COSYWORLD_REPLICATE_AVATAR_VERSION` for a
pinned prediction version, `COSYWORLD_REPLICATE_AVATAR_LORA_INPUT` and
`COSYWORLD_REPLICATE_AVATAR_LORA_SCALE_INPUT` for model-specific LoRA parameter
names, `COSYWORLD_REPLICATE_AVATAR_LORA_SCALE`,
`COSYWORLD_REPLICATE_AVATAR_OUTPUT_FORMAT`, and
`COSYWORLD_REPLICATE_AVATAR_INPUT_JSON` for additional input fields. Existing
local setups that define `REPLICATE_BASE_MODEL`, `REPLICATE_LORA_WEIGHTS`,
`REPLICATE_MODEL`, `REPLICATE_LORA_TRIGGER`, or `LORA_TRIGGER_WORD` are also
supported as fallbacks.

The provider-neutral media registry in `media/recipes.json` freezes model
revision provenance and the capability contract used before a Replicate
request. FLUX.2 calls use their pinned version ID; FLUX.1 LoRA remains the
default zero-reference community-art recipe and retains its existing
official-model invocation.
`COSYWORLD_MEDIA_RECIPE_CONTROLS_JSON` can deterministically canary, disable,
fall back, or roll back an allowlisted recipe without changing world state. For
example:

```sh
COSYWORLD_MEDIA_RECIPE_CONTROLS_JSON='{"canaries":{"cosyworld.community-art.base/1":{"recipe":"replicate.flux2-dev.references","percent":5}},"disabled_recipes":[],"profile_overrides":{}}'
```

Unknown fields, profiles, recipes, disallowed profile targets, and canary
percentages above 100 fail before recipe selection.

Reference-capable callers pass an ordered typed list of `location`, `actor`,
`item`, `prior_level`, or `style` inputs. Resolution preserves that list
exactly and rejects unsupported or over-limit jobs before provider submission.
The pinned FLUX.2 revision accepts at most four references, custom dimensions
from 256 through 1440 in multiples of 32, and an optional reproducibility seed.

Ready community art is also captured in
`$COSYWORLD_GENERATED_ASSET_DIR/media-assets/graph-v1.json`, with immutable
content-addressed objects below `media-assets/objects/sha256/`. A record
includes digest/dimensions/MIME, stable storage, subject level and revision,
worldpack/composition provenance, provider/model/prompt/prediction history,
rights, moderation, and complete parent reference lineage. New output remains
ineligible until its `ready` journal transition commits. Replacement advances
only the approved canonical pointer; old objects, records, lineage, and
moderation history remain audit evidence. The generated community-art route
backfills approved legacy FLUX.1 files on first read without regeneration.

Reference resolution accepts authoritative typed subject slots rather than
caller URLs, verifies approved canonical objects by digest, and orders them
deterministically. It resolves canonical history as of the request's journal
boundary, while causal revisions make same-subject ingestion order irrelevant.
Durable ready/rejected evidence idempotently reconciles graph state after a
restart, and an in-flight moderation transaction persists a fail-closed
reference hold until its journal result is known. Missing, corrupt, pending,
rejected, private, deleted, and rights-ineligible assets fail before provider
spend. Authored, on-chain, and imported art is non-derivable by default.
Requests over a recipe's reference budget require an explicit composition
plan.

Avatar art prompts start with the configured LoRA trigger and combine a stable,
persisted physical description with the avatar's current species, origin,
class or classless state, level, calling, location, and carried/equipped items.
Item and location generations likewise include their authoritative card and
world details plus committed public history. Every actor, item, and location
candidate is withheld until the configured vision model approves its frozen
subject-specific publication policy; locations additionally forbid people,
characters, creatures, text, logos, and watermarks. Before any Orb contribution
commits, the server resolves that exact frozen brief and media recipe, checks the
provider route, probes candidate/quarantine/publication and verdict storage, and
passes a known-safe base64 fixture plus the real policy through the strict
JSON-schema reviewer. Failures return a stable subject-neutral `error_code` with
zero debit. Each downloaded candidate is stored before review, so a review
outage or restart retries the saved bytes without another Replicate prediction.
Policy-rejected candidates may be replaced, but provider attempts are journaled
and capped at three for that card level; after the cap, the browser disables
retry and states that no more provider credits will be used. Persisted verdicts
retain actual reviewer attempts and latency. Unavailable or invalid review
leaves deterministic fallback art visible.

`Chat` appears only when the avatar has banked advancement and an eligible nearby resident can become a new friend. Playing it spends one advancement point, creates the Bond, and passes the room turn; it never accepts human text or spends Orbs. No human-authored room-speech command or endpoint is exposed.

Every successful scene-card play atomically arms one delayed room heartbeat. Roughly three seconds later, the next active resident in authored card order may answer. A room can have only one pending or running heartbeat, so rapid plays coalesce rather than building a reply queue. The resident prompt includes the triggering event, recent played-card/log entries, recent room lines, cast, location memory, current goals, and resident continuity. Accepted speech is validated against the resident's prose, emoji, or emote contract, committed through `CW_ACTION_SAY`, and broadcast as a shared world event.

The MVP economy is enabled by default:

- New human avatars receive 3 Orbs.
- `Chat`, room heartbeats, and repeat `Listen` cost zero Orbs.
- `Listen`, `Attack`, and `Flee` can award Orbs from committed kernel events.
- Automatic Orb rewards are claim-key gated by actor/context so repeated identical outcomes cannot mint duplicate rewards.
- Eligible generated card modals pool one Orb per contribution until the total equals the card's level; each level unlocks one history-aware shared image.
- Orb mutations and AI usage are persisted to SQLite ledger tables when the event store is enabled.
- Historical Box and pack rows remain absent from ordinary state and have no
  burn/open route or current ownership effect.
- `/moderation/economy` returns recent Orb/AI ledgers, historical Box/pack rows,
  and ownership reconciliation runs. Open anomaly runs can be resolved
  idempotently with moderator identity and notes through
  `/moderation/economy/reconciliations/{run_id}/resolve`.

CosyWorld mechanical time is player-powered: clocks, danger, placement, seasons, and resident actions do not advance merely because wall-clock seconds pass. A committed scene card may arm one speech-only room heartbeat after a short delay. The durable player-tick observation is stored atomically with the card outcome; later cards while that room heartbeat is pending or running do not stack another reply. When the heartbeat runs, it selects the next active resident in stable authored card order and supplies both the triggering card and the latest authoritative room log. When inference is unavailable or invalid, the deterministic card outcome remains committed and speech is skipped rather than replaced with stock dialogue. Group chat contains only committed speech; card outcomes remain in Journal. Player actions can also fan out into lifecycle hooks, frontier danger/progress clocks, and player-turn encounter resets through the audited journal path.

By default, runtime state persists to:

```text
v2/orchestrator-rust/.runtime/cosyworld-v2-snapshot.json
```

Append-only source actions and projected event history persist to:

```text
v2/orchestrator-rust/.runtime/cosyworld-v2-events.sqlite
```

The event store runs in WAL mode with `synchronous=NORMAL`: readers never
block behind the single writer, and commits stay crash-safe without an fsync
per accepted action. Expect `*.sqlite-wal` and `*.sqlite-shm` sidecar files
next to the database; back up all three together or use the SQLite backup
API. The schema initializes once per store and is stamped into
`PRAGMA user_version`; a deleted or replaced store re-initializes on the next
write.

Override or disable persistence with:

```sh
COSYWORLD_V2_SNAPSHOT_PATH=/tmp/cosyworld-v2.json cargo run
COSYWORLD_V2_EVENT_DB_PATH=/tmp/cosyworld-v2-events.sqlite cargo run
COSYWORLD_V2_SNAPSHOT_PATH=off cargo run
COSYWORLD_V2_EVENT_DB_PATH=off cargo run
```

The canonical lease defaults to 30 seconds. Local failure tests may override it
with `COSYWORLD_CANONICAL_LEASE_TTL_MS` (1000–300000). An expired or superseded
owner is rejected by SQLite; mutations are never buffered for a later merge.

Multi-process convergence additionally requires a shared event DB and both
`COSYWORLD_CANONICAL_ROUTE_URL` and `COSYWORLD_CANONICAL_ROUTER_TOKEN`. The URL
must be a directly targetable origin for that exact process, not the ordinary
shared player load balancer; the token must be a shared secret of at least 16
characters. Leave both unset for the supported one-task production shape. See
[`docs/canonical-world.md`](docs/canonical-world.md) for the routing, invite,
presence, and remaining scale gates.

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
[P]     Think (replace the focused card; free once on entering a safe scene)
[Q]     quit
```

The client presents the server-authored Story, Self, and Anchor slots. Each action has one of four suits—Head, Heart, Honor, or Hustle—plus an exact verb, source, state, provenance, cost, risk, and effect. Think replaces only the focused slot: the first Think after entering a safe scene is free, while later Thinks and every Think in a risky or ordered scene consume the turn. `/commands` remains a narrow text convenience for room inspection, reporting, and safety; state-changing scene play requires a current offered certificate.

See [Story Hand](docs/story-hand.md) for the complete suit meanings, slot rules,
presentation contract, and player vocabulary.

Normal play prefers concrete room verbs such as `Take`, `Use`, `Notice`, `Inspect`, `Scout`, `Travel`, `Contribute`, `Flee`, or `Chat` from the ranked action-offer list. Notice receives an ambient lead, Inspect names the thing being examined, Scout names a destination while revealing only its next route segment, Travel moves there, and Contribute groups every authored Work, Help, Check, Study, or Use Item strategy in one project slot. Every choice submits its exact strategy ID through the same route; the server derives the ability, DC, or item from worldpack content. Each offer carries typed metadata for UI/tooling: semantic intention, pack-authored verb, target, accessible label, project and progress-clock identity, category, cost, risk, effect, claim key, source, zone, rank, and disabled-state. Packs may replace the displayed vocabulary without changing those stable semantic roles. Empty group chats render a quiet room vignette instead of a debug placeholder or synthetic log row.

The current location tab participates in the same one-button surface: focusing it changes the command to `listen`, rolls a kernel-owned Wisdom check, and writes the auditable result into Journal. Combat outcomes likewise stay in Journal instead of leaking rolls, damage, knockouts, or fleeing into group chat.

You can connect the CLI to an existing server, or use the typed command shell explicitly. Command mode supports inspection, reporting, and safety controls; scene play uses the same current offer ids as the browser. `events` and `watch` replay only the active actor's current-room events, filtering hidden presence bookkeeping:

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

When `/avatar` receives a signed `wallet_session`, the server treats the command as recover-or-create. The first call creates the human actor, records a durable wallet-to-avatar link, and returns an actor session. Later calls with the same signed wallet session recover that same present human actor — active or knocked out — and issue a fresh actor session without emitting duplicate `actor.created` world events. Knockout never mints or links a replacement identity. Dev reset clears those links along with the reseeded world.

A knocked-out avatar stays in the world and holds a valid session, so its state answers with the release path rather than a playable hand: `primary_action` is `abandon_avatar`, `action_offers` is empty, and `search_available` is false. `POST /actions/abandon-avatar` frees the account to begin again and leaves the fallen avatar behind as a resident. Offer filtering never replaces an avatar lifecycle action with `wait`, and the browser never builds a card the server did not deal, so a downed player always keeps a way back into play.

`POST /avatar/session` renews credentials only for the same canonical actor. A current actor session may rotate itself; an expired actor session requires the signed wallet already linked to that actor. The route returns `409` for a terminal actor and never creates an avatar. Browser action retries use it once after a credential-specific failure and reuse the original command intent.

Room presence is intentionally narrower than durable avatar existence. A human avatar persists in the world and can return with its actor session, but other players only see that human in room presence while the actor session has been touched recently by state/action/stream/presence traffic. Typed `look`, `who`, and `/state` use the same current-room roster projection. The one bounded exception is a lapsed avatar who still owns a focused turn: that holder stays visible until turn recovery hands off, but remains absent from actor-target offers and commands. The browser and terminal clients maintain explicit presence heartbeats. NPC residents stay visible according to world placement.

Visible actors, items, and locations now resolve through `state.cards`:

- actors use tall card art and render as round portraits in compact controls;
- items use square card art;
- locations use wide card art in the top tab and travel controls;
- Ruby High cards carry First Bell catalog/on-chain metadata;
- CosyWorld seed cards use the same shape with generated mini art served from `/assets/generated/cards/{card_id}.webp` until the card pipeline adds full reviewed media records.

The `ruby-high.first-bell` pack supplies the 24 live Ruby High: First Bell card profiles, covering students, teachers, special cards, items, and locations. Exposed First Bell cards use `/assets/cards/{card_id}.png`; the active registry resolves that prefix through the pack's `ruby-high.first-bell/assets` capability. A materialized asset is served locally when present, otherwise the mount's declared `external_uri` fallback redirects to the catalog's pinned chain image URI. The runtime projects the matching set number, profile id, subject, rarity, aspect, and Arweave image URI into `state.cards` without reading a sibling repository.

The browser needs no wallet for ordinary play. A supported linked-avatar flow
starts only after signing a wallet challenge:

- `GET /wallet/challenge?wallet_address=<base58 public key>` returns the exact message to sign.
- `POST /wallet/session` verifies the Ed25519 signature and returns a short-lived `wallet_session`.
- The linked-avatar adapter uses `wallet_session` to discover verified
  allowlisted avatar assets and recover their durable actor bindings.

The Identity surface exposes this as **link avatar wallet**. Travel, items,
actions, and mounted content do not inspect wallet ownership.

For local adapter development, provide an avatar-only fixture:

```sh
COSYWORLD_AVATAR_OWNERSHIP_FEED='rati-wallet:rati' \
cargo run
```

The same protected adapter snapshot can be loaded from a file:

```sh
COSYWORLD_AVATAR_OWNERSHIP_FEED_PATH=.runtime/avatar-ownership.json cargo run
```

Production-style deployments can point at a trusted server-owned JSON feed:

```sh
COSYWORLD_AVATAR_OWNERSHIP_FEED_URL=https://ruby-high.ai/api/apps/ruby-high/nft/internal/cosyworld/wallet-cards \
COSYWORLD_AVATAR_OWNERSHIP_FEED_BEARER=... \
cargo run
```

The remote feed is fetched on startup and refreshed every 60 seconds by
default. Refresh failures keep the last good avatar index and do not affect
ordinary play. Requests use a 15-second total timeout by default, bounded to
1–60 seconds through `COSYWORLD_AVATAR_OWNERSHIP_FEED_TIMEOUT_SECS`; `/meta`
reports the linked-avatar adapter status and transport-aware error code. Tune
the loop with `COSYWORLD_AVATAR_OWNERSHIP_FEED_REFRESH_SECS`; set it to `0` to
disable background refresh. Former `COSYWORLD_ENTITLEMENT_FEED_*` and Ruby High
names remain deployment aliases only. Historical Box/pack receipts are never
merged into this adapter index.

For a public deployment, turn on the explicit production profile:

```sh
COSYWORLD_DEPLOY_PROFILE=production \
COSYWORLD_MODERATION_TOKEN=... \
cargo run --release
```

Add the avatar feed URL and bearer only when that optional adapter is enabled.

`COSYWORLD_DEPLOY_PROFILE=production` boots the default composition with no
wallet, chain, or ownership feed. When AI credentials or a loopback AI endpoint
enable inference, it also requires an explicit, reviewed
`COSYWORLD_AI_REGISTRY_JSON`; omit all AI credentials and the local endpoint to
disable AI. Startup still aborts if the SQLite event store is disabled,
moderation is not configured, or local dev shortcuts are enabled. When an
avatar feed URL is configured, production requires its bearer and reports the
sanitized adapter state under `/meta.linked_avatar_adapter`.

Runtime event-store health is exposed at `/meta.persistence.event_store` and in the moderation console. Failed secondary appends are retained by sequence and retried every five seconds; SQLite insertion is idempotent, so recovery drains the queue without duplicating events. A `degraded` status, nonzero pending count, or consecutive read/append failures is an operator incident: restore volume capacity/permissions before restarting the process, then confirm the status returns to `healthy` and the pending count reaches zero. Journal-backed player mutations already fail atomically when their SQLite transaction cannot commit.

The local production-profile smoke uses the same guardrails without real Ruby High credentials:

```sh
cargo build
node v2/scripts/smoke-production-profile.mjs
```

It launches a temporary bearer-protected avatar-only ownership fixture, starts
the orchestrator with `COSYWORLD_DEPLOY_PROFILE=production`, and verifies
production mode, moderation, persistence, disabled dev shortcuts, a signed
wallet challenge/session, and the sanitized linked-avatar adapter contract.

Chat is a bounded avatar-to-resident exchange, not a human text box, branch picker, or friendship purchase:

- When an inference-controlled, unblocked, unmuted resident is actively nearby, the browser offers `Chat`; a resident picker appears when several targets qualify.
- The server validates the actor session, target resident, shared location, rate limit, and current presence before queuing one durable exchange.
- A successful exchange emits exactly four authoritative `message.created` events—two lines from the player's avatar and two from the resident—through the normal journal and SSE feed.
- Chat spends neither an Orb nor advancement and does not create a Bond. A rapid retry reuses the active durable job instead of starting a duplicate exchange.
- The separate `Befriend` action spends one advancement point and creates a Bond when `create_bond` is legal.
- If inference, context, or commit fails, the server emits a visible `chat.failed` status instead of silently doing nothing or substituting canned dialogue.
- Clients cannot author arbitrary room messages. Only server-produced dialogue and dice calls enter group chat.
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

World items use explicit shared scarcity. Each canonical item id is one world object regardless of which capacity process serves a player, so overlapping desires are competing social hooks rather than private quest reservations. Pickup, gifting, trade, evolution placement, and crafting move or reference that same object; evolution and crafting do not consume their inputs. A resident's economy panel reports the item's authoritative current state—waiting in a room, not yet found near its seed room, currently held by someone, or already spent—in addition to the resident's fallible memory. External ownership never contributes world supply. `npm run v2:worldpack:inspect` prints demand against the canonical world for every desired, attached, evolution, or recipe input item, and `--report-json` exposes the same audit as `world_item_economy`.

The Rust host loads seed actor placement/stats, faction definitions, item descriptions/placement/kinds, location labels, directed exits, combat flags, access gates, complete room RPG sheets, jobs/fronts, lifecycle/effect descriptors, and level-2 evolution tracks from the compiled `content/official/` worldpack. `worlds/official/world.json` selects independently versioned source packs and `pack.lock.json` pins their exact versions, hashes, dependency closure, capabilities, ID-mapping version, licenses, and provenance. The compiler also emits deterministic `pack://` content references and compact runtime handles in `content_refs.json`; snapshots, journals, and stored events persist those canonical identities with pack and ruleset context while the C ABI continues to use numeric handles. Startup tests and `npm run v2:worldpack` validate the Manifest v1 contract, a current lock and byte-deterministic bundle, unique ids, valid references, canonical one-direction-per-room exits, every location having a complete room sheet, seeded kernel parity, faction opposition links, frontier-only front links to jobs and danger clocks, lifecycle hook and clock-fill effect descriptors with reasons, and exactly two unique items for each evolution track. The validator also warns when a combat-capable room has no active local encounter or when a faction has neither seeded members nor an explicit player-facing role. The C kernel still owns rule enforcement for movement, speech event emission, item transfer, and evolution, with its evolution track table configured from the worldpack at boot.

Factions are content-backed opposing forces rather than hard-coded teams. `content/core/factions.json` defines each faction's axis, mirrored opposition, protected truth, shadow failure mode, verbs, motifs, home locations, member actors, and whether players can embody a faction that intentionally has no seeded resident. Global faction state remains internal; players learn about factions through their current room, cards, and Journal rather than a world-inspection API.

Those factions now move through played-time world pulses rather than remaining metadata. A pulse changes ambient weather and opportunity-level trade on a distant frontier route, lets influence propagate, and derives visible conflict pressure from the combined result. The World Library shows each beat's class and response, and entering an affected room reveals its present weather, supplies, faction signs, or tension in story language. Automatic pulses never mutate sanctuary state, never create stakes from an unrelated action, and never run while the world is idle.

Resolved frontier encounters can reopen on later player turns. The Moonlit Trail reset path waits for a player-powered season gap, then a committed player action in that frontier clears the spent progress/danger clocks, clears resolved-state tags such as `quieted moonlight`, revives the encounter participant, emits `encounter.reset`, and makes combat/project actions available again for late arrivals.

## Shared Live Rooms

Locations are live channels:

- `/state?actor_id=...` returns the actor's current location, visible presence, available actions, active-human room turn state, and room-scoped recent events.
- `/stream?actor_id=...&actor_session=...&wallet_session=...` broadcasts accepted world events over SSE only for the authenticated actor's current room. SSE messages include the world event sequence as their event id, and reconnects can replay missed visible events with `after=<seq>` or the native `Last-Event-ID` header.
- `/events` uses the same current-room boundary. A request without `after` reads the latest retained events from the room-indexed canonical feed, so activity elsewhere cannot evict a quiet room's browser transcript; its `next_after` cursor advances to the observed world head before SSE connects. Wallet/card entitlements do not widen replay into other rooms, and clients cannot traverse the world graph through event history.
- Human presence in `/state` is filtered to the current actor plus recently touched actor sessions in that room, with the temporary focused-turn-holder exception used by MUD room rosters.
- `/presence/ping` and `/presence/leave` require the matching actor session and emit hidden `actor.presence` events only when the active-presence state changes.
- When two or more active human avatars share a room, `/state.turn` names the human whose card play is live. A newcomer still receives one welcoming Listen card before joining the room rhythm, and that courtesy action does not steal or advance the current player's place. Journal settlement is part of successful discovery rather than a separate waiting-room card. Loadout changes live in Pack & Loadout and do not take the shared room turn. The gentle Nudge / I'm here handoff remains beside scene choices instead of exposing technical timeout or initiative language. A nudge opens an eight-second room wait; players who answer are eligible for the next choice if the current player is away.
- The browser appends only `message.created` speech and dice-call pills to group chat. Combat outcomes and other matching live events refresh state, remain in the location's Journal, and may appear as dismissible important alerts. Lantern Keeper actions additionally end in one persisted `story.receipt`.
- An active Lantern Keeper scene promotes one shared question outside the Journal with fiction-first situation text, exact progress and danger meters, the completion change, the current danger beat, and its fill consequence. Its rationale list is derived from the same two-entry authoritative action hand as the playable cards; screen-reader labels say `suggestion 1 of 2` and `suggestion 2 of 2`, never count the larger legal offer set. Browser, `look`, CLI reconnect, stale-offer refresh, journal replay, success, and failure all project the same question state. Once either clock resolves it, the live task bars retire to a concise public memory naming its contributors.
- The Lantern Keeper's light and darkness clocks directly declare their own justified fill effects. Each terminal fill journals exactly one authoritative job outcome and one authored `story.receipt`; retry, reconnect, and journal replay cannot duplicate either. Official worldpack validation requires both direct declarations, their expected completed/failed status, and an authored reason, and rejects a missing, tag-only, or duplicate lifecycle source without imposing the Lantern contract on other pack compositions.
- Moving between locations swaps to that room's transcript instead of carrying the prior room log forward.

This keeps AI output one-to-many: a resident reply is committed as a world event and broadcast to everyone present, not regenerated as a private response for each player.

Dialogue prompts keep the latest 16 spoken lines per room in a bounded, snapshot-backed buffer and add up to ten recent successful non-speech room-log entries. This lets residents refer to cards just played and changes recorded in the channel, even when other rooms are busy. Newer log entries are authoritative when older context conflicts.

## Endpoints

- `GET /health`
- `GET /meta`
- `GET /licenses`
- `GET /content-packs`
- `GET /state`
- `GET /state?actor_id=5000&actor_session=<session>`
- `GET /state?actor_id=5000&actor_session=<session>&wallet_session=<wallet-session>`
- `GET /world`
- `GET /inspect`
- `GET /events`
- `GET /events?after=12&limit=80`
- `GET /moderation`
- `GET /moderation/activation?limit=80` with `Authorization: Bearer <COSYWORLD_MODERATION_TOKEN>`
- `POST /moderation/activation/{player_ref}/delete` with `Authorization: Bearer <COSYWORLD_MODERATION_TOKEN>`
- `GET /moderation/events?after=12&limit=80` with `Authorization: Bearer <COSYWORLD_MODERATION_TOKEN>`
- `GET /moderation/reports?after=12&limit=80` with `Authorization: Bearer <COSYWORLD_MODERATION_TOKEN>`
- `POST /moderation/reports/{report_id}/resolve` with `Authorization: Bearer <COSYWORLD_MODERATION_TOKEN>`
- `POST /moderation/reports/{report_id}/delete` with `Authorization: Bearer <COSYWORLD_MODERATION_TOKEN>`
- `POST /moderation/community-art/{subject_kind}/{subject_id}/reject` with `Authorization: Bearer <COSYWORLD_MODERATION_TOKEN>`
- `POST /moderation/actors/{actor_id}/suspend` with `Authorization: Bearer <COSYWORLD_MODERATION_TOKEN>`
- `POST /moderation/actors/{actor_id}/unsuspend` with `Authorization: Bearer <COSYWORLD_MODERATION_TOKEN>`
- `GET /stream`
- `POST /dev/reset` when `COSYWORLD_ENABLE_DEV_RESET=1`
- `POST /avatar`
- `POST /avatar/session`
- `POST /commands` for read controls and certified per-card Think
- `POST /presence/ping`
- `POST /presence/leave`
- `POST /story/world-beat-exposures`
- `POST /actions/submit`
- `POST /actions/report`
- `POST /actions/timeout`
- `POST /actions/unlock-charm-slot`
- `POST /actions/set-charm-equipped`
- `POST /actions/set-spell-prepared`
- `POST /actions/set-item-equipped`
- `POST /actions/set-item-contained`

Every `POST /commands` rejection is a JSON command envelope whose `status`
matches the HTTP status. Malformed requests, extractor failures, rate limits,
and local command-admission overload therefore never fall back to Axum's plain
text error body. The runtime admits at most 16 concurrent public commands;
additional callers fail fast with `503`,
`error_kind: "server_overloaded"`, and `Retry-After: 1`; retrying a mutation
must reuse the same `intent_id`. The Lonely Forest proxy applies the same
contract to upstream `502`/`504` failures, returning a bounded JSON `503`
instead of an empty or HTML response.

There is no collection materialize/unmaterialize route. `GET /meta` exposes
`migration_archive.item_materialization`: the permanent `archived` / `audit_only`
state, disabled mutation flags, and read-only migration receipt counts. Verified
linked-avatar actor receipts are counted separately because the retained actor
adapter is not the retired general item bridge.
`POST /actions/submit` is the canonical scene-mutation gateway. Callers send
the authenticated actor handle and an exact offer from the current Story
hand. The offer payload includes its stable envelope:

```json
{
  "actor_id": 5000,
  "actor_session": "...",
  "offer_id": "cosyworld.srd5/1:92811:move:202",
  "envelope": {
    "world_id": "world://cosyworld/official",
    "intent_id": "client:018f...",
    "actor_ref": "world://cosyworld/official/actor/opaque-id",
    "observed": { "actor_version": 18, "location_version": 402 },
    "last_world_seq": 92811
  }
}
```

The identifier's embedded state revision is checked while resolving the exact
projected offer, and the server rejects offers outside the current hand.
Failures expose `invalid_offer_id`, `stale_offer`, `unknown_offer`, or
`disabled_offer` without world mutation. `/commands` remains limited to
inspection, reporting, and actor safety; movement, item, social, work, and combat mutations cannot use it as a
second API around the hand.

The response includes a durable `receipt` with the same world/intent/actor,
the committed `world_epoch` and `world_seq`, affected canonical entity
versions, and the current fencing epoch. Retry the exact envelope after a lost
transport response. Reusing its `intent_id` for different content or sending a
stale version returns `409` without another effect.

The `canonical_command_receipts` table is the source of truth for those
retries. A stored response carries a full state projection, so the process
keeps only a bounded in-memory cache of the most recent receipts — 128 entries
or 8 MiB, whichever binds first — and a miss reads the durable row. Receipts are
never written into the snapshot; the snapshot is a boot accelerator for world
state, and receipts are recoverable without it. Finalized rows expire after
`COSYWORLD_COMMAND_RECEIPT_RETENTION_DAYS`, which defaults to `14` — far longer
than any live client retry window. Set it to `0`, `off`, `none`, or `disabled`
to keep receipts until manual deletion. Retention runs once at boot and then
daily, and never removes a provisional row still owned by an in-flight commit.
`/meta.persistence` reports the configured retention alongside
`retained_command_receipts` and `retained_command_receipt_bytes`, so cache
growth is observable without reading logs.

`POST /story/world-beat-exposures` accepts an authenticated post-presentation
receipt such as `{ "actor_id": 5000, "actor_session": "...", "exposure_id":
"world-beat:v1:92810", "transport": "browser", "state_revision": 92811 }`.
The server verifies the exact journal event, authored renderability, actor
session, current location visibility, and observed state revision before
recording one idempotent `world_beat_seen` metric. `GET /state` never records
this signal. Browser clients submit only after the transcript row is visibly
rendered; terminal and agent clients acknowledge after presentation with
`cli` or `agent` transport.

Listen, Study, Travel, item, social, work, and combat choices all enter through
`POST /actions/submit`, which revalidates the current Story Hand, offer
identity, rules binding, target, collectible source, and state revision before
dispatch. A current Think certificate submitted to `POST /commands` replaces
its exact Story, Self, or Anchor card. It is free once per safe scene and otherwise consumes one turn. There are no direct mechanical
compatibility routes.

The deterministic `cosyworld.combat/4` protocol includes NPC initiative and
allows only the current participant to play a current combat card or Pass.
Finishing damage is nonlethal at 1 Hit Point. Active encounters are exposed
through `/state.combat`, advertised by `/meta.combat`, journaled as append-only
lifecycle events, and persisted in snapshots. See
[`docs/combat-system.md`](docs/combat-system.md) for the exact surface.

`/health` is intentionally minimal readiness and is not coupled to an AI
provider outage. `/meta` is the deploy/smoke metadata endpoint: package version,
debug/release build profile, deployment profile, canonical
`world_id`/`world_epoch`, capacity `process_id`, matching legacy `shard_id`,
non-secret dialogue feature flags, sanitized `/meta.ai` readiness, persistence
mode, moderation report retention, linked-avatar adapter mode, current world counters,
compiled kernel capacities, and the mounted packs' exact license records. `GET
/licenses` exposes those pack versions, license links, provenance, modification
notices, and bundled attribution text without authentication. `./v2/mvp.sh
status` prints a one-line summary from `/meta`.

`/world` and `/meta` are observational rather than transactional. They read an
immutable runtime projection refreshed every two seconds, so they stay
available while a mutation or persistence operation holds the authoritative
runtime lock; their world counters may trail committed state by that short
window. `/meta.projection` exposes the source world sequence, cache age, current
and last authoritative-lock wait, cache-lock wait, and last refresh duration so
operators can see a lock convoy without probing request latency.

Protected operator audit routes require `Authorization: Bearer <COSYWORLD_MODERATION_TOKEN>`. `/moderation` serves a no-store operator console that stores the bearer token in local browser storage and uses the protected report endpoints; loading the page alone does not expose report data. The console can resolve reports, delete resolved reports, suspend the reporter attached to an open report, and suspend a reported target when that target is a human avatar. Report suspension actions also resolve the report with a suspension note, so the open queue reflects the operator action. Report details show current reporter/target suspension state and can unsuspend suspended human actors from open or resolved reports. `/moderation/events` returns bounded all-room event replay, `/moderation/reports` returns bounded player report queue entries, `/moderation/reports/{report_id}/resolve` closes a report with resolution metadata, `/moderation/reports/{report_id}/delete` removes a resolved report, `/moderation/activation` returns first-session activation evidence plus privacy-safe seventh-visit cohorts, return-signal comparisons, and world-health diagnostics, `/moderation/activation/{player_ref}/delete` deletes one pseudonymous player's story-metric rows, and `/moderation/economy` returns bounded Orb ledger, AI usage ledger, and historical Box/pack audit rows without exposing player OpenRouter keys.

`POST /moderation/community-art/{subject_kind}/{subject_id}/reject` invalidates
ready generated art, removes its served bytes, restores the deterministic
fallback, and preserves full funding so the community can retry without
spending another Orb.

Public action endpoints accept active human actors only when the matching `actor_session` is present. The Rust orchestrator can commit resident speech internally for contextual heartbeat replies and audited resident beats. It exposes no authenticated human speech command or endpoint.

`POST /actions/report` accepts JSON `{ "actor_id": 5000, "actor_session": "...", "target_actor_id": 1001, "reason": "..." }`. The reporter and target must both be in the same room, and human targets must be visible in active room presence. Success returns `200` plus a durable report id for moderator review; reports do not broadcast into the room timeline.

`POST /actions/timeout` accepts JSON `{ "actor_id": 5000, "actor_session": "..." }`. It is available to an active participant waiting on another active participant in an explicitly ordered combat or cooperative-work scene. A successful nudge journals a system Pass for the current holder and advances to the next eligible participant. Refusals return actionable events with stable types: `turn.timeout_refused.requester_holds_turn`, `turn.timeout_refused.participants_below_two`, `turn.timeout_refused.requester_not_eligible`, `turn.timeout_refused.no_focused_scene`, or `turn.timeout_refused.cooldown`. Refusal checks happen before any world mutation.

Public mutation endpoints also pass through lightweight in-memory rate limits before they touch the world reducer:

- Avatar creation: 12 attempts per client IP per 10 minutes.
- Wallet challenge/session: 30 attempts per client IP per minute.
- Chat and friendship cards: 45 attempts per actor per minute, with a broader shared IP mutation cap.
- Player reports: 12 attempts per actor per 10 minutes, with the broader shared IP mutation cap.
- Movement, item, check, and combat actions: 180 attempts per actor per minute, with the same shared IP mutation cap.

Server-authored resident dialogue uses the same durable event contract for replay and SSE broadcast; it is never accepted from client text.

Rate limits are intentionally generous for normal play and local smoke tests.
They are abuse guardrails for the current single-writer process, not a
replacement for full moderation or canonical cross-process routing.

## Moderation

Set `COSYWORLD_MODERATION_TOKEN` to enable protected moderation endpoints:

```sh
COSYWORLD_MODERATION_TOKEN=... cargo run
```

`GET /moderation/events?limit=80` requires `Authorization: Bearer <token>` and returns a bounded chronological replay across all rooms, bypassing player room/card visibility filters for operator review. It uses the same default replay limit of 80 and hard cap of 500 as player `/events`.

`GET /moderation/activation?limit=80` requires the same bearer token and returns avatar creation count, actors who committed a first card turn, actors who reached their first banked Visit Ledger mark, day-one/day-seven activation rates, median time from avatar creation to first card turn and first ledger banking, and recent activation events. Its `story_metrics` section adds UTC-week first-to-second/third/seventh visit cohorts, 30-day return comparisons after solo and social/story signals, health counts for unanswered beats, stalled jobs, stranded items, and quiet rooms, plus recent versioned pseudonymous events. Events are idempotent per actor/key, so repeat state polling, timeout nudges, and repeat ledger banking do not inflate the metrics. Browser smoke verifies that a fresh no-typing first tale appears here with median time to first bank below the ten-minute product target. See [`docs/story-metrics.md`](docs/story-metrics.md) for the definitions, privacy, loss, retry, schema, deletion, and retention contracts and [`docs/seventh-visit-findings.md`](docs/seventh-visit-findings.md) for the pre-registered proof-world decision thresholds.

`POST /moderation/activation/{player_ref}/delete` deletes story-metric rows in which the versioned pseudonymous player reference is the actor or interaction target. The protected report supplies valid references; raw actor handles are rejected.

`GET /moderation/reports?limit=80` requires the same bearer token and returns bounded open player-submitted reports with reporter, target, actor kinds, current suspension flags, room, reason, status, creation timestamp, and optional resolution fields. `after=<report_id>` reads newer reports for incremental queue polling. `status=resolved` returns closed reports, and `status=all` includes both open and resolved rows.

`POST /moderation/reports/{report_id}/resolve` accepts JSON `{ "moderator": "name", "note": "handled" }`, marks the report `resolved`, records `resolved_at_ms`, `resolved_by`, and `resolution_note`, and removes it from the default open queue.

`POST /moderation/reports/{report_id}/delete` requires the report to already be `resolved`; open reports return `409` so operators cannot remove unreviewed reports by accident.

Resolved reports are automatically purged after `COSYWORLD_MODERATION_REPORT_RETENTION_DAYS`, which defaults to `90`. Set it to `0`, `off`, `none`, or `disabled` to keep resolved reports until manual deletion. Retention runs once at boot and then daily; it only removes reports whose status is already `resolved`.

`POST /moderation/actors/{actor_id}/suspend` stores a durable actor suspension, clears the actor's active sessions, emits an inactive `actor.presence` room refresh if the actor was visible, and makes future player actions for that actor return `403`. `POST /moderation/actors/{actor_id}/unsuspend` removes that suspension. Actor moderation responses include `error` on bearer-token and target-validation failures so the operator console can show a concrete failure reason.

Example:

```sh
curl -s -X POST http://127.0.0.1:3102/avatar \
  -H 'content-type: application/json' \
  -d '{"name":"Mira"}'
```

```sh
curl -s http://127.0.0.1:3102/state?actor_id=5000
# Focus one action_hand.entries card and submit its think.offer_id to /commands
# with its canonical envelope; uncertified whole-hand cycling is refused.
```

## Verify

From the repository root:

```sh
npm run v2:worldpack
npm run v2:worldpack:inspect
npm run v2:proof-world -- --strict
npm run v2:kernel
npm run v2:rust:test
```

`npm run v2:worldpack` is the terse pass/fail content gate. It first proves that pack integrity and the compiled official bundle are current, validates the assembled world and standalone compositions, then runs the strict [Cottage Pact proof-slice](docs/pact-proof-world.md) gate. That gate covers the eight-room density contract, free first contribution, three renewable care loops, both fronts' solo/cooperative paths, public return beat, and visits one through seven. `npm run v2:worldpack:inspect` runs the same worldpack validation and prints a builder report with the bundle hash, pack count, room gates, exits, actors, items, world-item supply/demand, features, clocks, jobs, lifecycle hooks, and evolution tracks. Use `node v2/scripts/check-worldpack.mjs --report-json` when another tool needs the same report as structured JSON. Use `npm run v2:worldpack:lock` only after an intentional source-pack change.

`npm run v2:proof-world` checks the official Cottage Pact slice for a public arrival path, five to eight connected rooms, two meaningful loop kinds per room, complete front/job/clock paths, renewable critical inputs, and three repeatable care or production loops. Add `-- --strict` to make any gap fail the command, or `-- --report-json` for structured output.

From `v2/orchestrator-rust`:

```sh
cargo test
```

## Design Rule

All meaningful world mutation must pass through the C kernel.

Rust may store content, call AI, manage streams, schedule NPCs, persist events, normalize/moderate text, and project state. Rust should not decide whether movement, speech event emission, item use, evolution, combat, or stat checks succeed.

`GET /state?actor_id=...&actor_session=...` is room scoped: it follows that actor's current location, returns visible actors/items for the room, returns exits from that room, includes the kernel-derived primary action options, and includes `turn` when active human card play is ordered in a shared room. Actor id without the matching session falls back to the public Cottage avatar gate.

The SQLite database stores three different layers:

- `action_journal`: the source record of accepted client/system actions, deterministic seeds, and Rust-owned label/content upserts.
- `world_events`: the projected event feed produced by replaying actions through the C kernel.
- `actor_sessions`: opaque local browser sessions for generated human avatars. These survive process restarts alongside the action journal and are cleared by dev reset.

On startup, the orchestrator replays `action_journal` when it is present. Before
the first compaction, JSON snapshots are an accelerator and fallback rather
than the source of truth. After a successful snapshot, the default persistence
policy keeps the snapshot checkpoint row plus the journal suffix and the most
recent 25,000 world events. A compacted journal therefore requires a snapshot
at or after its recorded floor; startup fails closed instead of treating a
truncated suffix as complete history. `natural_feature.revealed` evidence is
retained independently because canonical hydration consumes it.

Set `COSYWORLD_V2_RETAINED_WORLD_EVENTS` to a value of at least 1,000 to tune
the replay window, or set `COSYWORLD_V2_PERSISTENCE_COMPACTION=off` before a
store is compacted to preserve full history. Canonical routing and regional
recovery require uncompacted prefix history and refuse a previously compacted
store. A new database is required to re-enable those modes after compaction.
New SQLite stores use incremental auto-vacuum; existing stores reuse freed
pages even when their outer file cannot immediately shrink. On boot, the
orchestrator removes the exact stale `*.json.tmp` file left by an interrupted
snapshot without touching the committed snapshot.

The startup log line reports how many milliseconds boot took from process
start to listening, so a regression to full replay is visible. A rejected
checkpoint is also surfaced beyond logs: `/meta.persistence` reports
`checkpoint_rejections`, `last_checkpoint_rejection`, journal/event floors,
cumulative deleted rows, database/snapshot/temp bytes, and live versus reusable
SQLite bytes. Checkpoint validation distinguishes unbound state from
divergence: funded-but-unbegun generated media carries an empty policy binding
and adopts its pathway's binding on load, exactly as begin would. Two legacy
compatibility bindings for the same owner pack and version reconcile the same
way — their historical bundle-hash bookkeeping drifts legitimately, and the
legacy policy fabricates no media identity. A reviewed non-legacy binding that
disagrees with its pathway still fails closed.
