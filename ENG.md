# CosyWorld Engineering Plan

Last major revision: 2026-07-02. This document replaces the CosyWorld 2.0 engineering plan, which was written before the V2 runtime existed. The architecture it proposed is now built and live-tested with simultaneous players; this document describes that architecture as it stands and sets the engineering priorities from here — including the one-slot world, non-consuming arrangement evolution, and crafting adopted in `PRD.md`.

Companion documents:

- `PRD.md` — product direction this plan serves, including The One-Slot World rules.
- `docs/systems/09-cosyworld-rpg-system.md` (the RPG Bible) — authoritative RPG mechanics design, phase status, on-fill descriptor spec, claim-key spec, and ownership-chain design.
- `AI.md` — AI gateway, payer modes, and media pipeline design detail.
- `ECONOMY.md` — economy and NFT-bridge design detail.
- `GAP.md` — per-surface implementation status audit.
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
2. **World time is played time.** No wall-clock world mutation, ever: clocks, fronts, resident behavior, encounter resets, and seasons advance only on committed player turns. Wall-clock time is permitted only for abuse guardrails (rate limits, ping countdowns, presence TTLs) — things that pace *players*, never things that change the *world*.
3. **AI proposes; it never mutates.** Every AI output is validated, sanitized, and committed as a public event or discarded. AI never grants items, fills clocks, deepens bonds, changes access, or spends currency directly. This extends to generated content: crafted-item names and generated evolution quest lists are proposals that must survive a fail-closed compiler before becoming authoritative.
4. **Events are append-only and replayable.** The journal is the source of truth; snapshots are disposable. Every visible dice roll carries die, roll, modifier, total, and DC/AC.
5. **Every mint, spend, ledger mark, and one-shot effect is claim-key gated.** Keys are pure functions of authoritative facts — never wall-clock time or RNG. Review checks key granularity in both directions (too coarse swallows legitimate repeats; too fine lets retries double-mint). This applies to NPC behavior too: resident ambient lines and autonomous acts carry cooldown/claim discipline like player rewards.
6. **The client is untrusted.** Affordability, access, ownership, outcomes, and primary-action state are server-derived. Client-supplied card ids are ignored outside explicit local dev flags.
7. **Turn discipline has a fixed taxonomy.** Committed cards consume a room turn; `say`, `/me`, `report`, and reads never do; browsing the hand is free. A present player is never hostage to an absent one — ping/pong (or its successor) must always provide a bounded path past an unresponsive turn-holder.
8. **Core world actions do not depend on AI.** Travel, Listen, Search, item actions, growth, projects, and conflict keep deterministic kernel paths. Dialogue is an explicit inference capability: when unavailable it fails visibly before charging or committing speech, and incidental replies are skipped.
9. **The kernel stays wallet-blind and IO-free.** Stable numeric ids, type flags, and rule fields only. Ownership feeds, card metadata, signatures, and money are Rust concerns.
10. **One shard per process.** A process owns one world, one store, one stream. Horizontal scale is more processes with isolated state; cross-shard routing is out of scope this era.
11. **Structured content over free-form.** Anything that can change authoritative state — clock on-fill effects, crafting recipes, generated evolution patterns — is a closed-vocabulary descriptor that compiles to kernel actions or typed projection mutations, dry-run validated, fail-closed.

## Current State

`GAP.md` is the detailed audit. The one-paragraph version: the kernel, orchestrator, avatar gate, server-authored Chat, moderated `say`, shared live rooms with room turns and ping/pong pacing, resident autonomy (wandering, desire-driven pickup), transcript-rendered world feedback (arrivals, callings, clues, dice, growth), items/evolution, card projection, wallet-gated expansion access, economy MVP (Orbs, claim keys, OpenRouter payer, Box/pack bridge with production burn verification), moderation basics (reports, console, suspension), the RPG layer first slice (Callings, Bonds, Clocks, Jobs, Fronts, Visit Ledger, Prepare/Rest/Work/Help, skill training), the deterministic played-time frontier simulation (weather, trade, faction movement, conflict, distant history), both clients, and the production deploy profile are all live and covered by `./v2/mvp.sh check`. Live mixed human/agent multiplayer has been validated on a running shard. The remaining work is the one-slot migration, economy circulation, decomposition, media, and the designed-but-unbuilt systems (crafting, covenants, front-spawned jobs, native ownership chain).

## Engineering Priorities

Ordered. Priorities 1–3 are the foundation everything else builds on.

### 1. Decompose the orchestrator

`v2/orchestrator-rust/src/main.rs` is ~39,000 lines. `routes.rs`, `mud.rs`, `kernel.rs`, and `turns.rs` are extracted — `turns.rs` is the model: a system that arrived as its own module with its own tests. Continue along the seams that exist:

- `world/` — world projection, presence, placement, resident autonomy.
- `cards.rs` — card projection and asset resolution.
- `economy/` — Orb ledger, claim sets, Box/pack flows.
- `rpg/` — clocks, tags, bonds, journal, jobs, fronts (and later covenants).
- `ai_gateway/` — see priority 4.
- `persistence.rs` — journal, events, snapshot, sessions.
- `moderation.rs` — reports, suspension, protected views.

Rule going forward: **no major new system lands in `main.rs`.** The one-slot kernel work, crafting, media jobs, and the ownership chain each arrive as modules. Decomposition is mechanical (move code, keep tests green under `./v2/mvp.sh check`), not a rewrite.

### 2. The one-slot world

Implements PRD "Now" #1 — the kernel-level cut that fixes room exhaustion and creates the circulating economy:

- Kernel: avatar inventory capacity 1; location floor capacity 1; take becomes swap-with-room (atomic: held ↔ floor); drop requires an empty floor.
- Kernel: a `search` action that can reveal an item onto an empty floor, drawn from the room's pool (worldpack-seeded, later craft-fed). The gate is floor emptiness — world state, not a claim key. The faucet is balanced by occupied slots, not by deleting items.
- Projection: listen absorbs bank — a listen resolves the truth check *and* settles unbanked marks into growth in one action; the standalone bank card retires. Keep the growth moment loud in the transcript.
- Item effects are non-consuming by default: use/craft/evolution may decrement readiness, set tags, emit events, mint cards, create new physical items, or require recharge, but must not remove physical input instances from the world. Physical item creation must be paired with declared new capacity or demand so the one-slot economy stays balanced.
- Evolution moves from item-gain counting to placement-pattern satisfaction. During migration, the existing item-gain hook can be one trigger for re-checking satisfaction, but the target rule is "does the current world arrangement match the track?" rather than "did this actor gain enough items?"
- Migration is a world reset, shipped as one package: kernel changes + worldpack item-pool schema + smoke rework (evolution ceremony as a two-actor flow) + updated visual baselines. Half a one-slot world must never be deployed.

### 3. Economy circulation

Implements PRD "Now" #4, from the live economy audit:

- Wire the designed-but-dormant job Orb payouts (`jobs.json` rewards) so Work/Help pay.
- Witness credit: a claim-keyed Journal mark for players present when a resident claims a desired item or evolves — aligning resident autonomy with player reward.
- Ghost-item recovery: resident desire-hunts extend to items held by presence-inactive avatars, pulling leaked uniques back into circulation.
- Season scoping: claim keys fold in a season id that increments on played world-ticks, so exhausted faucets (listen rewards, encounter rewards) reopen through play — never through a scheduler.
- Write down the Orbs identity decision (AI meter funneling to BYOK vs. renewable play energy) and tune faucets to match.

### 4. Finish `ai_gateway`

`v2/orchestrator-rust/src/ai_gateway.rs` now owns OpenAI-compatible/OpenRouter provider configuration, the shared chat-completion client, per-feature timeouts, bounded retry policy, stable failure codes, and provider/model/attempt/latency tracing. Domain routes keep auth, target validation, idempotency, Orb affordability, and spend-after-commit; the kernel keeps legality. Dialogue inference fails closed without substitute speech. Remaining gateway work is transient player-payer resolution, key verification, usage-ledger ownership, model capability discovery, and moving Replicate/media calls behind the same boundary. This is the precondition for media jobs, per-room AI spend budgets, and generated content (crafted names, evolution quest lists). Design detail: `AI.md`.

### 5. Media pipeline

Durable `media_jobs`/`media_assets` (idempotent, payer-attributed, intent-typed) replacing the current inline Replicate avatar path. First intents: `avatar_portrait`, `avatar_card_art`, `room_scene`; crafted-item card art joins once crafting lands. Provider order: OpenRouter image models → Replicate (already integrated) → deterministic placeholder. Generated media attached to a shared avatar, card, or room is public world media. Schemas: `AI.md`.

### 6. Moderation and abuse hardening

The gap between "operator console exists" and "open public traffic":

- Pre-commit content filtering on player-typed text and AI output, beyond the current sanitizer — this becomes load-bearing when crafting starts naming items.
- Resident line-variety cooldowns: ambient and autonomy lines rotate through authored pools with per-(actor, behavior, context) claim discipline — no more identical lines thirteen times in a feed.
- Turn legibility: visible ping countdowns on both sides, a "you've been pinged — play or pass" signal for the current player, and collapsed/updating rows for repeated turn events.
- Operator workflow with a resolution-time target; richer mute/timeout primitives between "nothing" and suspension; per-room AI spend budgets; a written abuse-response runbook before wide traffic.

### 7. RPG runtime: covenants, the living frontier, and arrangement evolution

Implements PRD "Next", per RPG Bible Phases 4–6 plus the arrangement-evolution adoption:

- Finish Phase 2/4 follow-ups: covenant contribution as a growth spend; job rewards/consequences/completion memory; Use/Give/combat moving job clocks.
- Covenant sheets and reducers: boons, hooks, resources, projects, reputation, per-member loyalty (Phase 5) — including the renewable sanctuary verbs (tend/brew/promise) driven by room-sheet resources.
- Extend the live player-turn world pulses beyond classified ambient weather, opportunity-level trade/faction/conflict, and consented danger-clock escalation: let stakes spawn frontier jobs through audited descriptors, and add smoke coverage for the full consequence chain. Keep the proven assertions that automatic pulses never mutate sanctuary state or turn an unrelated action into stakes.
- **Arrangement evolution.** Generalize the kernel evolution table from "N unique items gained by one actor" to a **placement pattern**: a list of `(item, target)` requirements where a target is an avatar's keeping or a location's floor. The kernel checks satisfaction against state it already owns (item holder/location ids) and remains the sole authority on the evolve event; satisfaction re-checks ride item transfer, placement, search-reveal, and future craft/attunement hooks. Ceremony completion is claim-keyed, pays placer and witness Journal credit through projection, increments the resident once, and leaves the arranged items in their current slots.
- **Generated quest lists per level.** A level's pattern may be generated: AI or tables propose from a closed vocabulary (existing item tags, currently reachable ungated locations, present residents); a fail-closed compiler — the same seam as on-fill descriptors — validates reachability, availability, and safety before the pattern is committed as authoritative jobs. Rejected proposals fall back to authored patterns. No generated pattern may require gated-room access for a free player's core-loop resident.
- On-fill cascade guard (bounded depth, visited set) before content authors get cascading clocks.
- Conflict objectives: objective clocks in danger rooms, durability-absorbs-harm, nonlethal outcomes (Phase 6).

### 8. Crafting and generated content

Implements PRD "Next" #1 — item meets room:

- `recipes.json` in the worldpack: tag-keyed inputs (`warm + bright`, `thread + button`), output templates with fixed type/tags/rules, optional room requirements (forge at hearth), and a `balance` declaration for any new physical item. `check-worldpack.mjs` gains recipe validation: every recipe's inputs are producible, every output's tags resolve, no orphan chains, and every item-creating recipe declares the location/avatar/covenant/evolution capacity it unlocks or feeds.
- Kernel: a `craft` action validates that the actor holds one input and the room floor holds the other, then emits a deterministic craft event keyed by recipe and input item ids. If the recipe creates a physical item, the kernel creates it only into a legal empty slot declared by the recipe: usually the floor of a newly unlocked location, sometimes an existing empty floor or a newly available avatar/resident hand. Inputs are never deleted.
- Projection/AI: the whimsical name and blurb are AI proposals in the Adjective-Noun house voice, sanitized, with authored fallback names per recipe. Craft events can set room/item tags, unlock exits, reveal locations, call residents, and feed the media pipeline for card art.
- Ownership tie-in: a craft result is both a physical world item when the recipe declares one and a native card mint bound to the craft event with `parent_merkle` lineage from both ingredients — the play-side mint faucet of the provenance log (priority 9). The card collection and the physical item slot remain separate surfaces.
- Balance and anti-deadlock: search tables bias toward ingredients and arrangement needs not currently represented nearby; any item can always be placed on an empty floor. Economy balance comes from one-slot saturation, player logistics, and content-ratio validation: as expansions add crafted items, they must also add or unlock enough locations, avatar/resident hands, and arrangement needs for those items to circulate.

### 9. Native ownership chain

The signed provenance log from the RPG Bible: Ed25519 identities, content-addressed card types, `card_events` (mint/transfer/gift/swap) signed per authority, ownership as a verified fold over the log, gifting, world-bound co-signed trading, and commit-reveal poem claims. Reuse the sibling `signal` project's `chain_log`/`signal_verify` substrate. Run federated (operator authority, quorum 1) first. The kernel stays out of it entirely; mints bind to kernel world events by `because: event_id` — pack reveals and craft events are the two mint faucets. Schemas and route shapes: `ECONOMY.md` and the RPG Bible.

### 10. Content pipeline

The worldpack is the designer contract. Keep `check-worldpack.mjs` strict and extend it as schemas grow (recipes, recipe balance declarations, placement patterns, item pools, and covenants). Add migration support for content id changes, and grow the `--report-json` inspector toward designer tooling. Kernel ids stay stable across content revisions; generated content (quest lists, crafted names) is committed content once accepted, subject to the same validation as authored content.

### 11. Production operations

- The container is host-agnostic: the root `Dockerfile` builds the release orchestrator; the current deployment target is **AWS** (with `fly.toml` retained for Fly). The contract is identical everywhere: a persistent volume at `/data`, the production-profile env (protected ownership feed + bearer, SQLite event store, moderation token, shard id), and `/meta` as the deploy smoke surface.
- Restore Ruby High's upstream Solana RPC capacity, deploy the ownership-feed health telemetry, and rerun the hosted smoke against the actual protected export. The hosted path is configured and has been exercised, but the export currently fails on upstream RPC quota exhaustion.
- SQLite backup, retention, and restore-drill policy for `/data`.
- Observability past `/meta`: request/latency metrics, AI provider and dialogue inference failure rates, ledger anomaly counts, ping-to-skip rates.
- World hygiene rituals: a documented wipe/reset procedure before playtests (no smoke-avatar residue in first impressions), and presence/turn eligibility windows tuned so ghosts are rare rather than merely skippable.
- Keep resident placement player-powered: overlap tie rotation uses world-tick seasons rather than wall-clock days, and future placement changes should be audited world actions rather than invisible time.
- Deploy and smoke the configured production Box burn builder/verifier, then extend the protected reconciliation resolution console with support search, alerts, and retention policy.

## The Hand as Transport Contract

The shipped control surface — server-ranked action offers dealt as a labeled card hand with a detail/confirm step — is also the portable contract for every future client. Offers already carry category, target, cost, risk, and claim metadata, so a Discord transport projects cards as reactions on the room message (the v1 swarm's emoji-to-tool grammar in `src/services/tools/ToolService.mjs` is the prior art), the terminal maps them to keys, and no new server concepts are needed. Two laws travel with it: every card renders a label (never a bare glyph), and browsing is free — only a committed play consumes a turn.

## API Conventions

The route table lives in `v2/orchestrator-rust/src/routes.rs`; operational docs in `v2/README.md`. Conventions all new endpoints follow:

- Player mutations require `actor_id` + matching `actor_session`; expansion access adds `wallet_session`. Wrong/missing session → `403`, never a silent fallback to another identity.
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
- The one-slot migration lands with reworked multi-actor smoke coverage (two-player non-consuming ceremony, swap semantics, search-faucet cycling, craft-created item placed in a legal new/empty slot, craft-event mint without input deletion) in the same change as the kernel cut.
- UI changes that alter the shell update visual baselines deliberately, never as drive-by churn.

## Deployment and Scale

`COSYWORLD_DEPLOY_PROFILE=production` refuses to boot without the protected remote ownership feed + bearer, the SQLite event store, a moderation token, a shard id, and with any dev shortcut enabled. Kernel capacities are compiled (512 actors, 1024 items, 256 locations, 1024 exits) and exposed with live counters on `/meta`; approaching them is a sharding conversation, not a hot patch. Note the one-slot world changes item-count pressure: total live items trend toward locations + actors, far under the compiled cap.

Scale model: one shard per process, isolated stores, route players to their shard at a layer above. Revisit only when a single world's concurrency actually demands it.

## Open Questions

- **Orbs identity.** AI-cost meter that funnels engaged players to BYOK, or renewable play energy? The code currently says the first, the docs say the second; priority 3 forces the written decision.
- **Generated-pattern curation.** Do generated evolution quest lists go live automatically after compiler validation, or behind an operator approve queue for the first season? Start curated, measure rejection rates, then decide.
- **Player identity for the ownership chain.** When is the Ed25519 keypair generated, where does it live, and what is recovery? (Wallet-linked recovery exists; a native keypair story does not yet.)
- **Kernel promotion policy.** Prepare/Rest/Work/Help are projection verbs; the standing answer is "move a verb into C only when it needs hard authority" — each promotion should record why. Search-reveal goes straight to the kernel because it creates a physical item placement; craft goes to the kernel because it must validate item co-presence, create any physical output in a legal slot, and emit an authoritative provenance event even when inputs are not consumed. Listen-absorbs-bank stays projection.
- **SQLite ceiling.** Per-shard SQLite is fine now; define the signals (write contention, backup size, multi-reader needs) that would trigger a storage change rather than deciding one prematurely.
- **Legacy Node companion.** Which integrations (Discord bridge, media references) are worth porting as adapters over the V2 API, and when does the rest get archived?
- **P2P quorum trigger.** Federation (quorum 1) is the plan of record; name the concrete condition — shard count, operator-trust incident, community demand — that funds the P2P endpoint.
