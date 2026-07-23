# CosyWorld 2.0 Code Gap Analysis

## Status Note

This gap analysis was written for the original one-room, `Chat`-only MVP. The runtime has since grown a full RPG layer (Callings, Bonds, Clocks, Jobs, Fronts), advancement-backed Chat, card-driven resident heartbeats, and a typed `say` room-speech action. `docs/systems/09-cosyworld-rpg-system.md` (the RPG Bible) is the more current source for that layer.

## Scope

This compares the current `v2/` implementation against `PRD.md`, `ENG.md`, and the current product direction:

- humans generate an avatar before play;
- `Chat` spends banked advancement to begin a friendship and never accepts player text;
- the separate `say` action allows moderated, player-typed room speech;
- successful scene cards arm one coalescing resident-reply heartbeat with recent channel context;
- locations are shared channels;
- cards/NFT ownership unlocks shared locations rather than private rooms;
- world mutation passes through the C kernel.

The legacy Node/Discord app remains useful reference material. The current MVP implementation lives in `v2/core-c`, `v2/orchestrator-rust`, `v2/cli`, and `v2/scripts`.

## Status Legend

- `Proven`: implemented and covered by tests or smoke.
- `Partial`: implemented enough for local MVP, but not production complete.
- `Missing`: not meaningfully implemented.
- `Risk`: current behavior could undermine the product direction if left unchanged.

## Executive Summary

CosyWorld v2 has crossed from sketch to playable local MVP, and has grown well past the original single-room slice. It now has a deterministic C rules kernel, Rust HTTP/SSE orchestrator, a 48-location official worldpack, one-button browser MUD UI with a typed command palette (`say`, `look`, `go`, `/me`, `report`, `drop`, etc.), terminal client, avatar gate, advancement-backed Chat, contextual resident replies, moderated human-typed `say`, Ruby High card projection, wallet-gated shared locations, item pickup/gifting/trading, level 2 resident evolution, combat primitives, a first-slice RPG layer (Callings, Bonds, Clocks, Jobs, Fronts, Work/Rest/Prepare/Help), Orb banking and skill training, room-scoped event replay, persistence, actor sessions, presence filtering, and a full local smoke gate.

The biggest remaining gaps are production hardening and product polish rather than missing core loop:

- Restore the production Ruby High export's exhausted Solana RPC capacity, deploy feed-health telemetry, and prove a successful hosted refresh.
- Continue splitting Rust domain/projection code into modules before adding larger systems.
- Add production moderation/abuse controls for a single shared world.
- Move generated human avatar art from deterministic SVG into the OpenRouter/card media pipeline.
- Extend the current combat/challenge loop beyond the Moonlit Trail sparring slice.
- Deploy and smoke the production Box burn builder/verifier, then add richer account UI and support search/alerts for burns, avatar pack reveals, and reconciliation history.
- Move resident placement from boot/refresh recalculation toward scheduled audited world actions.
- Expand combat/conditions only where they serve the MUD experience, not as a dashboard.

## Proven MVP Surfaces

### C Kernel Rules

Status: `Proven`.

Evidence:

- `v2/core-c/include/cosy_kernel.h`
- `v2/core-c/src/cosy_kernel.c`
- `v2/core-c/tests/test_kernel.c`
- `./v2/mvp.sh check` compiles and runs the kernel test.

Implemented:

- World bootstrap.
- Actor creation with stats.
- Room speech events by content id.
- Movement through declared exits.
- Gated/blocked movement.
- Ability checks with auditable rolls.
- Item pickup.
- Potion use.
- Evolution item handoff.
- Level 2 evolution after two unique resident-specific items.
- Safe-room combat rejection.
- Attack, defend, and flee primitives.
- Primary action option flags.

Gap:

- Combat is still intentionally small. There is no full initiative scheduler, hidden state, challenge action, or long-running encounter state beyond the current sparring loop.

### Rust Orchestrator

Status: `Proven`.

Evidence:

- `v2/orchestrator-rust/src/main.rs`
- `cargo test --manifest-path v2/orchestrator-rust/Cargo.toml`
- `./v2/mvp.sh check`

Implemented:

- HTTP API and SSE stream.
- Minimal `/health` readiness and `/meta` runtime metadata for deploy/smoke checks.
- Snapshot persistence and SQLite action journal/event feed.
- Actor sessions for generated human avatars.
- Durable wallet-to-avatar links for signed wallet recovery.
- Server-side public avatar name hygiene with neutral fallback for unsafe names.
- Wallet challenge/session flow.
- Server-owned ownership index from inline, file, or remote JSON feed.
- Ruby High First Bell card projection and card image serving.
- CosyWorld seed card projection and generated seed art.
- Room-scoped `/state`, replayable `/events`, shared `/world`, and filtered `/stream`.
- Rate limits for public mutations.
- Ambient resident lines and auditable ambient checks.
- Presence leave and stale-human filtering.
- `./v2/mvp.sh status` prints health plus non-secret runtime metadata.
- `/events` replay defaults to a bounded visible tail and caps explicit `limit` requests.
- Token-protected `/moderation/events` returns bounded all-room audit replay for operators.
- Token-protected actor suspension/unsuspension blocks abusive human avatars from further public actions.

Gap:

- This is still one Rust file. It should be split into modules before adding many more systems.
- SQLite is local-process durability. Production deployment needs explicit backup/migration/retention decisions.
- `/meta` is a deploy smoke surface, not a full observability stack.
- Public moderation is still policy-light; bounded replay and protected suspension reduce blast radius but do not replace moderation queues, reporting, richer mute/ban tools, or retention policy.

### Human Avatar Gate

Status: `Proven`.

Evidence:

- Browser smoke asserts first command is `create avatar`.
- Rust tests cover public entry defaulting to Cottage and actor-session rejection.
- `v2/README.md` documents returning actor sessions.

Implemented:

- New users see Cottage plus `Create Avatar`.
- `/avatar` creates a human actor and opaque actor session.
- `/avatar` recovers the existing linked human actor when called with a signed wallet session.
- `/avatar` sanitizes public display names before they can appear in presence, events, card projections, or prompts.
- Returning players reuse local actor/session.
- Actor id without matching session falls back to the avatar gate.
- Resident actors cannot be controlled as client avatars.

Gap:

- Generated human avatar visuals are deterministic local SVGs, not yet minted/card-pipeline images.
- Wallet recovery is now server-backed, but there is not yet a full account management UX for device lists, revocation, or wallet changes.
- Name hygiene is an MVP guardrail, not a complete moderation system for public traffic.

### Advancement Chat And Card-Driven Channel Dialogue

Status: `Proven`.

Evidence:

- `POST /actions/create-bond`, with `/actions/chat` retained as a legacy alias.
- `POST /actions/say` is live and verified working (manually confirmed 2026-07-01: creates a `message.created` event broadcast to the room). This corrects an earlier version of this doc, which incorrectly claimed `/actions/say` returns `410`; that status apparently described an intermediate build, not current `main`.
- Rust tests cover advancement gating, Bond creation, stable resident priority, delayed heartbeat persistence, and room-level coalescing.
- Prompt tests verify that recent played-card and room-log activity is carried into resident inference.

Implemented:

- `Chat` is shown only when one banked advancement point and an eligible nearby resident make `create_bond` legal.
- Playing Chat spends the point, creates the Bond, passes the room turn, and arms the same delayed reply heartbeat as other scene cards.
- `say` lets a human submit moderated free-text room speech directly; it is a separate turn-exempt action.
- One pending or running heartbeat per room coalesces rapid cards instead of queuing a speech backlog.
- The next active resident is selected in stable authored card order, rotating after the most recent resident speaker.
- Resident prompts include the triggering action, up to ten recent room-log entries, recent spoken lines, location/cast/goals, and durable resident continuity.
- Accepted replies commit through the C `SAY` event path and broadcast as shared room events.

Gap:

- AI output policy is prompt/sanitizer based. Broader moderation is still required before open public traffic.
- Moderators can inspect all-room event history and suspend actors through protected endpoints, but there is no report queue or player-facing appeal/account flow.
- The first heartbeat currently uses a fixed three-second delay; adaptive pacing and per-room observability remain future polish.

### One-Button Browser MUD UI

Status: `Proven` for local MVP, `Partial` for long-term maintainability.

Evidence:

- Browser UI lives in `v2/orchestrator-rust/src/index.html` and is served by `include_str!`.
- Smoke asserts one visible command button through avatar creation, chat, travel, item pickup, gifting, combat, and reload.
- Smoke checks mobile and desktop viewport fit, shell regions, transcript presence, one-button mode, card thumbnails, and location image rendering.
- A Rust source-level contract test checks for the transcript/prompt shell and absence of composer/table UI.

Implemented:

- Terminal-style shared room timeline.
- Sticky top location tab with location art.
- Compact presence chips with avatar/item/location imagery.
- One bottom command in normal play.
- Context focus through room chips changes the one command to `Chat`, `Take`, `Give Item`, `Travel`, `Flee`, `Attack`, `Use`, `Listen`, or `Connect Wallet`.
- No chat text box.
- No debug spreadsheet/table UI.
- Whiskerwind emoji lines include accessible aria labels.

Gap:

- The HTML/CSS/JS is source-separated, but not yet split into frontend modules.
- Browser smoke preserves mobile and desktop runtime screenshots in `.runtime/visual-smoke` and compares them against committed pixel-diff baselines.
- Multi-option future branch scenes are intentionally not implemented.

### Cards, NFTs, And Shared Location Access

Status: `Proven` for dev/prod-shaped feed, `Partial` for deployed production ownership.

Evidence:

- Ruby High catalog/card asset tests.
- Signed wallet smoke unlocks `Library`.
- World projection tests prove shared/public/gated access behavior.
- Ownership refresh test repositions residents from the refreshed feed.

Implemented:

- Every visible actor, item, and location has a card projection.
- Ruby High First Bell cards serve metadata and images from `../app-ruby-high` during development.
- CosyWorld seed cards serve generated SVG art.
- Location card ownership unlocks shared global rooms.
- Client-provided card ids are ignored unless dev trust is enabled.
- Signed Solana wallet sessions unlock server-owned card access.
- Remote JSON ownership feed shape is implemented.
- `COSYWORLD_DEPLOY_PROFILE=production` requires the protected remote Ruby High feed, bearer token, event store, moderation token, and disabled dev shortcuts before startup succeeds.
- `./v2/mvp.sh check` runs a hermetic production-profile smoke with a bearer-protected local Ruby High-style ownership feed.

Gap:

- Production profile wiring is smoke-tested locally, but a hosted/staging deployment still needs an environment-level smoke against Ruby High's actual protected export endpoint.
- CosyWorld-only seed art is placeholder-grade until minted or replaced by the content pipeline.

### Orbs, Wooden Boxes, And Avatar Packs

Status: `Partial` in implementation, `Designed` in `ECONOMY.md`.

Evidence:

- Legacy CosyWorld has item, quest, combat, external payment, and claim-gate systems.
- Ruby High has Solana pack purchase, pack opening, card burn, card ownership export, and reveal provenance systems.
- V2 currently has wallet sessions, ownership feed parsing, card projection, SQLite event storage, advancement-backed Chat, Orb balances, durable Orb/AI usage ledgers, image-only community spends, combat/listen rewards, signed-wallet Box/pack routes, and production confirm-side Solana/Core burn verification.

Implemented:

- MVP Orb balances are stored in the replayable runtime snapshot/action journal and projected into `orb_ledger` when the event store is enabled.
- Human avatar creation grants starter Orbs.
- `/state` reports Orb balance and a level-scoped `community_art` contract on eligible generated cards; legacy Chat-cost fields are always zero.
- advancement-backed Chat, card-driven resident replies, and repeat Listen have no Orb affordability check or ledger spend.
- `/actions/fund-image` atomically pools one contributor Orb, capped at the card's level, and starts Replicate only after full funding.
- Generated avatars, runtime items, and familiar generated pathway locations share the same card-level contract. Ready images replace the projected card asset with a level cache key.
- `ai_usage_ledger` records non-secret system-resident and community-image payer/provider/status metadata.
- Existing listen/combat actions can award Orbs from committed kernel events.
- Automatic Orb awards are claim-key gated by actor/context so repeated identical Listen/combat/flee actions cannot farm duplicate ledger rows.
- `/state` exposes whether the current room's `Listen` reward remains claimable; repeat attempts remain free even after that reward is claimed.
- The current Moonlit Trail loop exposes `Attack`, `Defend`, `Flee`, and meaningful potion `Use` actions through the one-button focus rail.
- Trusted ownership feeds can project active Intricately Carved Wooden Boxes and unopened avatar packs into `/state` counts and access metadata.
- `/nft/boxes/burn-prepare`, `/nft/boxes/burn-confirm`, and `/nft/packs/open` are implemented behind signed wallet sessions, trusted ownership checks, idempotent SQLite receipts, deterministic reveal provenance, and wallet card grants.
- Production profile requires a configured Solana RPC URL and Box Core collection address; `burn-confirm` verifies a confirmed Metaplex Core burn instruction for the Box asset, connected wallet, and collection before writing a production receipt.
- Startup and ownership refresh both merge durable local Box/pack receipts into the effective ownership index, so pack-open card grants survive Ruby High feed refreshes.
- Successful external ownership snapshots are reconciled against local burn/opening receipts before
  those grants are merged. Durable reconciliation runs flag duplicate external owners, burned Boxes
  still reported active, and opened packs still reported unopened through `/moderation/economy`.
- Current `OwnershipIndex` can parse Ruby High-style wallet/card exports and is the right starting point for Box/card projection.
- Current SQLite event store already hosts action journal, projected events, actor sessions, wallet-avatar links, and suspensions; it is the right persistence boundary for economy tables.

Gap:

- Orb reward claims prevent obvious replay farming, but richer balance tuning, daily/encounter cooldown policy, and operator review tools are still needed.
- Community image jobs need a durable provider-neutral queue/object store, startup recovery for fully funded jobs, moderation/replacement tooling, and authoritative item/location levels beyond the current level-1 slice.
- Local Box burn confirmation can still trust the ownership feed plus submitted burn signature for staging. With a configured verifier, production `burn-prepare` now returns a current-blockhash Metaplex Core BurnV1 transaction for the connected owner to sign and send; `burn-confirm` verifies that submitted transaction on-chain before issuing a receipt.
- Minimal Box/pack account focus exists in the top economy chip, including wallet-scoped burn/reveal provenance in the terminal panel, but there is no rich card gallery, full burn-state history, pack art surface, or support-grade provenance viewer.
- Reconciliation evidence, contradiction detection, protected moderator resolution notes, and a
  basic console are implemented. Production still needs support-grade search/alerts and a healthy
  Ruby High chain export to exercise the workflow continuously.

Migration points:

- Use legacy `ItemService` for item semantics and evolution-item inspiration.
- Use legacy `QuestService` for non-typed challenge conditions and Orb award triggers.
- Use legacy `CombatEncounterService` for D&D-shaped outcome rewards.
- Do not reuse legacy `orbGate` as Orbs; it is a collection ownership gate.
- Do not mix legacy x402/USDC pricing into Orbs; external payment rails can later buy Boxes or bundles through a separate bridge.
- Use Ruby High's `billing.ts`, `nft.ts`, `core-pack-nfts.ts`, `hall-pass-nfts.ts`, and `ruby-high-service.ts` as the burn/pack/provenance reference.

### Real AI, Player Payer, And Media

Status: `Partial`.

Evidence:

- V2 has `ai_gateway.rs` for provider configuration, shared OpenAI-compatible requests, timeouts, bounded retries, typed failures, and inference tracing; dialogue plan construction and validation remain in the domain runtime.
- V2 can use a single server OpenAI-compatible/OpenRouter key; dialogue inference fails closed when no model is available.
- Legacy CosyWorld has text AI services, Gemini composition, Selfie/Scene camera tools, and battle media prompts.
- Ruby High has OpenRouter PKCE, transient browser-held user keys, avatar-line generation, portrait generation, and reference-based class/graduation photos.
- `AI.md` now defines the target gateway, media jobs, payer modes, and swarm pipeline.

Implemented:

- Server-key text generation for contextual resident replies.
- Advancement-backed, Orb-free Chat with system-paid reply inference.
- Replicate-backed community image generation for eligible generated cards.
- One-to-many resident replies as room events.
- Prompt-level constraint that the human operator is silent.
- Dialogue inference requires a configured model; unavailable inference emits no substitute speech.

Gap:

- The text gateway exists, but Replicate/media work is not yet behind the same provider-neutral boundary.
- No OpenRouter model capability discovery.
- No OpenRouter image generation; the first slice uses Replicate.
- No durable `media_jobs` or `media_assets` table/object store; job de-duplication is process-local while funding/status is journal-durable.
- Existing un-funded cards retain deterministic or authored fallback art.
- No battle/photo/media job migration from legacy CosyWorld.
- No swarm proposal/curation/content-pack pipeline.

Migration points:

- Use Ruby High's OpenRouter PKCE and transient browser-key pattern as the first player payer implementation.
- Use Ruby High's `character-generation.ts` and `yearbook-image.ts` response parsing for OpenRouter image generation and reference composition.
- Use legacy `SelfieTool`, `SceneCameraTool`, and `BattleMediaService` as media-intent references.
- Keep Orbs scoped exclusively to community images; resident speech and swarm jobs stay system-paid while Chat itself spends advancement.

### Shared Live Rooms

Status: `Proven`.

Evidence:

- `/state`, `/world`, `/events`, `/stream`.
- Browser uses `EventSource`.
- Smoke exercises travel, reload continuity, room transcript changes, and shared event replay.

Implemented:

- Locations are one shared channel each.
- Room timelines are scoped by current location and access context.
- SSE streams accepted world events after visibility filtering.
- Resident replies and ambient beats are one-to-many world events.
- Moving rooms swaps to that room's transcript.

Gap:

- The MVP uses browser local storage for fast return and signed wallet recovery for lost storage, but true multi-device account management is not solved.
- Protected moderation replay and actor suspension exist; no live moderator stream or action queue exists yet.

### Items And Evolution

Status: `Proven` for level 2 tracks.

Evidence:

- Kernel tests cover unique-item evolution.
- Browser smoke evolves Rati, Whiskerwind, and Skull.

Implemented:

- Items are world objects, not local UI badges.
- Players can pick up items and carry them.
- Matching evolution gifts are offered through the one-button command.
- Wrong-resident gifts are rejected by the kernel.
- Two unique required items evolve a resident to level 2.
- Evolved state updates card projections and room chips.
- Seed actor/item/location labels and level 2 evolution tracks live in `v2/orchestrator-rust/src/seed_content.json` and are validated by Rust tests.

Gap:

- Seed content is data-backed for the current MVP, but there is not yet a world-designer editor, migration story, or generated content pipeline.
- Higher-level evolution, reusable items, trading, and NPC item handling are not implemented.

### Stats And Combat

Status: `Partial`.

Evidence:

- Kernel test covers combat primitives.
- Browser smoke covers Moonlit Trail attack and flee.
- README documents compact combat transcript events.

Implemented:

- Actor stats exist.
- Ability checks emit visible roll/DC events.
- The Cottage rejects combat.
- Moonlit Trail supports a simple sparring target.
- Attack, hit/miss, damage, HP remaining, defend, knockout, and flee are projected as transcript events.

Gap:

- No initiative order or full encounter lifecycle.
- No challenge/hide commands.
- No condition duration UI beyond the current simple rules.

### RPG Layer: Callings, Bonds, Clocks, Jobs, Fronts

Status: `Partial`. This section summarizes status at a glance; `docs/systems/09-cosyworld-rpg-system.md` tracks per-phase detail and is the more current source when the two disagree.

Evidence:

- `v2/content/core/clocks.json`, `jobs.json`, `factions.json`, `fronts.json`, `access_gates.json`, `lifecycle_hooks.json`, `room_sheets.json`.
- Live routes: `/actions/prepare`, `/actions/rest`, `/actions/work`, `/actions/help`, `/actions/bank-ledger`, `/actions/revise-calling`, `/actions/create-bond`, `/actions/revise-bond`, `/actions/train-skill`, `/actions/resolve-bond`.
- RPG Bible "Runtime status" note (Phases 1-4 landed in some form, Phase 3/4 described as "first slice landed").

Implemented (per the RPG Bible's own tracking):

- Clock/tag projection state, sanctuary/frontier zoning, Moonlit Trail progress/danger clocks.
- Default Callings, first-class resident-gift Bonds, player-authored Bond slots, Bond revision/resolution.
- Visit Ledger accrual and banking into advancement points; Calling revision; six starter skill steps as spendable choices.
- Prepare/Rest/Work/Help as projection verbs for the Moonlit job loop.
- Seed job schema/projection and the first content-backed frontier Front records.
- Deterministic frontier pulses on every sixth committed player tick: explicitly classified ambient weather, opportunity-level route stock/imports and faction influence/momentum, capped conflict pressure, public response-oriented history, snapshot/journal replay, and same-location consented danger-clock escalation. Sanctuary state and unrelated players are excluded from stakes.

Gap (per the RPG Bible's own tracking):

- Covenant contribution as a banked-advancement spend, and additional banked-advancement choices beyond skill/bond/calling.
- Migrating generated quests into the new job schema; letting Use/Give/combat move job clocks; job rewards/consequences/completion memory.
- The live off-screen reducer can advance an existing danger clock, but it does not yet spawn new Jobs, create physical trade goods, or move residents as consequences.
- Covenant sheets (boons/hooks/resources/reputation/loyalty), room-owning covenants, and covenant-spawned jobs (RPG Bible Phase 5, not started).
- Objective clocks in danger rooms, durability-absorbs-harm, and the skill step-up ladder beyond the six starter steps (RPG Bible Phase 6, not started).

This RPG layer is not mentioned anywhere in `PRD.md`'s original P0/P1/P2 requirements or in this file's original Scope section — it is a genuine product expansion beyond the documented MVP, not a gap-filling of previously-scoped work.

### CLI

Status: `Proven` for local no-typing play.

Evidence:

- `python3 -m py_compile v2/cli/cosy_cli.py`.
- `./v2/mvp.sh check` runs a terminal smoke.

Implemented:

- Default mode is JRPG-style button play.
- Enter activates the primary contextual action.
- Space activates a secondary contextual action when available.
- The debug command shell is opt-in with `--command-mode`.
- Typed `say` is disabled.

Gap:

- Command mode still exposes typed debug actions for developers. That is acceptable as long as the product/browser/default CLI remain no-typing.

## Remaining MVP Risks

1. `v2/orchestrator-rust/src/main.rs` is still too large.
   The browser asset has been extracted, but world projection, card projection, AI, persistence, and route handlers should still be split into modules once the MVP behavior stabilizes.

2. Production identity is still thin.
   Signed wallet recovery can restore the linked avatar after local storage loss, but production still needs account management, session revocation, wallet-change policy, and support tooling.

3. Moderation is shallow.
   A single shared global world now has protected all-room audit replay and actor suspension, but still needs content filtering, reports, richer mute/ban primitives, and retention rules before broad traffic.

4. AI media controls are MVP-grade.
   Advancement Chat, contextual room heartbeats, image-only Orb funding, and usage ledgers work, but production still needs a durable media queue, provider-neutral routing, restart recovery, moderation, and richer aggregate telemetry.

5. Content authoring is still basic.
   Seed labels and level 2 evolution tracks are now data-backed, but the content pipeline still needs designer tooling, migrations, and higher-level evolution data.

6. Visual QA is baseline-gated for the core shell, but still narrow.
   The current smoke checks mobile and desktop shell geometry, preserves local screenshots, and compares them against committed PNG baselines. It does not yet cover a broader viewport/browser matrix or page-state matrix.

7. Economy still needs production guardrails.
   MVP Orbs, claim-gated rewards, the single community-image sink, durable ledgers, trusted Box/pack projection, signed-wallet flows, replayable grants, economy audit, and moderator notes are implemented. Production still needs a negative-ledger invariant alert, funded-job recovery, a configured live burn smoke, richer balance policy, and support-grade anomaly search.

## Current Best Next Steps

1. Keep `./v2/mvp.sh check` green as the MVP gate.
2. Split Rust card/world projection, persistence, AI, and route handlers into modules.
3. Restore Ruby High's upstream RPC capacity, deploy feed-health telemetry, and rerun the hosted protected-feed smoke.
4. Extract `ai_gateway` from inline Rust AI calls and promote player OpenRouter linking beyond browser-held keys.
5. Add richer balance policy and operator workflows over the existing economy audit tables.
6. Add OpenRouter media jobs for avatar portraits and combat scenes.
7. Extend the ownership feed contract with production Box, pack, and card status reconciliation fields.
8. Configure the Box collection/RPC in staging and execute an owner-signed BurnV1 prepare/send/confirm smoke with a disposable Box.
9. Add an explicit moderation/audit plan before public shared-world traffic.
10. Expand the seed content manifest into a fuller content pipeline while keeping C kernel ids stable.
11. Broaden visual baselines beyond the core narrow and desktop MUD layouts.
