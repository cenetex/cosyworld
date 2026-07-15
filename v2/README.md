# CosyWorld V2 Runtime

This folder contains the canonical CosyWorld runtime: a deterministic C rules
kernel, a Rust HTTP/SSE orchestrator, a browser MUD shell, content worldpack
data, and the local smoke/deployment gates.

The older Node service remains in the repository as a legacy companion for
integrations and migration work. Gameplay truth lives here.

For the Orbs, Intricately Carved Wooden Boxes, Ruby High pack/burn adapter, and legacy migration plan, see `../ECONOMY.md`.

For the OpenRouter player payer, Orb-paid Chat, real AI media, combat rewards, and self-expanding swarm design, see `../AI.md`.

## Layout

- `core-c/`: deterministic C rules kernel.
- `ai-model-rust/`: deterministic local AI generation model with native and WASM exports.
- `orchestrator-rust/`: Rust HTTP/SSE host that compiles and calls the C kernel through FFI.
- `orchestrator-rust/src/ai_gateway.rs`: OpenAI-compatible/OpenRouter text inference configuration, bounded retries, timeouts, typed failures, and request telemetry.
- `orchestrator-rust/src/routes.rs`: HTTP route table extracted from the runtime bootstrap.
- `orchestrator-rust/src/index.html`: one-button browser MUD shell served by the Rust host.
- `orchestrator-rust/src/mud.rs`: typed command protocol, parser aliases, response formatting, fuzzy matching, and direction canonicalization.
- `content/core/`: authored first-party world pack.
- `content/lonely-forest/` and `content/ruby-high-first-bell/`: asset and external-catalog packs.
- `content/rules-srd-5.1/` and `content/rules-srd-5.2.1/`: separately attributed, non-authoritative fifth-edition rules references.
- `content/the-lantern-keeper/`: short campaign pack and its character-creation profile.
- `worlds/official/`: selected packs and reproducible integrity lock.
- `content/official/`: generated bundle consumed by the Rust host. See `docs/worldpacks.md`.

## Current Capabilities

The runtime boots one shard per orchestrator process:

- The process owns one authoritative world, one SQLite action/event store, one
  ownership projection, and one SSE stream.
- `COSYWORLD_V2_SHARD_ID` names the process in `/meta`; it defaults to `local`
  for local profile and `public-1` for production profile.
- The C kernel is built with fixed in-process capacities of 512 actors, 1024
  items, 256 locations, 1024 exits, 128 emitted events per kernel call, and 128
  evolution tracks. `/meta` exposes the live counters and these compiled caps.
- Horizontal scale is a process/deployment boundary: run separate shard
  processes with isolated stores and route players to the right shard.
  Cross-shard routing is intentionally outside the MVP.

Seed world content:

- Location `1`: The Cosy Cottage.
- Location `2`: Rain-Soft Garden.
- Location `3`: Moonlit Trail.
- Locations `2` and `3`: Rain-Soft Garden and Moonlit Trail, public CosyWorld Core rooms.
- Locations `10`-`15`: Ruby High: First Bell expansion rooms. Science Class, Homeroom, Library, Cafeteria, Greenhouse, and Courtyard require their matching Ruby High location cards on the official shard.
- Locations `30`-`36`, `40`-`44`, `50`, and `60`-`65`: public CosyWorld Core seed rooms for free-world breadth.
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

Official NFTs unlock official expansions, not the base game. Pack resources
name grants rather than chains: the pack maps verified NFT assets or private
set claims to those grants, and movement checks the resulting grant. The first
expansion is **Ruby High: First Bell**. On the official shard, Ruby High rooms
use the trusted ownership feed and require their matching Ruby High location
card grants:

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
- Visible ability checks with deterministic normal, Advantage, and Disadvantage d20 resolution.
- Item pickup.
- Potion use with rule validation.
- Evolution item handoff.
- Level 2 resident evolution after two unique evolution items.
- Defend, attack, and flee primitives, including derived Bloodied state and nonlethal 1-HP knockouts.
- Combat rejection in safe locations; The Cosy Cottage remains non-combat.
- A reachable Moonlit Trail sparring encounter for one-button attack/defend/flee smoke coverage.
- Ranked primary action offers with typed category, target, cost, risk, effect, claim-key, source, disabled-state, and inspector metadata.

The Rust orchestrator currently owns:

- HTTP routes.
- SSE broadcast.
- Actor/item/location/content labels.
- Native calls into the local Rust model for deterministic avatar identity and speech sanitizer behavior that can also run in WASM; dialogue is generated only through configured AI inference.
- Card projections for visible actors, items, and locations.
- Session-touched and heartbeat-refreshed live human presence, so stale generated avatars do not crowd active rooms.
- Generated human avatar flavor: name, title, description, and runtime avatar card.
- Server-authored avatar chat from the `Chat` button, plus moderated human-authored `say` lines for shared room speech.
- OpenAI-compatible avatar and resident response generation with no deterministic dialogue substitute when inference is unavailable.
- Event projection.
- Snapshot persistence.
- SQLite action journal and projected event feed.
- Durable Orb ledger rows for avatar grants, rule rewards, flee rewards, and server-paid Chat spends.
- Durable AI usage ledger rows for player-avatar Chat payer/provider/model/status accounting without storing player OpenRouter keys.
- Trusted ownership-feed projection for active Wooden Box NFTs and unopened avatar packs in `/state`.
- Signed-wallet staging routes for Wooden Box burn receipts and avatar pack opening/card grants.
- Resident replies are submitted back through the kernel as actor actions and broadcast one-to-many to everyone in the room.

## Agent Play Loop

AI agents should play through the same server rules as browser players:

1. A real wallet signs in through `/wallet/challenge` and `/wallet/session`.
2. The wallet creates or recovers an avatar through `POST /avatar`.
3. The wallet signs a short-lived narrative move delegation for an ephemeral autosign key.
4. The agent observes with `GET /state?actor_id=<id>&wallet_session=<wallet_session>`.
5. The agent submits commands through `POST /actions/narrative-move`.
6. The agent watches room changes with `/events` or `/stream` using the same `actor_id` and `wallet_session`.

The owner wallet signs the delegation once:

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

That script builds the Rust orchestrator, starts it detached on `127.0.0.1:3102` with the dev wallet cards needed for the current playable loop, enables `/dev/reset`, opens `http://127.0.0.1:3102/?wallet=dev-wallet`, and prints health/status. Useful commands:

```sh
./v2/mvp.sh check
./v2/mvp.sh smoke
./v2/mvp.sh status
./v2/mvp.sh logs
./v2/mvp.sh stop
```

Use `./v2/mvp.sh check` as the local MVP gate. It runs the content worldpack check, the C kernel test, local AI model native tests plus WASM build, Rust format/tests/build, JavaScript and terminal-client syntax checks, starts a production-profile smoke against a protected local Ruby High-style ownership feed, restarts the detached browser server, runs the Playwright browser smoke, runs a non-typing terminal smoke plus a typed terminal command-mode speech smoke, and leaves the verified server running.

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

The production Fly profile expects the protected Ruby High ownership feed, moderation token, and event store to be configured before boot:

```sh
fly secrets set COSYWORLD_V2_SHARD_ID=public-1
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

The avatar gate begins with an immediate character question—`what draws you in?`—and carries the answer through the visible game as the avatar's purpose. A quiet transcript is a centered room vignette instead of a tiny line stranded above an empty panel: before avatar creation it frames `a new tale is waiting`, and later it reminds the player that choosing a card will invite someone in the room to answer. After confirming Begin, the card reads `arriving` and the story stage becomes `the cottage is making room`, retaining the selected calling while the model shapes a name and face. That pending beat promises the resident welcome that follows, so the first AI wait feels like arrival rather than a frozen button. The completed Begin lands as a visible arrival beat followed immediately by the first resident in card order welcoming the new avatar, so the action→story→reply rhythm starts with the very first card. The new avatar sheet keeps that tone: empty Journal, knack, friendship, collection, Box, and pack states describe moments and people still ahead rather than saying `nothing`, `none`, or `no one`; a local session is a `local tale`, and keepsake capacity says how much room remains instead of showing a fraction. The browser's opening is then framed as `Your first tale`: Listen for a clue, Grow from what happened, then shape a friendship or knack. Its three prompts use short, wrap-safe language on narrow screens, and the matching card is pinned in the hand with a visible `✦ next tale beat` reason while unrelated slots can still be redrawn. A first welcoming Listen remains personal and playable even when an Orb Chat has advanced the shared room turn. The completion beat recalls the whole path: the player listened, grew from a clue, and made a friend or found a knack to practice. That guide keys off an actual listened-to truth, so an Orb Chat memory or unrelated growth can never masquerade as the opening clue or skip a missed Listen. The first Listen in a room always keeps its welcoming promise by yielding a clue; later Listening can remain uncertain. A paid repeat is presented as `Listen again · one Orb`, with cost, possible clue, and fatigue risk separated in its confirmation. Finishing the opening earns a brief completion beat before ordinary play takes over. Everyday cards describe the gesture and its possible story outcome in plain language: Orb costs are written as costs rather than subtraction, Grow talks about the little things noticed and the new possibilities they open without counting marks or points, Practice replaces the colder Train verb, Grow Closer replaces visible Bond terminology with ordinary friendship language, and Give carries its recipient choice inside one card. Practice carries every trainable knack—Listening, Kindness, Lorecraft, Steadiness, Nimble Hands, and Lifting—inside one card, with the server suggestion first but never forced. Grow Closer now carries every nearby new-friend option too, so the first tale's friendship choice belongs to the player instead of the server default. Remember does the same for mature friendships, letting the player choose whose shared story to carry forward instead of exposing settlement language. Chat follows the same rule: when several residents are nearby, one Chat card opens a resident picker instead of occupying one hand slot per person; a lone resident is still named directly on the card. Take and Swap also collapse every visible floor keepsake into one picker, so discovering another item adds a meaningful option without crowding the hand with a duplicate verb. Use likewise carries every safe care recipient inside one card while keeping combat opponents out of that picker; when the same keepsake can also awaken a room feature, those possibilities join that same Use card as choices such as `with Hearth` and `help you` rather than duplicating the verb. Trade carries every willing resident's exact give-and-receive pair inside one card, and confirmation still moves both keepsakes atomically. Attack carries every active opponent inside one target picker while a lone opponent remains named directly. A wanted gift does not vanish just because a resident's paws are full: the card names the less-important keepsake they will hand back, and the kernel resolves both movements as one gift while protecting attached treasures. Project choices describe their character—make a little, good, or great headway; stay fresh; make the next try count—instead of counting clock steps. Listen, combat, recovery, and shared projects still use exact deterministic fields underneath, but the player-facing transcript, typed-command output, accessibility copy, and room diary describe the outcome as a story beat rather than exposing d20, modifier, DC, rank, damage, HP, segment, or progress-clock arithmetic. The collapsed room `LOG` names who did what and what changed—arrived, found, gave, became friends, grew closer, chose a purpose, or moved a project forward—rather than adding stock atmospheric prose. Travel updates follow the room being viewed: the room left behind records `Rati left for Science Class`, while Science Class records the matching arrival. Long connections are ordinary segmented geography rather than a separate travel minigame: Search reveals exactly one next adjacent pathway location, then the existing Travel action enters it; distance three therefore means three normal Travel edges with two generated pathway locations between the endpoints. Every normal conversation keeps one plain room-opening line above the voices, so returning to a quiet room never produces a contextless transcript. Orb Chat spends one Orb on a short four-beat exchange—avatar, resident, avatar, resident—and records one witnessed room memory after the back-and-forth. Repeat chats keep the same room thread; collision checks fold straight and typographic quotes and dashes, rejecting visually identical inferred lines rather than substituting canned dialogue. While the opening line is being shaped, the chosen resident remains visible in the transcript with a `finding the thread…` beat and the card reads `chatting`, so a model pause still feels like part of the conversation instead of a frozen hand. The shared transcript preserves every player line while pacing an uninterrupted resident monologue down to its two freshest lines; the underlying event history remains intact. The expanded room diary also collapses exact repeated memories and normalizes their sentence endings.

Pathway Search and Travel remain ordinary dealt actions: discovering a stretch never replaces the hand, commits the player to the destination, or hides room interactions. A player may continue, backtrack, choose another route, or stay and act. Generated waypoint rooms begin as risky frontier. Each pathway carries one shared `Make this way familiar` Work project across all of its waypoint rooms; community contributions settle the route, move it into sanctuary rules, complete the public job, and unlock generated landscape art. Until that work completes, the deterministic pathway SVG remains the visual fallback.

At the final first-tale choice, both `Grow Closer` and `Practice` stay visibly guided in the hand. The player can therefore make the promised friendship-or-knack choice directly, including on the two-card mobile hand, instead of relying on a redraw to reveal the other path. A successful Listen now reveals one vivid lead at a time rather than listing every nearby keepsake or system hook; when an earlier keepsake has moved on, the room points to one different object or one gentle search invitation. The collapsed room log keeps the latest human card outcome on top while its derived memory rewards and resident ripples remain in the expanded chronological history. Room-memory cleanup removes only a leading second-person subject, preserving phrases such as `what draws you` inside the sentence.

Generated avatar titles are short portable card epithets rather than room descriptions. Model-added suffixes such as `at The Cosy Cottage` are removed on creation and when older profiles are replayed, so arrival copy names the room once and the title still makes sense after travel. Identity generation asks for a small fondness, harmless habit, and gentle curiosity; a server-side tone guard repairs titles, descriptions, visual prompts, and older profiles that drift into grudges, ravenous scheming, hostility, cruelty, or villain language.

Wallet-owned cards now form a three-card **Keepsake hand** alongside the room's contextual scene cards. Keeping an Avatar card close calls a matching or social scene choice forward; Item cards favour matching or hands-on choices; Location cards favour matching paths, discoveries, and shared projects. Exact subjects take precedence, while off-stage cards still provide their role affinity, so a collection changes the first choices dealt without granting stat power or hiding any base-game action. The account sheet and card detail view state each card's particular promise in plain language before the player chooses `keep close`; owned card art is a keyboard-accessible detail button. The loadout is stored per wallet in the browser and can be changed from the account sheet. Player-facing rarity is compressed to `everyday`, `curious`, `rare`, and `storybook`; signed Box pack reveals use deterministic rarity weights, never repeat a card within a pack, and prefer cards the wallet does not already own until the eight-card avatar catalog is complete.

When a kept-close card helps deal an action, the action itself names that connection—for example, `✦ Homeroom called this`. The same relationship is included in the accessible name and hover copy, closing the feedback loop between choosing a keepsake and seeing it matter in play. The top-bar collection control remains visibly named `account` even on narrow screens, changes to `close` while the sheet is open, exposes its expanded state, and returns to room chat on a second activation or Escape.

After `Your first tale` finishes, one grounded **room thread** is still selected from authoritative world state: a wanted gift, urgent care, shared work, danger, an open path, something still hidden, a nearby voice, or finally the room's authored hook. Its matching scene card is dealt directly into the hand with a short reason; there is no separate room-thread strip or second control repeating the same action.

Choice-bearing cards keep one confirmation flow while making the selected option feel concrete. Avatar, Item, Location, Give, Trade, Travel, Take, Attack, friendship, and mixed Use choices carry their corresponding cards; selecting another option immediately swaps the preview and accessible image name. Portrait and square art use a contained preview instead of being cropped into the wide action frame.

For the current browser MVP smoke, run the shard with a dev wallet that can reach the Garden, Trail, Homeroom, and Science. `./v2/mvp.sh check` also seeds a deterministic throwaway signed smoke wallet with `location-library` so the smoke can verify the production-style wallet challenge/session path:

```sh
COSYWORLD_ENABLE_DEV_RESET=1 \
COSYWORLD_DEV_ALLOW_UNSIGNED_WALLET=1 \
COSYWORLD_RUBY_HIGH_WALLET_CARDS='dev-wallet:cosy-rain-soft-garden,cosy-moonlit-trail,location-homeroom,location-science-lab|rati-wallet:rati,location-science-lab|DcfmEZ6tw7BGJo1a7TozkCoGJZNFJxCBJS5axj7oy4ES:location-homeroom,location-library' \
cargo run
```

Then from the repository root:

```sh
node v2/scripts/smoke-browser.mjs
```

The browser smoke uses Playwright from `v2` when available, or the sibling `../app-ruby-high` workspace in this development checkout. `npm run v2:smoke` runs both the deterministic visual/accessibility pass and the longer living-world journey. Together they verify runtime metadata, signed wallet challenge/session access, signed wallet avatar recovery, avatar creation, actor-session continuity, walletless `connect wallet`, one-button normal play, zero-Orb earning-action priority, no-typing `listen`, server-authored avatar chat, moderated client-authored room speech and `/me` emotes, player report queue submission/resolution/deletion plus protected moderation replay, the `/moderation` operator console, player-facing report command seeding, two-browser room fanout and presence leave refresh, compass/typed command behavior, typed item take/drop/retake behavior, reload continuity, contextual verb labels, mobile and desktop viewport fit, generated seed-card art, Ruby High card asset delivery, card-gated travel, resident keepsake handoffs, one-item room swaps, project-clue item use, prepared project completion, post-project social play, autonomous resident delivery, emoji-only speech accessibility, and protected resident/human action boundaries.

When the mobile and desktop visual shell checks pass, the smoke writes viewport screenshots plus JSON metadata and SHA-256 hashes to `v2/orchestrator-rust/.runtime/visual-smoke/`. It also compares those screenshots against the committed PNG baselines in `v2/tests/visual-baselines/` with a 3% max pixel mismatch ratio. Set `COSYWORLD_VISUAL_SNAPSHOT_DIR=/path/to/output` to collect runtime artifacts somewhere else, or run `COSYWORLD_UPDATE_VISUAL_BASELINES=1 node v2/scripts/smoke-browser.mjs` after an intentional UI change to refresh the baselines.

Enable AI-backed avatar chat and resident replies with an OpenAI-compatible provider:

```sh
COSYWORLD_AI_API_KEY=... COSYWORLD_AI_MODEL=openai/gpt-5.6-luna cargo run
```

OpenRouter works too:

```sh
OPENROUTER_API_KEY=... OPENROUTER_CHAT_MODEL=openai/gpt-5.6-luna cargo run
```

Optional overrides:

```sh
COSYWORLD_AI_BASE_URL=https://api.openai.com/v1
COSYWORLD_AI_PROVIDER=openrouter
```

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
COSYWORLD_REPLICATE_AVATAR_MODEL=owner/model
COSYWORLD_REPLICATE_AVATAR_LORA=https://.../mirquo-lora.safetensors
COSYWORLD_GENERATED_ASSET_DIR=/data/generated
```

Optional Replicate overrides include `COSYWORLD_REPLICATE_AVATAR_VERSION` for a
pinned prediction version, `COSYWORLD_REPLICATE_AVATAR_LORA_INPUT` and
`COSYWORLD_REPLICATE_AVATAR_LORA_SCALE_INPUT` for model-specific LoRA parameter
names, `COSYWORLD_REPLICATE_AVATAR_LORA_SCALE`,
`COSYWORLD_REPLICATE_AVATAR_OUTPUT_FORMAT`, and
`COSYWORLD_REPLICATE_AVATAR_INPUT_JSON` for additional input fields.

Pressing `Chat` asks configured AI inference to author a short four-beat exchange—avatar, resident, avatar, resident. Each accepted line is committed through the C kernel as `CW_ACTION_SAY`, validated against its speaker's speech contract, and broadcast as a shared world event. If inference is unavailable or the opening line is invalid, Chat fails before charging an Orb or emitting dialogue. If a later beat fails, the accepted public lines remain and the exchange ends without canned completion. Repeated or invalid inferred lines are rejected rather than replaced with authored text; emoji and emote residents keep their speech contracts. A completed exchange leaves one friendly witness memory per resident instead of farming a new reward on every repeat. Human-authored room speech is a separate moderated `say` path.

The MVP economy is enabled by default:

- New human avatars receive 3 Orbs.
- Server-paid `Chat` costs 1 Orb after the avatar line commits.
- `Listen`, `Attack`, and `Flee` can award Orbs from committed kernel events.
- Automatic Orb rewards are claim-key gated by actor/context so repeated identical outcomes cannot mint duplicate rewards.
- If Chat is unaffordable, the browser prefers in-world earning actions such as `Listen` over AI setup only while that action can still claim a reward; a verified player OpenRouter key still makes explicit `Chat` actions cost zero Orbs while the result remains a public shared-room event.
- Orb mutations and player-avatar Chat AI usage are persisted to SQLite ledger tables when the event store is enabled.
- Trusted ownership feeds may include active Wooden Boxes and unopened avatar packs; the main room UI keeps those out of the normal transcript, while the top economy chip can focus account inventory/provenance and change the one contextual command to `Open Box` or `Open Pack`.
- `/nft/boxes/burn-prepare`, `/nft/boxes/burn-confirm`, and `/nft/packs/open` exist as signed-wallet endpoints. Local mode can still create staging receipts for fast development. With a configured Solana/Core verifier, production `burn-prepare` fetches a current blockhash and returns an unsigned owner-paid Metaplex Core BurnV1 transaction for the trusted Box and configured collection. The browser confirms the irreversible action, asks the wallet to sign and send it, and passes the returned chain signature to `burn-confirm`, which verifies the transaction before creating a receipt. Receipts and pack openings are durable, idempotent, merged back into the ownership projection, and shown in account state.
- `/moderation/economy` returns recent Orb/AI ledgers, Box receipts, pack reveals, and pre-merge ownership reconciliation runs. Open anomaly runs can be resolved idempotently with moderator identity and notes through `/moderation/economy/reconciliations/{run_id}/resolve`; the moderation console exposes the same economy workflow.

CosyWorld time is player-powered. There is no real-time ambient scheduler: the world does not commit resident speech, checks, danger ticks, or placement changes simply because wall-clock seconds passed. A confirmed scene card commits its deterministic mutation and advances the human room turn immediately. The resulting observation is then queued for independent resident/AI processing; a direct target takes precedence so Give, Trade, and friendship cards do not answer twice. Accepted reactions follow the resident's prose, emoji, emote, or multi-voice contract and arrive later as their own committed world events. Inference latency therefore never holds the played card open. When inference is unavailable or invalid, the card outcome remains committed and no stock dialogue is substituted. Group chat contains only committed speech, and Chat remains an ordinary contextual card rather than a permanent composer. Card outcomes—what the avatar heard, found, carried, changed, or helped—remain available through the room Log alongside the audited projection events. Player actions can also fan out into lifecycle hooks, frontier danger/progress clocks, quest completion, and player-turn encounter resets through the normal audited journal path. `COSYWORLD_AMBIENT_QUIET_SECS` remains only as a local test threshold for ambient helper coverage; `/meta.features.ambient_enabled` reports `false` in the running service.

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

The client offers actions from visible world state: nearby residents to chat with, visible items, matching evolution gifts, available exits, combat escape routes, and room rules. One-button play remains the normal path, while the command palette and `/commands` endpoint support typed MUD commands such as `look`, `look east`, `go e`, `say <message>`, `/me <action>`, `report <actor>: <reason>`, and `drop <item>`. `/` opens the command palette, `t` opens it prefilled for room speech, nearby actors add a low-priority Report action that prefills `report <actor>: ` for the player to finish, and Up/Down recall commands from the current browser session.

Normal play prefers concrete room verbs such as `Take`, `Use`, `Listen`, `Prepare`, `Work`, `Assist`, `Travel`, `Flee`, or `Chat` from the ranked action-offer list. Each offer carries typed metadata for UI/tooling: category, target, cost, risk, effect, claim key, source, zone, rank, and disabled-state. Empty group chats render a quiet room vignette instead of a debug placeholder or synthetic log row.

The current location tab participates in the same one-button surface: focusing it changes the command to `listen`, rolls a kernel-owned Wisdom check, and writes the auditable result into the room Log. Combat outcomes likewise stay in the Log instead of leaking rolls, damage, knockouts, or fleeing into group chat.

You can connect the CLI to an existing server, or use the typed command shell explicitly. Command mode sends player-authored MUD commands through the same `/commands` resolver as the browser palette, including `say`, `/me`, `report`, direction aliases, and item-name matching. `events` and `watch` replay room events with the active actor session attached, filtering hidden presence bookkeeping so terminal players see the same authenticated room transcript as browser players:

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

Room presence is intentionally narrower than durable avatar existence. A human avatar persists in the world and can return with its actor session, but other players only see that human in room presence while the actor session has been touched recently by state/action/stream/presence traffic. Typed `look`, `who`, and actor-target commands use the same active-presence projection as `/state` and `/world`, so closed-tab humans do not linger in terminal room descriptions or target matching. If a stale but valid actor session runs a typed command or accepted direct action, the server emits the same hidden active-presence event as `/presence/ping` so co-located clients refresh, and command/action responses include that presence event when it was created for the request. The browser pings `/presence/ping` before boot refresh when it has a stored actor session, keeps a lightweight heartbeat while connected, and sends `/presence/leave` on page hide. The terminal client does the same on startup and while waiting at the prompt, then sends `/presence/leave` on quit. NPC residents stay visible according to world placement. This keeps shared rooms lively without filling them with closed-tab or old smoke-test avatars.

Visible actors, items, and locations now resolve through `state.cards`:

- actors use tall card art and render as round portraits in compact controls;
- items use square card art;
- locations use wide card art in the top tab and travel controls;
- Ruby High cards carry First Bell catalog/on-chain metadata;
- CosyWorld seed cards use the same shape with generated mini art served from `/assets/generated/cards/{card_id}.webp` until the card pipeline adds full NFT records.

The `ruby-high.first-bell` pack supplies the 24 live Ruby High: First Bell card profiles, covering students, teachers, special cards, items, and locations. Exposed First Bell cards use `/assets/cards/{card_id}.png`; a materialized pack asset is served locally when present, otherwise the compatibility route redirects to the catalog's pinned chain image URI. The runtime projects the matching set number, profile id, subject, rarity, aspect, and Arweave image URI into `state.cards` without reading a sibling repository.

For the current dev slice, the server owns wallet/card access through an ownership snapshot:

```sh
COSYWORLD_RUBY_HIGH_WALLET_CARDS='dev-wallet:cosy-rain-soft-garden,cosy-moonlit-trail,location-homeroom,location-science-lab|rati-wallet:rati,location-science-lab' cargo run
```

By default, a browser can only claim a wallet after signing a Solana wallet challenge:

- `GET /wallet/challenge?wallet_address=<base58 public key>` returns the exact message to sign.
- `POST /wallet/session` verifies the Ed25519 signature and returns a short-lived `wallet_session`.
- `/state`, `/actions/move`, and `/actions/flee` use `wallet_session` to resolve server-owned Ruby High: First Bell expansion access.

The one-button browser shell exposes this as a contextual `connect wallet` command when a locked Ruby High expansion door is focused and no signed wallet session is present.

For local smoke/demo only, enable unsigned wallet hints explicitly, then open `http://127.0.0.1:3102/?wallet=dev-wallet`:

```sh
COSYWORLD_DEV_ALLOW_UNSIGNED_WALLET=1 \
COSYWORLD_RUBY_HIGH_WALLET_CARDS='dev-wallet:cosy-rain-soft-garden,cosy-moonlit-trail,location-homeroom,location-science-lab|rati-wallet:rati,location-science-lab' \
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

It launches temporary bearer-protected ownership and Solana RPC fixtures, starts the orchestrator with `COSYWORLD_DEPLOY_PROFILE=production`, and verifies `/meta` reports production mode, remote ownership, moderation, persistence, configured Box burn verification for the smoke process, and disabled dev shortcuts. It then signs a real wallet-session challenge, prepares a trusted fixture Box, and verifies the live process returns a current-blockhash Core BurnV1 transaction.

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
- The server uses AI inference for the in-character avatar opener, resident reply, avatar follow-up, and resident closing. If inference is unavailable or invalid, no canned dialogue is emitted and Chat fails before charging an Orb.
- All four lines are committed through the C kernel as normal `message.created` world events on the same shared one-to-many timeline as other room output.
- One Orb covers the entire exchange, and the Chat action stays in flight until the closing line lands.
- A human avatar can have only one server-authored Chat turn in flight; overlapping Chat submissions for the same actor return `409` and emit no events.
- `say <message>`, `/me <action>`, and `POST /actions/say` commit moderated human-authored room text as normal `message.created` events; unsafe or overlong text is rejected before it reaches the journal.
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

The Rust host loads seed actor placement/stats, faction definitions, item descriptions/placement/kinds, location labels, directed exits, combat flags, access gates, complete room RPG sheets, jobs/fronts, lifecycle/effect descriptors, and level-2 evolution tracks from the compiled `content/official/` worldpack. `worlds/official/world.json` selects independently versioned source packs and `world.lock.json` pins their integrity. Startup tests and `npm run v2:worldpack` validate a current lock and bundle, unique ids, valid references, canonical one-direction-per-room exits, every location having a complete room sheet, seeded kernel parity, faction opposition links, frontier-only front links to jobs and danger clocks, lifecycle hook and clock-fill effect descriptors with reasons, and exactly two unique items for each evolution track. The C kernel still owns rule enforcement for movement, speech event emission, item transfer, and evolution, with its evolution track table configured from the worldpack at boot.

Factions are content-backed opposing forces rather than hard-coded teams. `content/core/factions.json` defines each faction's axis, mirrored opposition, protected truth, shadow failure mode, verbs, motifs, home locations, and member actors. `/state` and `/world` expose the global faction list, and location/actor views include compact faction refs so clients can render allegiance without inferring it from names. The first mythic axis is live in content: Solar Temple and Vowbright Angel mirror the Darkest Ocean and Pearl-Deep Listener through the shared `solar-abyss:drowned-bell` project.

Resident placement can be simulated with an aggregate ownership snapshot:

```sh
COSYWORLD_RUBY_HIGH_WALLET_CARDS='w1:rati,location-science-lab|w2:rati,cosy-rain-soft-garden' cargo run
```

Each wallet holding a resident avatar card contributes the unique location cards in that wallet. The resident appears in the highest-scoring shared location, with deterministic tie rotation based on world-tick placement seasons rather than wall-clock days. With no overlap, residents default to The Cosy Cottage. Placement is recomputed from the server-owned ownership index on boot, reset, and ownership refresh, so stale snapshots cannot strand a resident in a gated room after ownership changes.

Access and gravity are separate: The Cosy Cottage is public even without a card, but a `cosy-cottage` card can still count as a placement vote when a wallet also holds a resident avatar card.

Live refreshes and dev resets emit normal `actor.moved` events when placement moves a resident, then persist and broadcast those events through the shared room timeline. Boot-time placement stays quiet so process restarts do not replay movement noise.

Resolved frontier encounters can reopen on later player turns. The Moonlit Trail reset path waits for a player-powered season gap, then a committed player action in that frontier clears the spent progress/danger clocks, clears resolved-state tags such as `quieted moonlight`, revives the encounter participant, emits `encounter.reset`, and makes combat/project actions available again for late arrivals.

## Shared Live Rooms

Locations are live channels:

- `/state?actor_id=...` returns the actor's current location, visible presence, available actions, active-human room turn state, and room-scoped recent events.
- `/world?actor_id=...&actor_session=...&wallet_session=...` returns the shared room map, gated/public status, accessible room contents, and locked-room summaries without exposing locked actor/item details.
- `/stream?actor_id=...&actor_session=...&wallet_session=...` broadcasts accepted world events over SSE after filtering to public Cottage events plus rooms visible to that actor/wallet. SSE messages include the world event sequence as their event id, and reconnects can replay missed visible events with `after=<seq>` or the native `Last-Event-ID` header.
- `/events` uses the same visibility query parameters for replay; walletless requests only receive public Cottage-visible events. Replay defaults to the latest 80 visible events, accepts `limit=...`, and caps explicit requests at 500.
- Human presence in `/state` and `/world` is filtered to the current actor plus recently touched actor sessions; durable old avatars are not treated as online occupants.
- `/presence/ping` and `/presence/leave` require the matching actor session and emit hidden `actor.presence` events only when the active-presence state changes.
- When two or more active human avatars share a room, `/state.turn` names the human whose card play is live. Every played card, including Grow, Quest, and Level Up, belongs to that turn. A waiting player sees only the gentle Nudge / I'm here handoff instead of a timer or technical initiative language. A nudge opens an eight-second room wait; players who answer are eligible for the next choice if the current player is away.
- The browser appends only `message.created` speech to group chat. Other matching live events refresh state and remain available through the room Log.
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
- `GET /moderation`
- `GET /moderation/activation?limit=80` with `Authorization: Bearer <COSYWORLD_MODERATION_TOKEN>`
- `GET /moderation/events?after=12&limit=80` with `Authorization: Bearer <COSYWORLD_MODERATION_TOKEN>`
- `GET /moderation/reports?after=12&limit=80` with `Authorization: Bearer <COSYWORLD_MODERATION_TOKEN>`
- `POST /moderation/reports/{report_id}/resolve` with `Authorization: Bearer <COSYWORLD_MODERATION_TOKEN>`
- `POST /moderation/reports/{report_id}/delete` with `Authorization: Bearer <COSYWORLD_MODERATION_TOKEN>`
- `POST /moderation/actors/{actor_id}/suspend` with `Authorization: Bearer <COSYWORLD_MODERATION_TOKEN>`
- `POST /moderation/actors/{actor_id}/unsuspend` with `Authorization: Bearer <COSYWORLD_MODERATION_TOKEN>`
- `GET /stream`
- `POST /dev/reset` when `COSYWORLD_ENABLE_DEV_RESET=1`
- `POST /avatar`
- `POST /presence/ping`
- `POST /presence/leave`
- `POST /actions/chat`
- `POST /actions/say`
- `POST /actions/report`
- `POST /actions/move`
- `POST /actions/check`
- `POST /actions/pick-up`
- `POST /actions/drop`
- `POST /actions/use-item`
- `POST /actions/give-item`
- `POST /actions/attack`
- `POST /actions/defend`
- `POST /actions/flee`

`/health` is intentionally minimal readiness. `/meta` is the deploy/smoke metadata endpoint: package version, debug/release build profile, deployment profile, shard id/model, non-secret feature flags such as server-authored Chat and enabled client-authored speech, persistence mode, moderation report retention, ownership-feed mode, current world counters, and compiled kernel capacities. `./v2/mvp.sh status` prints a one-line summary from it.

Protected operator audit routes require `Authorization: Bearer <COSYWORLD_MODERATION_TOKEN>`. `/moderation` serves a no-store operator console that stores the bearer token in local browser storage and uses the protected report endpoints; loading the page alone does not expose report data. The console can resolve reports, delete resolved reports, suspend the reporter attached to an open report, and suspend a reported target when that target is a human avatar. Report suspension actions also resolve the report with a suspension note, so the open queue reflects the operator action. Report details show current reporter/target suspension state and can unsuspend suspended human actors from open or resolved reports. `/moderation/events` returns bounded all-room event replay, `/moderation/reports` returns bounded player report queue entries, `/moderation/reports/{report_id}/resolve` closes a report with resolution metadata, `/moderation/reports/{report_id}/delete` removes a resolved report, `/moderation/activation` returns first-session and day-seven retention evidence from the activation event table, and `/moderation/economy` returns bounded Orb ledger, AI usage ledger, Wooden Box receipt, and avatar pack opening rows without exposing player OpenRouter keys.

Public action endpoints accept active human actors only when the matching `actor_session` is present. The Rust orchestrator can still commit avatar and resident `SAY` events internally for Chat, AI replies, player-triggered resident beats, and audited placement changes. Browser-submitted `say` is limited to the caller's own human avatar, is normalized through the same cozy text hygiene used by other player-authored statements, and cannot act as Rati, Whiskerwind, Skull, other residents, or another human avatar by id alone.

`POST /actions/say` accepts JSON `{ "actor_id": 5000, "actor_session": "...", "content": "hello room" }` or the alias field `message`. Success returns `200` plus a `message.created` event whose `location_id` is the speaker's current room. Missing or wrong actor sessions return `403`, rejected text returns `400`, rate limits return `429`, and no rejected speech emits a world event.

`POST /actions/report` accepts JSON `{ "actor_id": 5000, "actor_session": "...", "target_actor_id": 1001, "reason": "..." }`. The reporter and target must both be in the same room, and human targets must be visible in active room presence. Success returns `200` plus a durable report id for moderator review; reports do not broadcast into the room timeline.

`POST /actions/timeout` accepts JSON `{ "actor_id": 5000, "actor_session": "..." }`. It is only useful for an active human waiting on another active human's room turn. The first request gently nudges the current player and starts an eight-second wait; later requests tell the room that those players are still here. If the current player remains away, the next choice passes to an eligible responder. The durable event names remain `turn.ping_started`, `turn.pong`, and `turn.ping_skipped` for compatibility, but the browser presents only the warmer Nudge / I'm here language.

Public mutation endpoints also pass through lightweight in-memory rate limits before they touch the world reducer:

- Avatar creation: 12 attempts per client IP per 10 minutes.
- Wallet challenge/session: 30 attempts per client IP per minute.
- Chat and player room-message actions: 45 attempts per actor per minute, with a broader shared IP mutation cap.
- Player reports: 12 attempts per actor per 10 minutes, with the broader shared IP mutation cap.
- Movement, item, check, and combat actions: 180 attempts per actor per minute, with the same shared IP mutation cap.

Client-submitted `/actions/say` and typed command emotes enter the action journal only after actor-session authorization and text moderation. They use the same C `SAY` event shape as server-authored Chat and resident replies, so room speech, action narration, AI dialogue, replay, and SSE broadcast all share one event contract.

Rate limits are intentionally generous for normal play and local smoke tests.
They are abuse guardrails for one shard process, not a replacement for full
moderation or cross-shard routing.

## Moderation

Set `COSYWORLD_MODERATION_TOKEN` to enable protected moderation endpoints:

```sh
COSYWORLD_MODERATION_TOKEN=... cargo run
```

`GET /moderation/events?limit=80` requires `Authorization: Bearer <token>` and returns a bounded chronological replay across all rooms, bypassing player room/card visibility filters for operator review. It uses the same default replay limit of 80 and hard cap of 500 as player `/events`.

`GET /moderation/activation?limit=80` requires the same bearer token and returns avatar creation count, actors who committed a first card turn, actors who reached their first banked Visit Ledger mark, day-one/day-seven return counts and rates, median time from avatar creation to first card turn and first ledger banking, and recent activation events. Events are idempotent per actor/key, so repeat state polling, timeout nudges, and repeat ledger banking do not inflate the metrics. Browser smoke verifies that a fresh no-typing first tale appears here with median time to first bank below the ten-minute product target.

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
npm run v2:worldpack
npm run v2:worldpack:inspect
npm run v2:kernel
npm run v2:rust:test
```

`npm run v2:worldpack` is the terse pass/fail content gate. It first proves that pack integrity and the compiled official bundle are current, then validates the assembled world. `npm run v2:worldpack:inspect` runs the same validation and prints a builder report with the bundle hash, pack count, room gates, exits, actors, items, features, clocks, jobs, lifecycle hooks, and evolution tracks. Use `node v2/scripts/check-worldpack.mjs --report-json` when another tool needs the same report as structured JSON. Use `npm run v2:worldpack:lock` only after an intentional source-pack change.

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

On startup, the orchestrator replays `action_journal` when it is present. JSON snapshots are an accelerator and fallback, not the source of truth.
