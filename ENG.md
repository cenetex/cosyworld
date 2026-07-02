# CosyWorld Engineering Plan

Last major revision: 2026-07. This document replaces the CosyWorld 2.0 engineering plan, which was written before the V2 runtime existed and accumulated amendments as the system shipped. The architecture it proposed is now built; this document describes that architecture as it stands and sets the engineering priorities from here.

Companion documents:

- `PRD.md` — product direction this plan serves.
- `docs/systems/09-cosyworld-rpg-system.md` (the RPG Bible) — authoritative RPG mechanics design, phase status, on-fill descriptor spec, claim-key spec, and ownership-chain design.
- `AI.md` — AI gateway, payer modes, and media pipeline design detail (tables, routes, provider order).
- `ECONOMY.md` — economy and NFT-bridge design detail.
- `GAP.md` — per-surface implementation status audit.
- `v2/README.md` — runtime operations guide: run, deploy, endpoints, environment.

## System Shape

CosyWorld V2 is the canonical runtime. It is a deliberately layered system where authority narrows as you go down:

```
Clients        browser one-button shell (index.html) · terminal CLI (v2/cli) · smoke/ops scripts
               │  HTTP + SSE, actor_session / wallet_session
Rust           orchestrator (v2/orchestrator-rust): routes, SSE fanout, sessions, rate limits,
orchestrator   moderation, ownership feeds, card projection, economy ledgers, clocks/tags/bonds/
               jobs/fronts projection, AI calls, media, persistence, ambient scheduling
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
2. **AI proposes; it never mutates.** Every AI output is validated, sanitized, and committed as a public event or discarded. AI never grants items, fills clocks, deepens bonds, changes access, or spends currency directly.
3. **Events are append-only and replayable.** The journal is the source of truth; snapshots are disposable. Every visible dice roll carries die, roll, modifier, total, and DC/AC.
4. **Every mint, spend, ledger mark, and one-shot effect is claim-key gated.** Keys are pure functions of authoritative facts — never wall-clock time or RNG. Review checks key granularity in both directions (too coarse swallows legitimate repeats; too fine lets retries double-mint). The full spec lives in the RPG Bible.
5. **The client is untrusted.** Affordability, access, ownership, outcomes, and primary-action state are server-derived. Client-supplied card ids are ignored outside explicit local dev flags.
6. **Every primary verb has a deterministic non-AI path.** No feature ships with an AI-only happy path.
7. **The kernel stays wallet-blind and IO-free.** Stable numeric ids, type flags, and rule fields only. Ownership feeds, card metadata, signatures, and money are Rust concerns.
8. **One shard per process.** A process owns one world, one store, one stream. Horizontal scale is more processes with isolated state; cross-shard routing is out of scope this era.
9. **Structured content over free-form.** Anything that can change authoritative state — including clock on-fill effects — is a closed-vocabulary descriptor that compiles to kernel actions or typed projection mutations, dry-run validated, fail-closed.

## Current State

`GAP.md` is the detailed audit. The one-paragraph version: the kernel, orchestrator, avatar gate, server-authored Chat, moderated `say`, shared live rooms, items/evolution, card projection, wallet-gated expansion access, economy MVP (Orbs, claim keys, OpenRouter payer, Box/pack bridge with production burn verification), moderation basics (reports, console, suspension), the RPG layer first slice (Callings, Bonds, Clocks, Jobs, Fronts, Visit Ledger, Prepare/Rest/Work/Help, skill training), both clients, and the production deploy profile are all live and covered by `./v2/mvp.sh check`. The remaining work is hardening, decomposition, media, and the designed-but-unbuilt systems (covenants, player-turn fronts, native ownership chain).

## Engineering Priorities

Ordered. The first two are preconditions for most of the rest.

### 1. Decompose the orchestrator

`v2/orchestrator-rust/src/main.rs` is ~39,000 lines. `routes.rs`, `mud.rs`, and `kernel.rs` are already extracted; continue along the seams that exist:

- `world/` — world projection, presence, placement.
- `cards.rs` — card projection and asset resolution.
- `economy/` — Orb ledger, claim sets, Box/pack flows.
- `rpg/` — clocks, tags, bonds, ledger, jobs, fronts (and later covenants).
- `ai_gateway/` — see priority 2.
- `persistence.rs` — journal, events, snapshot, sessions.
- `moderation.rs` — reports, suspension, protected views.

Rule going forward: **no major new system lands in `main.rs`.** Covenants, media jobs, and the ownership chain each arrive as modules. Decomposition is mechanical (move code, keep tests green under `./v2/mvp.sh check`), not a rewrite.

### 2. Extract `ai_gateway`

AI calls are still inline. The gateway module owns provider routing (OpenAI-compatible, OpenRouter, Replicate), payer-mode resolution (`player_openrouter_transient`, `cosyworld_orbs`, `cosyworld_system`, `local_fallback`), key verification, timeouts/retries, usage-ledger writes, and model capability discovery. Domain routes keep auth, target validation, and idempotency; the kernel keeps legality. This is the precondition for media jobs and for per-room AI spend budgets. Design detail: `AI.md`.

### 3. Media pipeline

Durable `media_jobs`/`media_assets` (idempotent, payer-attributed, intent-typed) replacing the current inline Replicate avatar path. First intents: `avatar_portrait`, `avatar_card_art`, `room_scene`. Provider order: OpenRouter image models → Replicate (already integrated) → deterministic placeholder. Generated media attached to a shared avatar, card, or room is public world media. Schemas: `AI.md`.

### 4. Moderation and abuse hardening

The gap between "operator console exists" and "open public traffic":

- Pre-commit content filtering on player-typed text and AI output, beyond the current sanitizer.
- Operator workflow with a resolution-time target; richer mute/timeout primitives between "nothing" and suspension.
- Per-room AI spend budgets and provider failure telemetry.
- A written abuse-response runbook before wide traffic.

### 5. RPG runtime: covenants and the living frontier

Implements PRD "Next", per RPG Bible Phases 4–6:

- Finish Phase 2/4 follow-ups: covenant contribution as a banked spend; job rewards/consequences/completion memory; Use/Give/combat moving job clocks.
- Covenant sheets and reducers: boons, hooks, resources, projects, reputation, per-member loyalty (Phase 5).
- Player-turn portent movement: committed player turns can advance frontier-zone clocks, reset spent encounters, or spawn frontier jobs as audited world actions — plus the smoke assertion that sanctuary clocks never move without player action.
- On-fill cascade guard (bounded depth, visited set) before content authors get cascading clocks.
- Conflict objectives: objective clocks in danger rooms, durability-absorbs-harm, nonlethal outcomes (Phase 6).

### 6. Native ownership chain

The signed provenance log from the RPG Bible: Ed25519 identities, content-addressed card types, `card_events` (mint/transfer/gift/swap) signed per authority, ownership as a verified fold over the log, gifting, world-bound co-signed trading, and commit-reveal poem claims. Reuse the sibling `signal` project's `chain_log`/`signal_verify` substrate. Run federated (operator authority, quorum 1) first. The kernel stays out of it entirely; mints bind to kernel world events by `because: event_id`. Schemas and route shapes: `ECONOMY.md` and the RPG Bible.

### 7. Content pipeline

The worldpack is the designer contract. Keep `check-worldpack.mjs` strict and extend it as schemas grow (covenants, higher-level evolution tracks, fallback-line coverage per resident reaction state). Add migration support for content id changes, and grow the `--report-json` inspector toward designer tooling. Kernel ids stay stable across content revisions.

### 8. Production operations

- Run the production profile in staging against Ruby High's actual protected ownership feed (currently only smoke-tested against a local stand-in).
- SQLite backup, retention, and restore-drill policy for `/data`.
- Observability past `/meta`: request/latency metrics, AI provider failure rates, fallback usage, ledger anomaly counts.
- Keep resident placement player-powered: overlap tie rotation uses world-tick seasons rather than wall-clock days, and future placement changes should be audited world actions rather than invisible time.
- Production Box burn transaction construction (confirm-side verification already exists) and reconciliation against Ruby High/chain state.

### Experiment: the four-sign surface

`PRD.md` (The Concept Budget) proposes collapsing the control surface to four intent emoji — 💬 speak, 👀 notice, 🐾 go, ✋ do. Engineering-wise this is a client-side projection, not a new system: the kernel-ranked action offers already carry category, target, cost, and risk metadata, so the four signs are a grouping function over existing offers plus a focus target. No kernel change, no new endpoints; prototype it in the browser shell behind a flag, reuse it as the terminal key map, and note that it is also the exact contract a Discord-reaction transport would need (the v1 swarm's emoji-to-tool grammar in `src/services/tools/ToolService.mjs` is the prior art). Accessibility requirement carries over: each sign renders with a current-focus action label, never as a bare emoji.

## API Conventions

The route table lives in `v2/orchestrator-rust/src/routes.rs`; operational docs in `v2/README.md`. Conventions all new endpoints follow:

- Player mutations require `actor_id` + matching `actor_session`; expansion access adds `wallet_session`. Wrong/missing session → `403`, never a silent fallback to another identity.
- Rejected input → `400` with no world event; rate limit → `429`; duplicate in-flight turn → `409`; irreversible flows are idempotent by explicit key.
- New player-visible state goes through `/state` / `/world` projections and the `/stream` event contract — clients never get a side channel.
- Typed commands route through `/commands` and resolve to the same action endpoints; the parser lives in `mud.rs`.
- Operator surfaces live under `/moderation/*` behind the bearer token, bounded and no-store.

## Testing and Gates

`./v2/mvp.sh check` is the local merge gate and must stay green: worldpack validation, C kernel tests, AI-model native tests + WASM build, Rust fmt/tests/build, JS/CLI syntax checks, the hermetic production-profile smoke, the Playwright browser smoke (including two-browser fanout, moderation, economy, combat, evolution), terminal smokes, and visual-baseline comparison (3% pixel tolerance; refresh intentionally with `COSYWORLD_UPDATE_VISUAL_BASELINES=1`).

Standing rules for new work:

- Every new rule or reward ships with at least one test or smoke assertion on its authoritative path, per the RPG Bible's acceptance criteria.
- Every new claim key states its intended repeatability in review.
- Every new verb demonstrates its deterministic non-AI path.
- New persistent state is added to snapshot/journal handling in the same change (a claim set that isn't persisted re-mints on restart).
- UI changes that alter the shell update visual baselines deliberately, never as drive-by churn.

## Deployment and Scale

The root `Dockerfile` builds the release orchestrator; `fly.toml` runs it with `/data` mounted. `COSYWORLD_DEPLOY_PROFILE=production` refuses to boot without the protected remote ownership feed + bearer, the SQLite event store, a moderation token, a shard id, and with any dev shortcut enabled. Kernel capacities are compiled (512 actors, 1024 items, 256 locations, 1024 exits) and exposed with live counters on `/meta`; approaching them is a sharding conversation, not a hot patch.

Scale model: one shard per process, isolated stores, route players to their shard at a layer above. Revisit only when a single world's concurrency actually demands it.

## Open Questions

- **Player identity for the ownership chain.** When is the Ed25519 keypair generated, where does it live, and what is recovery? (Wallet-linked recovery exists; a native keypair story does not yet.)
- **Kernel promotion policy.** Prepare/Rest/Work/Help are projection verbs; the standing answer is "move a verb into C only when it needs hard authority" — each promotion should record why.
- **SQLite ceiling.** Per-shard SQLite is fine now; define the signals (write contention, backup size, multi-reader needs) that would trigger a storage change rather than deciding one prematurely.
- **Legacy Node companion.** Which integrations (Discord bridge, media references) are worth porting as adapters over the V2 API, and when does the rest get archived?
- **P2P quorum trigger.** Federation (quorum 1) is the plan of record; name the concrete condition — shard count, operator-trust incident, community demand — that funds the P2P endpoint.
