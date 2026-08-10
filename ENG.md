# CosyWorld Engineering Plan

Last major revision: 2026-08-09. This document replaces the CosyWorld 2.0 engineering plan, which was written before the V2 runtime existed. The architecture it proposed is now built and live-tested with simultaneous players; this document describes that architecture as it stands and sets the engineering priorities from here — including the card-composed world, non-consuming arrangement evolution, crafting, and the wallet-optional avatar-link boundary adopted in `PRD.md` and ADR 0006.

Companion documents:

- `PRD.md` — product direction this plan serves, including the Card-Composed World rules.
- `docs/systems/09-cosyworld-rpg-system.md` (the RPG Bible) — authoritative RPG mechanics design, phase status, on-fill descriptor spec, claim-key spec, and ADR 0006 ownership-boundary integration.
- `AI.md` — AI gateway, payer modes, and media pipeline design detail.
- `ECONOMY.md` — Orb economy, linked-avatar adapter, and legacy NFT migration inventory.
- `v2/README.md` — runtime operations guide: run, deploy, endpoints, environment.

## System Shape

CosyWorld V2 is the canonical runtime. It is a deliberately layered system where authority narrows as you go down:

```
Clients        browser card-hand shell (index.html) · terminal CLI (v2/cli) · smoke/ops scripts
               │  HTTP + SSE, actor_session / wallet_session
Rust           orchestrator (v2/orchestrator-rust): routes, SSE fanout, sessions, rate limits,
orchestrator   room turns + ping/pong (turns.rs), resident autonomy (desire-driven wander/pickup),
               moderation, ownership feeds, card projection, economy ledgers, clocks/tags/bonds/
               jobs/fronts projection, AI calls, media, persistence
               │  FFI, actions in / events out
C kernel       cosy_kernel (v2/core-c): deterministic world rules — actors, movement, speech
               events, checks, items, evolution, combat. No IO, no clock, no network.
               │  configured at boot from
Content        worldpack (v2/content/core): locations, actors, items, cards, exits, room sheets,
               clocks, jobs, fronts, factions, access gates, evolution tracks — validated by
               v2/scripts/check-worldpack.mjs
```

Persistence is three SQLite-backed layers plus a snapshot accelerator:

- `action_journal` — the source of truth: accepted actions, deterministic seeds, label upserts. Startup replays it through the kernel.
- `world_events` — the projected, replayable public event feed (also the SSE stream contract).
- `actor_sessions` and wallet-avatar links — identity durability.
- JSON snapshot — a boot accelerator and fallback, never authoritative.

The legacy Node service (`src/`) is a companion for Discord/X/Telegram integrations and a migration reference. No new gameplay code lands there.

## Non-Negotiable Invariants

These are the engineering enforcement of the PRD's pillars. Code review holds this line.

1. **All meaningful world mutation passes through the C kernel.** Rust may store, project, schedule, moderate, and call AI; it may not decide whether movement, speech emission, item transfer, evolution, combat, or checks succeed. Projection state (clocks, tags, bonds, ledgers) may lag the kernel but never contradict it.
2. **World time is played time.** Clocks, fronts, resident mechanical behavior,
   encounter resets, and seasons advance only from committed player turns. A
   committed scene card may arm one wall-clock-delayed room speech heartbeat;
   the delay only paces its causally linked public reply and cannot originate
   mechanical state. Rate limits, ping countdowns, and presence TTLs may also use
   wall time.
3. **AI proposes; it never mutates.** Every AI output is validated, sanitized, and committed as a public event or discarded. AI never grants items, fills clocks, deepens bonds, changes access, or spends currency directly. This extends to generated content: crafted-item names and generated evolution quest lists are proposals that must survive a fail-closed compiler before becoming authoritative.
4. **Events are append-only and replayable.** The journal is the source of truth; snapshots are disposable. Every visible dice roll carries die, roll, modifier, total, and DC/AC.
5. **Every mint, spend, ledger mark, and one-shot effect is claim-key gated.** Keys are pure functions of authoritative facts — never wall-clock time or RNG. Review checks key granularity in both directions (too coarse swallows legitimate repeats; too fine lets retries double-mint). This applies to NPC behavior too: resident ambient lines and autonomous acts carry cooldown/claim discipline like player rewards.
6. **The client is untrusted.** Affordability, access, ownership, outcomes, and primary-action state are server-derived. Client-supplied card ids are ignored outside explicit local dev flags.
7. **Turn discipline has a fixed taxonomy.** Committed cards consume a room turn; reports and reads never do; browsing the hand is free. A present player is never hostage to an absent one — ping/pong (or its successor) must always provide a bounded path past an unresponsive turn-holder.
8. **Core world actions do not depend on AI.** Travel, Listen, Search, item actions, growth, projects, and conflict keep deterministic kernel paths. Dialogue is an explicit inference capability: when unavailable it fails visibly before charging or committing speech, and incidental replies are skipped.
9. **The kernel stays wallet-blind and IO-free.** Stable numeric ids, type flags, and rule fields only. Ownership feeds, card metadata, signatures, and money are Rust concerns.
10. **One shard per process.** A process owns one world, one store, one stream. Horizontal scale is more processes with isolated state; cross-shard routing is out of scope this era.
11. **Structured content over free-form.** Anything that can change authoritative state — clock on-fill effects, crafting recipes, generated evolution patterns — is a closed-vocabulary descriptor that compiles to kernel actions or typed projection mutations, dry-run validated, fail-closed.
12. **External ownership is avatar-link provenance only.** A verified allowlisted avatar asset may bind to one durable autonomous actor. Wallet state never grants commands, item supply, place access, action legality, progression, rewards, or private media. The default composition boots and plays without wallet, chain, or ownership-feed configuration.

## Current State

The one-paragraph version: the kernel,
orchestrator, avatar gate, advancement-backed Chat, coalescing
contextual room heartbeats, shared live rooms with room turns and ping/pong
pacing, resident autonomy, transcript-rendered world feedback, items/evolution,
card projection, legacy wallet-gated expansion access, economy MVP (Orbs, claim keys,
image-only community spends, legacy Box/pack bridge), moderation basics, the RPG layer
first slice, deterministic frontier simulation, both clients, and the production
deploy profile are live and covered by `./v2/mvp.sh check`. The wallet gates and
Box/pack surfaces are migration inventory under #682/#685, not target architecture.

## Engineering Priorities

Ordered. Priorities 1–3 are the foundation everything else builds on.

### 1. Decompose the orchestrator

`v2/orchestrator-rust/src/main.rs` remains oversized. `routes.rs`, `mud.rs`, `kernel.rs`, and `turns.rs` are extracted — `turns.rs` is the model: a system that arrived as its own module with its own tests. Continue along the seams that exist:

- `world/` — world projection, presence, placement, resident autonomy.
- `cards.rs` — card projection and asset resolution.
- `economy/` — Orb ledger and claim sets; isolate then archive legacy Box/pack flows.
- `avatar_links/` — optional allowlisted ownership adapter, exactly-once actor binding, custody association, and offstage policy.
- `rpg/` — clocks, tags, bonds, journal, jobs, fronts (and later covenants).
- `ai_gateway/` — see priority 3.
- `persistence.rs` — journal, events, snapshot, sessions.
- `moderation.rs` — reports, suspension, protected views.

Rule going forward: **no major new system lands in `main.rs`.** `npm run v2:architecture` ratchets its total physical line count, including inline tests, and the Rust clippy warning count. Extracted systems take their tests with them. A deliberate exception must raise the matching ceiling in the same reviewed diff; every shrink lowers it again. Card-zone and scene-composition work, crafting, media jobs, the avatar-link adapter, and legacy ownership migration each arrive as modules. Decomposition is mechanical (move code, keep tests green under `./v2/mvp.sh check`), not a rewrite.

### 2. Economy circulation

Implements PRD "Now" #4, from the live economy audit:

- Wire the designed-but-dormant job Orb payouts (`jobs.json` rewards) so Work/Help pay.
- Witness credit: a claim-keyed Journal mark for players present when a resident claims a desired item or evolves — aligning resident autonomy with player reward.
- Ghost-item recovery: resident desire-hunts extend to items held by presence-inactive avatars, pulling leaked uniques back into circulation.
- Season scoping: claim keys fold in a season id that increments on played world-ticks, so exhausted faucets (listen rewards, encounter rewards) reopen through play — never through a scheduler.
- Enforce the decided Orbs identity: the only negative mutation is a pooled community image contribution; tune faucets against level-based image demand.

### 3. Finish `ai_gateway`

`v2/orchestrator-rust/src/ai_gateway.rs` owns OpenAI-compatible/OpenRouter text configuration, bounded retries, stable failure codes, and tracing. Dialogue inference fails closed without substitute speech and never touches Orbs. Card commits persist a delayed player-tick observation; one pending/running job per room coalesces rapid plays, and the resident prompt combines the triggering event with recent room-log/card history, recent speech, cast, place, goals, and continuity. The first community card-art worker validates a durable level-scoped pool before calling Replicate; remaining gateway work is a provider-neutral durable queue, object storage, recovery of funded jobs after restart, usage-ledger ownership, and model capability discovery. Design detail: `AI.md`.

### 4. Media pipeline

Durable `media_jobs`/`media_assets` (idempotent, contributor-attributed, intent-typed) replacing the current inline Replicate community-card worker. First intents: `avatar_card_art`, `item_card_art`, `location_card_art`; scene media remains system-funded. Provider order: OpenRouter image models → Replicate (already integrated) → deterministic placeholder. Generated media attached to a shared card is public world media. Schemas and backlog: `AI.md`, `docs/backlog/community-art-evolution.md`.

### 5. Moderation and abuse hardening

The gap between "operator console exists" and "open public traffic":

- Pre-commit content filtering on player-typed text and AI output, beyond the current sanitizer — this becomes load-bearing when crafting starts naming items.
- Resident line-variety cooldowns: ambient and autonomy lines rotate through authored pools with per-(actor, behavior, context) claim discipline — no more identical lines thirteen times in a feed.
- Turn legibility: visible ping countdowns on both sides, a "you've been pinged — play or pass" signal for the current player, and collapsed/updating rows for repeated turn events.
- Operator workflow with a resolution-time target; richer mute/timeout primitives between "nothing" and suspension; per-room AI spend budgets; a written abuse-response runbook before wide traffic.

### 6. RPG runtime: covenants, the living frontier, and arrangement evolution

Implements PRD "Next", per RPG Bible Phases 4–6 plus the arrangement-evolution adoption:

- Finish Phase 2/4 follow-ups: covenant contribution as a growth spend; job rewards/consequences/completion memory; Use/Give/combat moving job clocks.
- Covenant sheets and reducers: boons, hooks, resources, projects, reputation, per-member loyalty (Phase 5) — including the renewable sanctuary verbs (tend/brew/promise) driven by room-sheet resources.
- Extend the live player-turn world pulses beyond classified ambient weather, opportunity-level trade/faction/conflict, and consented danger-clock escalation: let stakes spawn frontier jobs through audited descriptors, and add smoke coverage for the full consequence chain. Keep the proven assertions that automatic pulses never mutate sanctuary state or turn an unrelated action into stakes.
- **Arrangement evolution.** Generalize the kernel evolution table from "N unique items gained by one actor" to a **placement pattern**: a list of `(item, target)` requirements where a target is an avatar's keeping or a location's floor. The kernel checks satisfaction against state it already owns (item holder/location ids) and remains the sole authority on the evolve event; satisfaction re-checks ride item transfer, placement, search-reveal, and future craft/attunement hooks. Ceremony completion is claim-keyed, pays placer and witness Journal credit through projection, increments the resident once, and leaves the arranged items in their current slots.
- **Generated quest lists per level.** A level's pattern may be generated: AI or tables propose from a closed vocabulary (existing item tags, currently reachable ungated locations, present residents); a fail-closed compiler — the same seam as on-fill descriptors — validates reachability, availability, and safety before the pattern is committed as authoritative jobs. Rejected proposals fall back to authored patterns. No generated pattern may require gated-room access for a free player's core-loop resident.
- On-fill cascade guard (bounded depth, visited set) before content authors get cascading clocks.
- Conflict objectives: objective clocks in danger rooms, durability-absorbs-harm, nonlethal outcomes (Phase 6).

### 7. Crafting and generated content

Implements PRD "Next" #1 — item meets room:

- `recipes.json` in the worldpack: tag-keyed inputs (`warm + bright`, `thread + button`), output templates with fixed type/tags/rules, optional room requirements (forge at hearth), and a `balance` declaration for any new physical item. `check-worldpack.mjs` gains recipe validation: every recipe's inputs are producible, every output's tags resolve, no orphan chains, and every item-creating recipe declares the location/avatar/covenant/evolution capacity it unlocks or feeds.
- Kernel: a `craft` action validates that the actor holds one input and the room floor holds the other, then emits a deterministic craft event keyed by recipe and input item ids. If the recipe creates a physical item, the kernel creates it only into a legal empty slot declared by the recipe: usually the floor of a newly unlocked location, sometimes an existing empty floor or a newly available avatar/resident hand. Inputs are never deleted.
- Projection/AI: the whimsical name and blurb are AI proposals in the Adjective-Noun house voice, sanitized, with authored fallback names per recipe. Craft events can set room/item tags, unlock exits, reveal locations, call residents, and feed the media pipeline for card art.
- Provenance tie-in: a craft result is a physical world item when the recipe declares one and carries a canonical craft receipt with lineage from both ingredients. Presentation cards project that item and receipt; they do not create a transferable ownership plane.
- Balance and anti-deadlock: search tables bias toward ingredients and arrangement needs not currently represented nearby. Authored supply, claim keys, and played-time seasons bound faucets; weight, size, containers, typed slots, exhaustion, readiness, recharge, access, and placement bound usable supply. Every recipe that creates a physical item must declare the capacity, desire, route, or story possibility it adds, and content-ratio validation must prove that output has a reachable use.

### 8. Avatar-link boundary and legacy ownership retirement

Implement ADR 0006 through three bounded paths:

- #688 generalizes the Project 89 pilot into an optional allowlisted adapter:
  verified asset identity and custody in, exactly one durable autonomous actor
  binding out.
- #682 removes keepsake, Box/bundle, item/location NFT, wallet-gate, and native
  transferable-card surfaces from ordinary runtime and UI dependencies.
- #685 disables new item materialization before converting or archiving every
  existing receipt exactly once, without duplicating or losing a live world
  item.

Keep the C kernel wallet-blind. Persist immutable first-link and migration
receipts, freeze association changes on stale/contradictory ownership data,
apply transfer/unlink only at safe boundaries, and prove the default golden
journey without any wallet configuration.

### 9. Content pipeline

The worldpack is the designer contract. Keep `check-worldpack.mjs` strict and extend it as schemas grow (recipes, recipe balance declarations, placement patterns, item pools, and covenants). Add migration support for content id changes, and grow the `--report-json` inspector toward designer tooling. Kernel ids stay stable across content revisions; generated content (quest lists, crafted names) is committed content once accepted, subject to the same validation as authored content.

### 10. Production operations

- The container is host-agnostic: the root `Dockerfile` builds the release
  orchestrator, and the current application deployment target is **Fly**.
  Pushes to `main` and version tags deploy the same immutable image to the
  `cosyworld` and `lonelyforest` Fly apps through
  `.github/workflows/deploy.yml`. AWS remains authoritative for the
  `lonelyforest.com` Route 53 zone and the static
  `lonelyforestlibrary.com` S3/CloudFront site; dormant ECS/EFS/ALB resources
  exist only for the documented rollback window. The runtime contract remains
  host-agnostic: a persistent volume at `/data`, the production-profile env
  (optional protected avatar-ownership adapter when configured, SQLite event store, moderation token,
  process id), and `/meta` as the deploy smoke surface.
- Keep legacy ownership reconciliation observable and fail-closed during archival. Do not make ordinary production boot depend on Ruby High, Solana RPC capacity, or a broad ownership feed.
- SQLite backup, retention, and restore-drill policy for `/data`.
- Observability past `/meta`: request/latency metrics, AI provider and dialogue inference failure rates, ledger anomaly counts, ping-to-skip rates.
- World hygiene rituals: a documented wipe/reset procedure before playtests (no smoke-avatar residue in first impressions), and presence/turn eligibility windows tuned so ghosts are rare rather than merely skippable.
- Keep resident placement player-powered: overlap tie rotation uses world-tick seasons rather than wall-clock days, and future placement changes should be audited world actions rather than invisible time.
- Disable new Box burns before receipt migration; retain only the verifier, support search, alerts, and retention controls needed to audit historical receipts safely.

## The Hand as Transport Contract

The shipped control surface — server-ranked action offers dealt as a labeled card hand with a detail/confirm step — is also the portable contract for every future client. Offers already carry category, target, cost, risk, and claim metadata, so a Discord transport projects cards as reactions on the room message (the v1 swarm's emoji-to-tool grammar in `src/services/tools/ToolService.mjs` is the prior art), the terminal maps them to keys, and no new server concepts are needed. Two laws travel with it: every card renders a label (never a bare glyph), and browsing is free — only a committed play consumes a turn.

## API Conventions

The route table lives in `v2/orchestrator-rust/src/routes.rs`; operational docs in `v2/README.md`. Conventions all new endpoints follow:

- Player mutations require `actor_id` + matching `actor_session`. Only the optional avatar-link/custody adapter requires `wallet_session`; ordinary access and expansion play do not. Wrong/missing session → `403`, never a silent fallback to another identity.
- Rejected input → `400` with no world event; rate limit → `429`; duplicate in-flight turn → `409`; not-your-turn → `423` with a `turn.waiting` event and a human-readable reason on the typed path; irreversible flows are idempotent by explicit key.
- Turn consumption follows the fixed taxonomy (invariant 7); new verbs declare turn-consuming or turn-exempt at review time.
- New player-visible state goes through `/state` / `/world` projections and the `/stream` event contract — clients never get a side channel.
- Typed commands route through `/commands` and resolve to the same action endpoints; the parser lives in `mud.rs`.
- Operator surfaces live under `/moderation/*` behind the bearer token, bounded and no-store.

## Testing and Gates

`./v2/mvp.sh check` is the local merge gate and must stay green: worldpack validation, C kernel tests, AI-model native tests + WASM build, Rust fmt/tests/build, JS/CLI syntax checks, the hermetic production-profile smoke, the Playwright browser smoke (including two-browser fanout, turn-taking, moderation, economy, combat, evolution), terminal smokes, and visual-baseline comparison (3% pixel tolerance; refresh intentionally with `COSYWORLD_UPDATE_VISUAL_BASELINES=1`).

Standing rules for new work:

- Every new rule or reward ships with at least one test or smoke assertion on its authoritative path, per the RPG Bible's acceptance criteria.
- Every new claim key states its intended repeatability in review; NPC behaviors carry the same discipline.
- Every new core world verb demonstrates its deterministic non-AI path and declares its turn taxonomy. Dialogue capabilities demonstrate visible, uncharged failure when inference is unavailable.
- New persistent state is added to snapshot/journal handling in the same change (a claim set that isn't persisted re-mints on restart).
- Generated-content paths (crafted names, quest lists) ship with their compiler rejection tests: an invalid proposal must fail closed to the authored fallback, visibly in the audit trail.
- The multi-card carrying migration lands with weight/size/container coverage, multiple loose room items, capacity-aware search and drop behavior, non-consuming two-player ceremonies, and replay-safe craft receipts without input deletion.
- UI changes that alter the shell update visual baselines deliberately, never as drive-by churn.

## Deployment and Scale

The current `COSYWORLD_DEPLOY_PROFILE=production` still requires the protected remote ownership feed + bearer when the active compatibility composition declares that authority. #682 removes that requirement from the default/core target; only a configured avatar adapter may require its protected feed. SQLite event storage, moderation, process identity, and disabled dev shortcuts remain production requirements. Kernel capacities are compiled (1024 actors, 1024 items, 2048 locations, 4096 exits) and exposed with live counters on `/meta`; approaching them is a sharding conversation, not a hot patch. Locations and exits are sized so a single world can mount every authored pack at once — that union currently seeds 555 locations and 1151 exits — with room for generated pathway descendants. Actors and items are not: the same union seeds 565 actors and 540 items, which leaves under half of each cap for live play. Track live-item growth against authored faucet bounds and content-ratio validation; raise a capacity or retention decision before the item counter approaches its compiled cap.

Scale model: one shard per process, isolated stores, route players to their shard at a layer above. Revisit only when a single world's concurrency actually demands it.

## Open Questions

- **Community image governance.** Orbs now have one identity and one sink. Open questions are how items/locations gain authoritative levels, how a community previews history input, and how moderation replaces an inappropriate ready image without charging again.
- **Generated-pattern curation.** Do generated evolution quest lists go live automatically after compiler validation, or behind an operator approve queue for the first season? Start curated, measure rejection rates, then decide.
- **Avatar metadata allowlist.** Which reviewed cosmetic fields may refresh without changing canonical actor identity, voice, continuity, or mechanics? Start with appearance-only fields and pin every identity/mechanical fact at first link.
- **Kernel promotion policy.** Prepare/Rest/Work/Help are projection verbs; the standing answer is "move a verb into C only when it needs hard authority" — each promotion should record why. Search-reveal goes straight to the kernel because it creates a physical item placement; craft goes to the kernel because it must validate item co-presence, create any physical output in a legal slot, and emit an authoritative provenance event even when inputs are not consumed. Listen-absorbs-bank stays projection.
- **SQLite ceiling.** Per-shard SQLite is fine now; define the signals (write contention, backup size, multi-reader needs) that would trigger a storage change rather than deciding one prematurely.
- **Legacy Node companion.** Which integrations (Discord bridge, media references) are worth porting as adapters over the V2 API, and when does the rest get archived?
