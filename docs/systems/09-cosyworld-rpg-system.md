# CosyWorld RPG System Bible

## Status

This document defines the CosyWorld V2 RPG layer for the C-kernel / Rust-orchestrated prototype. It states the design as CosyWorld's own rules. The tabletop systems that informed those choices are credited at the end, in [Lineage And References](#lineage-and-references), rather than woven through the body.

Phase 1 of the [roadmap](#implementation-roadmap) has begun: clock and tag projection state, the seeded Moonlit Trail clocks, and `/state` exposure already exist in the Rust runtime. The rest of this document is the target shape.

Anchor files:

- [CosyWorld V2 kernel prototype](../../v2/README.md)
- [AI, media, BYOK, and combat design](../../AI.md)
- [C kernel rules](../../v2/core-c/src/cosy_kernel.c)
- [Rust kernel bridge](../../v2/orchestrator-rust/src/kernel.rs)
- [RPG reference shelf](../../reference-library/rpg-systems/README.md)

## One-Sentence Design

CosyWorld is a shared-room, kernel-first cozy adventure RPG where players press contextual actions, the server resolves world truth, AI narrates public events, and rooms persist through memory, residents, clocks, items, and seasonal change.

## Non-Negotiable Invariants

- The C kernel decides world state.
- Rust owns projection, persistence, economy, access, AI routing, and public API shape.
- AI may propose narration, resident speech, media, summaries, and future content; it may not directly mutate authoritative state.
- Every player-visible AI output is committed as a shared room event.
- There are no private resident conversations in the main world loop.
- The client never decides affordability, model access, combat outcomes, rewards, room access, inventory grants, or quest completion.
- CosyWorld Core must remain playable without NFTs.
- Official NFTs unlock expansions, not the base game.
- The Cottage and equivalent starting homes are safe by default.
- Rules text is original CosyWorld writing. Where adapting source wording is unavoidable, prefer CC-BY material with attribution and treat CC-BY-SA material as reference-first unless we intentionally accept share-alike obligations.

## Design Principles

These are the choices that shape everything below.

- **Short phrases are mechanically real.** A tag like `tired` or `trusted by rati` is not flavor; rules and AI prompts read it. Truth lives in small, concrete words.
- **The world keeps clocks, not just text.** Projects, dangers, relationships, and seasons advance through visible, segmented progress that everyone in the room can see.
- **Fiction triggers consequences; the player never learns the machinery.** A hidden director chooses world-facing outcomes from a fixed menu. Players press ordinary verbs and watch the room respond.
- **Items are the build surface.** Character growth is mostly inventory: charges, durability, recharge conditions, and break-to-absorb-harm. There is no class tree.
- **Rooms and homes are actors.** Cottages, shards, schools, and guilds carry their own sheets — boons, hooks, resources, residents, projects, and seasons — and run long projects across days or weeks.
- **Combat is rare, short, and often about an objective.** Conflict is one mode among many, never the default solution.
- **Play to find out.** Resident and room evolution is content we discover at runtime, within validated rails — not state the AI invents.

## Player Experience

The player should experience CosyWorld as a one-button shared-world MUD:

1. Arrive in a room.
2. See a clear primary action and a small set of contextual options.
3. Press an action.
4. Watch the room respond through public events.
5. Gain, spend, use, or change something visible.
6. See the room, residents, items, or clocks remember what happened.

The player never needs to know which idea came from where. The visible verbs are ordinary words: Chat, Listen, Travel, Take, Give, Use, Prepare, Rest, Work, Help, Attack, Defend, Flee.

## Authoritative Loop

The intended runtime loop:

1. Rust builds authoritative room context from kernel state, access context, projection state, and economy state.
2. Rust asks the kernel which rule actions are legal.
3. Rust chooses the primary action and exposes optional commands.
4. The player presses an action.
5. Rust validates session, access, cost, rate limit, and target.
6. Rust submits a rule action to the C kernel or schedules a validated projection-only action.
7. The C kernel emits events for authoritative state changes.
8. Rust persists the source action, projects events, updates Orbs, clocks, tags, and room memory.
9. AI narrates or replies only through public, validated events.
10. The room state is broadcast to everyone present.

## Core Entities

### Actor

Actors include player avatars and residents.

Required RPG fields:

- `id`
- `kind`: human or resident
- `location_id`
- `stats`: six internal stats, current HP/protection, level
- `tags`: short truths such as `inspired`, `tired`, `trusted by rati`
- `conditions`: rule-facing states such as damage, defended, hidden, exhausted, vulnerable
- `inventory`
- `bonds`: relationship edges to residents, factions, rooms, or other actors
- `evolution_track`: optional resident or avatar progression

### Room

Rooms are not just containers. A room is a persistent world actor.

Required RPG fields:

- `id`
- `name`
- `description`
- `safety`: safe, risky, or dangerous
- `access`: public, gated, preview-only, or locked
- `aspects`: short room truths
- `memory`: public facts learned or caused in the room
- `residents`
- `items`
- `exits`
- `clocks`
- `resources`
- `boons`
- `hooks`
- `season_state`

### Resident

Residents are public world actors, not private companions.

Required RPG fields:

- `id`
- `home_location_id`
- `persona`
- `wants`
- `boundaries`
- `relationship_tags`
- `evolution_requirements`
- `reaction_state`
- `memory_refs`
- `allowed_actions`

### Item

Items are the main build surface for a light RPG.

Required RPG fields:

- `id`
- `name`
- `type`
- `tags`
- `owner_actor_id` or `location_id`
- `charges`
- `durability`
- `slot_cost`
- `recharge_condition`
- `break_effect`
- `kernel_effect`, when the item changes authoritative state
- `projection_effect`, when the item only changes clocks, tags, or presentation

### Clock

Clocks are first-class state, not only narration.

Required RPG fields:

- `id`
- `scope`: room, actor, resident, faction, quest, season, or shard
- `kind`: progress, danger, relationship, project, exploration, or faction
- `label`
- `segments`
- `filled`
- `visible_to_players`
- `created_by_event_id`
- `resolved_by_event_id`
- `on_fill`: validated effect descriptor

### Job

Jobs replace simple item-only quests.

Required RPG fields:

- `id`
- `premise`
- `stakes`
- `location_ids`
- `participant_ids`
- `progress_clock_id`
- `danger_clock_id`
- `reward`
- `consequence`
- `status`
- `memory_summary`

### Faction Or Covenant

This is the home-base layer: the entity that lets a place accumulate identity and pursue goals over time.

Required RPG fields:

- `id`
- `name`
- `scope`: room, shard, guild, school, cottage, expansion
- `boons`
- `hooks`
- `resources`
- `reputation`
- `loyalty`
- `projects`
- `season_clock`

## Stats And Checks

The kernel keeps the six familiar stats because the V2 prototype already uses them and they are easy to audit:

- Strength
- Dexterity
- Constitution
- Intelligence
- Wisdom
- Charisma

The product UI hides most of that texture behind friendlier groupings:

- Body: strength and constitution
- Grace: dexterity
- Mind: intelligence and wisdom
- Heart: charisma and wisdom

Ability checks remain visible, deterministic, and auditable. They gain optional metadata:

- `risk`: safe, risky, dire
- `effect`: limited, standard, great
- `clock_delta`: proposed progress or danger movement
- `consequence_pool`: allowed consequences if the roll fails or partially succeeds

The d20 check is acceptable for the near term because it is already implemented and familiar. The long-term design does not depend on a specific die shape. What matters is that the action has a clear fictional trigger, a visible result, and a constrained consequence.

## Action Surface

### Current Kernel Actions

The current V2 kernel already supports:

- Create Actor
- Say
- Move
- Ability Check
- Pick Up Item
- Use Item
- Attack
- Defend
- Give Item
- Flee

These remain the first authoritative layer.

### Product Verbs

Product verbs map to kernel actions or projection actions:

| Product verb | Kernel or projection | Purpose |
| --- | --- | --- |
| Chat | kernel Say plus AI generation | Public in-character avatar line and resident response. |
| Listen | kernel Ability Check | Learn room truth, earn once per context, advance memory. |
| Travel | kernel Move | Move through legal, accessible exits. |
| Take | kernel Pick Up Item | Move item to inventory. |
| Give | kernel Give Item | Resident evolution, relationship, job delivery. |
| Use | kernel Use Item | Consumables, tools, relics, room effects. |
| Attack | kernel Attack | Rare danger-room conflict. |
| Defend | kernel Defend | Short defensive condition. |
| Flee | kernel Flee | Exit danger and possibly earn Orbs. |
| Prepare | new kernel or projection action | Create advantage, lower risk, add temporary tag. |
| Rest | new kernel or projection action | Clear fatigue at a cost or clock advance. |
| Work | projection clock action at first | Advance project/job clock. |
| Help | projection clock or assist action | Assist another actor, resident, or room project. |

### Primary Action Priority

The primary action should be helpful, not exhaustive.

Recommended priority:

1. Required onboarding action.
2. Urgent danger action: Flee, Defend, Use recovery, Attack.
3. Zero-Orb earning action if Chat is unaffordable.
4. Give matching evolution item.
5. Use meaningful held item.
6. Take useful visible item.
7. Chat with best target.
8. Listen.
9. Travel.
10. Work or Help on active room/project clock.

The primary action may vary by player context, but the result is still public.

## Resolution Model

### Kernel Layer

The kernel owns:

- Actor creation.
- Movement legality.
- Safe-room combat rejection.
- Ability check rolls.
- HP/protection changes.
- Defend/Flee/Attack legality and results.
- Item ownership transfer.
- Consumable use.
- Resident evolution gates.
- Any effect that can grant, remove, kill, unlock, move, or spend authoritative world state.

### Projection Layer

Rust owns:

- Primary action selection.
- Card projection.
- Room memory projection.
- Clock projection.
- Orb ledger and claim keys.
- AI usage ledger.
- Access feed projection.
- Jobs/fronts/covenants until they require kernel enforcement.
- Public event feed shape.

### AI Layer

AI owns:

- Avatar line proposals.
- Resident reply proposals.
- Director narration.
- Room beat suggestions.
- Job premise drafts.
- Media prompts.
- Summaries.

AI output must be validated, sanitized, and committed as public event content. AI never grants items, fills clocks, applies conditions, changes access, or spends currency directly.

## Clocks

Clocks give CosyWorld persistent pressure without requiring heavy rules.

### Clock Types

- Progress: repair, research, prepare, befriend, unlock.
- Danger: storm, suspicion, exhaustion, instability, threat.
- Relationship: trust, rivalry, debt, warmth.
- Project: room improvements, faction goals, resident requests.
- Exploration: learn an area, map paths, discover features.
- Season: weekly or daily world cadence.

### Clock Movement

Clock changes must be event-backed:

- A successful Listen may fill progress.
- A failed risky action may fill danger.
- Rest may clear fatigue and fill a danger or season clock.
- Work may fill project progress.
- Chat may add memory but should rarely fill clocks unless tied to a resident or job.
- Combat may fill objective clocks instead of only dealing damage.

### On-Fill Effects

Clock completion can:

- Add or remove a room tag.
- Unlock an exit.
- Spawn or reveal an item.
- Change resident reaction state.
- Complete or fail a job.
- Create a new job.
- Advance a faction or season.

Every on-fill effect must be represented as a validated descriptor. If the effect changes authoritative state, the descriptor must compile into kernel actions; if it only touches projection state, it compiles into a `ProjectionMutation`. This compiler is the seam where "AI proposes, kernel decides" is actually enforced, so it gets its own spec below.

## On-Fill Effect Descriptors

This is the enforcement boundary. A descriptor is a closed-vocabulary instruction attached to a clock's `on_fill` list. Nothing free-form — including anything AI proposed — reaches authoritative state except by being expressed as one of these ops and surviving compilation.

### Runtime gap

Today `ClockState` has no `on_fill` field and `advance_clock` only flips `status` to `"filled"`. The first task is to add `on_fill: Vec<EffectDescriptor>` to `ClockState` and dispatch it when `filled >= segments` crosses for the first time. The descriptor vocabulary below maps onto the existing `ProjectionMutation` enum (`advance_clock`, `set_tag`, `clear_tag`) for the projection-safe ops and onto kernel actions for the authoritative ops.

### Closed op vocabulary

Every descriptor has an `op` from this fixed table and nothing else. Unknown ops fail closed.

| `op` | Layer | Compiles to | Notes |
| --- | --- | --- | --- |
| `advance_clock` | projection | `ProjectionMutation::AdvanceClock` | `amount` bounded to `[1, target.segments]`. |
| `set_tag` | projection | `ProjectionMutation::SetTag` | tag `scope`/`scope_id`/`kind` from a closed enum. |
| `clear_tag` | projection | `ProjectionMutation::ClearTag` | `tag_id` must resolve. |
| `set_resident_reaction` | projection | reaction-state reducer | resident must exist; reaction from closed enum. |
| `set_job_status` | projection | job reducer | `complete` / `fail` only; status transition must be legal. |
| `create_job` | projection | job seed reducer | premise/clocks validated like a seeded job. |
| `advance_faction` / `advance_season` | projection | faction/season reducer | bounded delta. |
| `unlock_exit` | authoritative | kernel Move-graph mutation | exit must exist and be currently locked. |
| `spawn_item` / `reveal_item` | authoritative | kernel item create at location | item template must exist; respects room capacity. |
| `grant_item` | authoritative | kernel Give Item | target actor must be present and own a free slot. |
| `apply_condition` | authoritative | kernel condition set | condition from the kernel's known set. |

Authoritative ops are the ones that can grant, remove, kill, unlock, move, or spend kernel-owned state. They never apply in Rust directly; they are submitted to the C kernel, which can still reject them (a safe room rejecting `apply_condition: vulnerable`, a full inventory rejecting `grant_item`). Projection ops apply in Rust and may never contradict kernel state.

### Example

```json
{
  "id": "moonlit_trail_quiet_progress",
  "segments": 6,
  "filled": 6,
  "on_fill": [
    { "op": "set_tag", "scope": "room", "scope_id": 3,
      "label": "quieted moonlight", "kind": "aspect" },
    { "op": "clear_tag", "tag_id": "tag_room_3_echo_unsettled" },
    { "op": "set_job_status", "job_id": "job_moonlit_trail_quiet", "status": "complete" },
    { "op": "unlock_exit", "from_location_id": 3, "exit_id": "exit_trail_to_grove" }
  ]
}
```

The first three are projection ops; the fourth is authoritative and is routed to the kernel.

### Compilation pipeline

On-fill runs as a five-step pipeline, and it dry-runs the whole list before applying anything:

1. **Parse.** Reject any descriptor whose `op` is not in the table. Fail closed — an unrecognized op aborts the whole `on_fill` list.
2. **Resolve.** Every referenced id (`clock_id`, `tag_id`, `exit_id`, item template, `location_id`, `actor_id`, `job_id`) must resolve in current state. Unresolved reference → reject the list.
3. **Bound-check.** `advance_clock.amount` within `[1, segments]`; resource and faction deltas within configured caps; tag/condition/reaction values within their closed enums.
4. **Stage.** Validate the entire list first. Only if all descriptors validate does anything apply. This keeps a partially-applied on-fill from leaving the room in an impossible state.
5. **Apply and route.** Projection ops apply as `ProjectionMutation`s in event order. Authoritative ops are submitted to the kernel; the kernel's accept/reject is authoritative and is recorded, not swallowed.

### Idempotency and cascades

- Each on-fill execution carries a claim key `clock_fill:{clock_id}:{filled_crossing_event_seq}` (see [Claim Keys And Idempotency](#claim-keys-and-idempotency)). A clock fires its `on_fill` exactly once even if `advance_clock` is retried.
- On-fill effects can advance other clocks, which can fill and fire their own effects. Guard the cascade: a bounded depth (default 8) and a per-tick visited set of clock ids. Exceeding either aborts the remaining cascade and emits `clock.fill_cascade_aborted`.

### Failure modes

| Failure | Handling |
| --- | --- |
| Unknown `op` | Reject whole list; clock stays `filled`; emit `clock.fill_effect_rejected`. |
| Reference does not resolve | Reject whole list at stage 2; emit `clock.fill_effect_rejected` with the missing id. |
| Amount/delta out of bounds | Reject whole list at stage 3. |
| Authoritative op rejected by kernel | Already-applied projection ops stand (projection may lag kernel, never contradict it); emit a compensating `clock.fill_effect_partial` so the divergence is auditable. |
| Cascade exceeds depth or revisits a clock | Abort remainder; emit `clock.fill_cascade_aborted`. |
| Replay of the same fill | `clock_fill` claim key makes it a no-op. |

The residual risk is stage 5: a kernel rejection after projection ops already applied. The mitigation is ordering discipline — put authoritative ops that are likely to be rejected (safe-room conditions, capacity-bounded grants) first in the list when the projection ops downstream depend on them — plus the `clock.fill_effect_partial` audit event so the divergence is never silent.

## Tags, Aspects, And Conditions

Use one tag model with different scopes rather than several incompatible systems.

Recommended shape:

```json
{
  "id": "tag_tired",
  "scope": "actor",
  "label": "tired",
  "kind": "condition",
  "source_event_id": "event_123",
  "expires": {
    "type": "after_rest"
  }
}
```

Kinds:

- `aspect`: stable truth.
- `condition`: temporary or rule-facing state.
- `memory`: public fact.
- `bond`: relationship state.
- `boon`: beneficial room/covenant trait.
- `hook`: complication or obligation.

Tags are short, concrete, and reusable by AI prompts and rule filters. Because AI reads tags, tag text is treated as untrusted input: it is sanitized before it enters a prompt and never interpreted as an instruction.

## Economy

Orbs are a public attention and action economy, not a replacement for rules.

Good Orb uses:

- Server-paid Chat.
- Optional push/prepare once the kernel supports it.
- Crafting or recharge costs.
- Entry into special public events.
- Cosmetic media jobs.

Bad Orb uses:

- Buying success after a failed kernel roll.
- Ignoring access gates.
- Privately changing a resident.
- Skipping item requirements.
- Rewriting public event history.

Reward rules remain claim-key gated and idempotent. The mechanism is specified below.

## Claim Keys And Idempotency

Every mint, spend, and one-shot RPG effect is gated by a claim key. This is what makes "repeated identical actions never mint unlimited Orbs" true rather than aspirational.

### What already exists

The runtime already carries snapshot-persisted claim sets and a ledger:

- `listen_attempt_claims` — gates earn-once-per-context attempts.
- `orb_reward_claims` — dedupes automatic Orb mints.
- `rpg_claims` — dedupes one-shot RPG effects.
- `OrbLedgerEntry.idempotency_key` — dedupes the ledger write itself.

Keys are deterministic strings built from authoritative facts, e.g. `ability_check_success:{actor_id}:{location_id}:{ability}:{dc}`, `listen_attempt:{actor_id}:{location_id}`, `combat_knockout:{actor_id}:{target_id}`, `avatar_created:{actor_id}`. New effect types (on-fill, jobs, Rest, Work) extend this convention rather than inventing a new one.

### The primitive

Application is one operation: `set.insert(key)` returns `true` only if the key was newly added. Apply the effect iff insert returned true; otherwise it is a no-op. Because the claim sets are part of the persisted snapshot, this survives restart — a replay after a crash does not re-mint.

Idempotency is two layers. The claim set decides *whether to attempt* the effect; `OrbLedgerEntry.idempotency_key` independently guards the ledger write. Both must be present for an economy effect: the first prevents double-attempt, the second prevents a double row if the attempt path is ever re-entered.

### The one rule that matters: key granularity

A key is a pure function of authoritative facts and nothing else. It must never include wall-clock time or RNG output. Get this wrong in either direction and the economy breaks:

- **Too coarse** (omits a fact that should distinguish two legitimate rewards) → the second legitimate reward is silently swallowed. Under-mint. Example: `ability_check_success:{actor}:{loc}:{ability}:{dc}` is earn-once *forever* per that tuple. That is correct for a one-time discovery, wrong for a reward meant to recur. A recurring reward must fold the repeatable unit into the key — a season id, a job id, or the source event seq — e.g. `work_clock:{actor}:{job}:{season}`.
- **Too fine** (includes the source event seq or a timestamp on a reward that should fire once) → every retry produces a new key and mints again. Over-mint. This is the dangerous direction and the one to guard in review.

So the design step for any new reward is explicit: decide the intended repeatability, then choose the key granularity that exactly matches it.

### Failure modes

| Failure | Effect | Mitigation |
| --- | --- | --- |
| Key too coarse | Legitimate repeat reward swallowed | Fold the repeatable unit (season/job/event seq) into the key. |
| Key too fine / includes time or RNG | Replays double-mint | Keys are pure functions of authoritative facts only; enforce in review. |
| Claim set not persisted | Restart re-mints | Claim sets live in the snapshot; new sets must be added to the snapshot too. |
| Concurrent same key | Two attempts race | `insert` is the single serialization point per runtime; only one wins. |
| Set grows unbounded | Snapshot bloat over time | Prune only keys whose underlying state can no longer recur (archived job, closed season). Never prune a key whose action can still fire, or the exploit reopens. |

The collision question is settled by construction: keys include `actor_id`, so two different actors earning at the same clock in the same tick never collide; the same actor repeating only collides when the key is intentionally earn-once.

## Combat And Conflict

Combat should be rare, short, and auditable.

Rules:

- Safe rooms reject combat.
- Danger rooms can expose Attack, Defend, Use, and Flee.
- KO should create recovery or consequence pressure before permanent loss.
- Combat should often be about an objective, not only HP.
- Flee is a valid success path.

Near-term combat can keep the existing d20 attack, armor calculation, defend bonus, d8 damage, crit, potion, and flee primitives.

Next combat evolution:

- Add conflict objective clocks.
- Add nonlethal outcomes.
- Add room danger clocks.
- Let gear durability absorb harm.
- Let residents react publicly to conflict.

Example conflict:

```text
Objective clock: Calm the Moonlit Echo, 4 segments
Danger clock: Echo Shatters the Trail, 4 segments
Actions: Listen, Defend, Use charm, Attack, Flee
Win: room gains "quieted moonlight"
Loss: room gains "echo-fractured"; travel is risky until repaired
```

## Jobs Instead Of Simple Quests

The current quest schema only supports item-at-location and item-owned-by-avatar checks. V2 replaces this with jobs/fronts.

A job should include:

- A premise.
- A public room or route.
- Stakes.
- A progress clock.
- A danger clock.
- Involved residents or factions.
- Required item tags or room tags.
- Rewards.
- Consequences.
- Completion memory.

Example:

```json
{
  "id": "job_greenhouse_warmth",
  "premise": "The Greenhouse is losing its morning warmth.",
  "stakes": "If nobody helps, seedling rooms become risky after sundown.",
  "progress_clock": { "segments": 6, "filled": 0 },
  "danger_clock": { "segments": 4, "filled": 1 },
  "actions": ["Listen", "Use", "Work", "Give"],
  "reward": { "orbs": 2, "tag": "greenhouse trusted" },
  "consequence": { "room_tag": "chilled panes" }
}
```

## Room And Covenant Sheets

Every important location should eventually have a sheet:

```json
{
  "id": "room_cosy_cottage",
  "name": "The Cosy Cottage",
  "safety": "safe",
  "aspects": ["warm threshold", "careful host"],
  "boons": ["new avatars can begin here"],
  "hooks": ["the hearth notices unfinished promises"],
  "resources": {
    "warmth": 3,
    "tea": 2
  },
  "projects": [],
  "season_clock": {
    "segments": 7,
    "filled": 0
  }
}
```

This is how CosyWorld becomes more than a chat layer. The room itself can grow, strain, recover, and remember.

## Data Migration Direction

### Add New V2 Projection Tables Or JSON Documents

Suggested stores:

- `tags`
- `clocks`
- `jobs`
- `room_sheets`
- `resident_sheets`
- `factions`
- `season_turns`

For SQLite, flexible JSON columns are acceptable for effect descriptors and room/job sheets, but lookup fields should be indexed:

- `scope`
- `scope_id`
- `status`
- `visible_to_players`
- `updated_at_ms`

### Keep Kernel State Small

Do not push every narrative field into C. The kernel remains compact and deterministic. Projection state can be richer as long as it cannot contradict kernel state.

## Implementation Roadmap

### Phase 1: System Foundation (in progress)

- Add clock projection state in Rust.
- Add tag projection state in Rust.
- Add event-backed room memory entries.
- Expose clocks and tags in `/state`.
- Keep all clock/tag changes server-authored.

### Phase 2: New Verbs

- Add Prepare as a projection action that creates a temporary tag or improves the next related clock action.
- Add Rest as a projection action that clears fatigue and advances a chosen danger or season clock.
- Add Work as a projection action that fills a project/job clock.
- Add Help as an assist action that creates a temporary tag on another actor or room project.

Only move these into the C kernel when they need hard authority over combat, inventory, unlocks, or actor conditions.

### Phase 3: Jobs

- Add job schema and projection.
- Migrate generated quests into jobs.
- Let Listen, Use, Give, Work, and combat outcomes move job clocks.
- Add completion and failure event projection.

### Phase 4: Room Sheets

- Add room sheet seed data.
- Add boons/hooks/resources.
- Add seasonal clock ticks.
- Let completed jobs modify room sheets.

### Phase 5: Conflict Objectives

- Add objective clocks to danger rooms.
- Keep HP as a tactical pressure, not the only victory condition.
- Add item durability and break-to-absorb-harm.
- Add nonlethal consequences.

### Phase 6: Factions And Seasons

- Add faction/covenant sheets.
- Add daily or weekly season turns.
- Add offscreen clock movement from unresolved hooks.
- Let rooms and factions create jobs.

## Acceptance Criteria For New Rules

A new RPG feature is ready to ship when:

- It has a clear player-facing verb or passive effect.
- It states whether authority belongs to C kernel, Rust projection, or AI proposal.
- It has an event-backed audit trail.
- It cannot be triggered by client-only state.
- It behaves correctly in safe rooms, gated rooms, and public core rooms.
- It has an idempotency strategy for rewards or spends.
- It degrades gracefully when AI is unavailable.
- It has at least one local test or smoke assertion covering the authoritative path.
- It preserves public-room behavior.

## First Concrete Slice

The smallest useful implementation, now partly landed in the Rust runtime:

1. Add `ClockState` and `TagState` to the Rust runtime projection.
2. Seed one room progress clock and one room danger clock on Moonlit Trail.
3. Make Listen fill the progress clock once per actor/location claim.
4. Make repeat Listen without reward either cost Orbs or risk filling danger.
5. Add Rest to clear a `tired` tag and fill the room danger clock.
6. Expose clocks/tags in `/state`.
7. Add smoke coverage that proves clocks are public, persisted, and event-backed.

That slice tests the whole philosophy without requiring a large kernel rewrite.

## Design Summary

CosyWorld should be cozy because it has safe homes, public generosity, resident memory, and rooms that improve. It should still be an RPG because actions have rules, risk has consequences, items matter, and the world changes in ways everyone can see.

The north star is simple: press one meaningful action, let the server decide what is true, let the room remember, and let AI make the public result feel alive.

## Lineage And References

CosyWorld's mechanics are original writing, but the shapes above were informed by a shelf of open tabletop systems. Each entry below notes what we took, what we deliberately left, and the license signal recorded in the [reference shelf](../../reference-library/rpg-systems/README.md). Adapt CC-BY wording with attribution; treat CC-BY-SA wording as reference-first unless we accept share-alike obligations.

### Fate

- **License signal:** CC-BY 3.0 / OGL options — `sources/fate-srd-content`.
- **Taken:** the idea that short phrases can be mechanically meaningful truths. CosyWorld's aspects (room/resident/item/avatar tags), persistent consequences, the future Prepare action as create-advantage, and milestone-style evolution all descend from this.
- **Left:** a tabletop Fate-point economy as the main player economy, and long open-ended negotiation at the moment of action.

### Blades in the Dark and Charge

- **License signal:** CC-BY 3.0 (Blades, `sources/blades-in-the-dark-srd-content`); Charge SRD CC-BY 4.0, `raw/charge-srd.md`.
- **Taken:** clocks as first-class state, and risk/effect framing on actions. Progress and danger clocks, faction pressure, room pressure, and offscreen consequences come from here.
- **Left:** the full heist/downtime structure, and turning every action into a player-versus-GM negotiation.

### Dungeon World

- **License signal:** CC-BY 3.0 — `sources/dungeon-world-markdown`.
- **Taken:** fiction-triggered moves and world-facing consequences. CosyWorld's hidden director menu (reveal a truth, offer an opportunity, consume a resource, advance a clock, separate attention, show a cost, change room pressure), fronts as season-scale threats, and "play to find out" as a content principle.
- **Left:** requiring players to learn named tabletop moves, and giving AI authority to invent unvalidated state changes.

### Cairn, 24XX, and Breathless

- **License signal:** Cairn CC-BY-SA 4.0 (`sources/cairn`, reference-first); 24XX CC-BY 4.0 (`raw/24xx-srd.md`); Breathless CC-BY 4.0 (`raw/breathless-srd.md`).
- **Taken:** light play, gear pressure, and repeat-action fatigue. Inventory and item cards as the build surface; charges, durability, recharge conditions, and break-to-absorb-harm; breath/fatigue pacing; short, legible risk rolls.
- **Left:** dense class progression, and combat as the default way to solve problems.

### Ars Magica

- **License signal:** CC-BY-SA 4.0 (reference-first) — `sources/ars-magica-open-license`.
- **Taken:** home-base play. Rooms, cottages, shards, schools, guilds, and expansions as entities with their own sheets; boons, hooks, resources, residents, reputation, loyalty, projects, and seasons; long projects that advance across days or weeks.
- **Left:** deep simulation that asks a player to manage a campaign workbook.

### 5e CC SRD 5.1

- **License signal:** CC-BY 4.0 — `sources/cc-srd-5e`.
- **Taken:** familiarity and data. The six familiar stats internally (behind a simpler interface), plus monster, condition, equipment, and spell ideas as conversion seeds where license allows.
- **Left:** full class/subclass/spell-slot combat, and turning the V2 kernel into a D&D engine.

### Discovery indexes

- **Awesome Tabletop RPGs** (`sources/awesome-tabletop-rpgs`) — a curated list used to find additional open systems. Treated as a discovery aid only; each linked project's license must be verified before any wording is adapted.
