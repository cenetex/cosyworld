# CosyWorld RPG System Bible

## Status

This document defines the CosyWorld V2 RPG layer for the C-kernel / Rust-orchestrated prototype, as CosyWorld's own rules. The tabletop systems that informed it are credited at the end, in [Lineage And References](#lineage-and-references).

Current runtime slice: the clock/tag, sanctuary/frontier, job, Calling, Bond,
Visit Ledger, and advancement projections are implemented in Rust over the C
kernel. `cosyworld.srd5/1` now supplies the active stable-action profile:
Search/Study, Influence, Help/Ready/Utilize project bindings, Attack/Dodge,
bounded Magic, and explicit unsupported actions. The item-card layer has
authoritative Collection/Carried/Equipped/Spell deck/Exhausted/Contained/World/
Escrow zones, weight and size, equipped non-recursive containers, bracelet
slots, possession-bound skill charms, weapon profiles, executable spell cards,
idempotent collection materialization, theft, and provenance. Deterministic
scene composition produces the complete legal offer set and a ranked
three-card hand for browser and terminal clients. Legacy skill ranks, action
codes, combat/2 and combat/3 rows remain replay-readable. Covenant contribution
and additional advancement choices remain future RPG breadth; they are not
gaps in the SRD action-card foundation.

Anchor files:

- [CosyWorld V2 kernel prototype](../../v2/README.md)
- [AI, media, BYOK, and combat design](../../AI.md)
- [C kernel rules](../../v2/core-c/src/cosy_kernel.c)
- [Rust kernel bridge](../../v2/orchestrator-rust/src/kernel.rs)
- [RPG reference shelf](../../reference-library/rpg-systems/README.md)
- [Signal chain substrate](../../../signal/docs/decentralization-synthesis.md) — the signed-provenance-log model CosyWorld reuses for ownership (see [Ownership, Cards, And Secret Poems](#ownership-cards-and-secret-poems))

## One-Sentence Design

CosyWorld is a shared-world cozy adventure RPG where you keep a home you own, follow callings that say who you are, build bonds with the residents and people around you, and venture out to help — and the server resolves world truth, the room remembers, and AI makes the public result feel alive.

## Non-Negotiable Invariants

- The C kernel decides world state.
- Rust owns projection, persistence, economy, access, AI routing, and public API shape.
- AI may propose narration, resident speech, media, summaries, and future content; it may not directly mutate authoritative state.
- Every player-visible AI output is committed as a shared room event.
- **The home is a sanctuary.** A player's cottage and equivalent starting homes never decay, are never invaded, and reject combat by default. Pressure is something you choose to walk toward, not something that comes to you at home.
- **Progression is earned, never bought.** Advancement comes from play; currency buys amplification and cosmetics, never power, success, access, or rules outcomes.
- **The collectible subject cosmology is avatar, item, and location.** Skills,
  weapons, spells, tools, and relics are roles of playable Item cards, not new
  entity families with separate interfaces.
- **The core loop is free.** A player with zero currency can always do the meaningful thing — listen, help, bond, travel — without paying.
- **Chat is visible growth.** `Chat` appears only when banked advancement can
  begin a friendship with an eligible nearby resident. It spends advancement,
  never Orbs; ordinary player speech remains the separate `say` action.
- **Cards invite one contextual room voice.** A successful scene card arms one
  delayed resident heartbeat per room. Rapid cards coalesce, resident priority
  follows authored card order, and the reply sees recent card/log history.
- **The world degrades gracefully without AI.** Core world actions remain deterministic and playable when generation is unavailable. Explicit dialogue fails visibly without charge or substitute speech; incidental dialogue is skipped.
- There are no private resident conversations in the main world loop.
- The client never decides affordability, model access, combat outcomes, rewards, room access, inventory grants, or quest completion.
- **Ownership is native and token-free.** Cards, items, and avatars are owned through CosyWorld's own signed provenance log (an Ed25519 + content-addressed chain, not a blockchain or token). External NFTs are an optional *bridge* that gates official expansions — never the base game's ownership layer.
- **A private key is never a poem.** Identity and ownership are real Ed25519 keypairs held by the client. Poems unlock and gift; they do not control keys.
- CosyWorld Core must remain playable without NFTs. Official NFTs unlock expansions, not the base game.
- Rules text is original CosyWorld writing. Where adapting source wording is unavoidable, prefer CC-BY material with attribution and treat CC-BY-SA material as reference-first unless we intentionally accept share-alike obligations.

## The Player Fantasy

Before any mechanic, the fantasy. A player should be able to finish this sentence after ten minutes: *"I am the kind soul who ___, I have a home at ___, and I am slowly ___."*

CosyWorld offers three intertwined fantasies, and a player can lean into any mix:

- **Homemaker.** You have a place that is *yours* — a cottage, and a covenant you belong to — and it grows warmer and more characterful because of what you do.
- **Helper.** The world has gentle troubles, residents have wants, and jobs need hands. You become someone it relies on, and it remembers you showed up.
- **Wanderer.** Past the safe rooms is a frontier with real pressure and real discovery. You choose when to walk out, and bring back gear and stories the residents react to.

These are the three things every system below must serve: **something I own**, **a reason I matter**, **a goal I set**.

## The Visit Ledger

The retention engine: an end-of-session review that rewards *experiences worth having* rather than time spent, reshaped for an always-on shared world.

At the end of a visit (a session, or a daily rollover for idle players), the player gets a **Visit Ledger**: a short, public summary of what they did and the advancement it earned. Progress is marked for each of these that happened — the same shape for everyone, so it is legible and fair:

- **You followed your Calling.** Your avatar's calling describes who they are; acting on it in public earns progress. (See [Callings And Bonds](#callings-and-bonds).)
- **You deepened or resolved a Bond.** A relationship with a resident or another player changed in a way you can name.
- **You learned a true thing.** A room truth, a secret, a piece of the world you did not know.
- **You helped.** You moved a job, a covenant project, or another actor's clock forward.
- **You dared the frontier and returned.** You took a real risk in a risky or dangerous room and came back with something — not necessarily by winning.

The ledger gives the second button a reason to matter (it accrues toward a visible reward), rewards curiosity, kindness, and courage over grinding, and — because it is public — keeps each player's contribution legible in a crowd: the world records that *you* learned the trail's secret, even if a hundred others walked it.

It is event-backed and claim-key gated like all rewards (see [Claim Keys And Idempotency](#claim-keys-and-idempotency)), so the same bond or room truth can't be farmed twice.

## Callings And Bonds

Identity is the motivation engine. A player who can name who their avatar is returns to express it.

### Callings

Every avatar has a **Calling**: a short, player-chosen statement of drive — *"I tend to things that are breaking,"* *"I collect the stories no one else wants,"* *"I never leave a resident worse than I found them."* It is a tagged truth (kind `calling`) that rules and AI prompts read, but its text is the player's.

A Calling is not a class and grants no powers. It does one thing: acting on it in public marks the [Visit Ledger](#the-visit-ledger). You are reaching to be *more yourself*, visibly, before a world that remembers. Callings can be revised at milestones, so character evolves through play rather than locking at creation.

### Bonds

A **Bond** is a relationship made mechanical: a short statement tying your avatar to a resident, a place, a covenant, or another player. *"Mira trusts me with the greenhouse keys."* *"I owe the hearth an unfinished promise."* *"Rati and I are rivals over the moonlit trail."*

Bonds are first-class entities (kind `bond`), edges between actors. They:

- **Deepen** through play — repeated, relevant interaction strengthens a bond and unlocks resident reactions, evolution gates, and covenant standing.
- **Resolve** when they no longer describe the relationship — a debt repaid, a rivalry settled, a promise kept. Resolving a bond marks the Visit Ledger and prompts you to write a new one.
- **Drive non-AI behavior.** With generation unavailable, a resident reads its bonds and reaction state to choose authored responses — how the world stays warm when the AI is quiet.

Bonds are the cozy game's true progression: relationships you own inside a world you share.

## Sanctuary And Frontier

A world with pressure is engaging but not relaxing; a world that waits for you is relaxing but inert. CosyWorld refuses to choose globally and **divides space** instead.

- **Sanctuary** (safe rooms: cottages, the covenant home, public cozy core). Time is gentle. Clocks here are *opt-in* — long projects you choose to advance, never danger that advances on its own. Nothing decays. No combat. No autonomous threat reaches in. This is where coziness lives, and it is the default place a player exists.
- **Frontier** (risky and dangerous rooms, accepted jobs, fronts). Time has teeth. Danger clocks advance when players spend turns there, and unresolved hooks can grow worse through committed play. This is where stakes, discovery, and the Wanderer fantasy live.

The rule is simple and load-bearing:

> **Pressure only exists where the player chose to go.** Seasonal danger movement happens only on committed player turns, only on the frontier, and only against goals the player opted into. A player who never leaves the sanctuary never logs back in to find things worse — only, perhaps, quieter.

Stardew lets your farm sit; CosyWorld lets your home sit. The player who *wants* pressure finds it by walking out, accepting a job, or engaging a front — and for them, the world keeps moving because players keep spending turns.

## Covenants: Shared Ownership

A public, crowded world dissolves individual contribution. The covenant is the answer: **the unit of ownership is the home base, not the player.**

A **Covenant** is a home base a group of players belongs to — a named cottage, guild, school, or shard — a persistent world actor with its own sheet (boons, hooks, resources, projects, reputation, season clock).

- **Owned at a scale that survives scale.** You share the moonlit trail with strangers, but your covenant is a small, named thing your contributions visibly shape.
- **Individual standing is tracked inside it.** Reputation and per-member loyalty record *who* did what; the covenant advances collectively but remembers your share.
- **It advances like a character.** Through play it gains boons, completes projects, raises reputation, and unlocks expansions — the Homemaker's week-over-week goal.
- **It generates content.** Its hooks and projects spawn jobs and fronts (see [Fronts](#jobs-and-fronts)), so the home base is also an engine of things to do.

## Design Principles

- **Motivation before mechanism.** Every feature must serve a player fantasy: something owned, a reason to matter, a goal set. A mechanic that serves only world-integrity and no desire does not ship.
- **Short phrases are mechanically real.** A tag, a Calling, a Bond — small concrete words that rules and AI prompts both read.
- **The world keeps clocks, not just text** — but only the frontier's clocks move on their own.
- **Meaningful choice, not a single button.** The primary action is a suggestion, but it always carries visible risk and effect so pressing it is a decision, not an approval. You can always choose a different approach.
- **Items are the build surface.** Growth is mostly a carried card deck plus
  earned bracelet slots; there is no class tree.
- **Conflict is one risk mode among many**, resolved like any other risk, usually about an objective — never the default solution.
- **Play to find out**, within validated rails. Resident and room evolution is discovered at runtime; AI never invents authoritative state.
- **The home is sacred.** Coziness is a guarantee, not a vibe.

## Player Experience

CosyWorld plays as a warm, shared-world MUD:

1. Arrive in a room — usually your sanctuary.
2. See a clear primary action and a small set of contextual options; as the risk/effect layer lands, those options also show likely risk and effect.
3. Choose an action — the suggested one, or your own approach.
4. Watch the room respond through public events.
5. Gain, spend, use, or change something visible — and accrue toward your Visit Ledger.
6. See the room, residents, items, bonds, and clocks remember what happened.

The visible labels are ordinary words: Chat, Listen, Travel, Take, Give, Use,
Prepare, Rest, Work, Help, Attack, Defend, Flee. Beneath them, supported SRD
5.2.1 actions provide stable rule identities while movement, communication,
inventory, and Cosy advancement remain explicit operations. Skills, weapons,
and spells appear through the same cards and hand rather than separate skill
tree, equipment, and spell-book interfaces. See
[SRD-Backed Action and Collectible System](04-action-system.md).

### Card deck and Menu

The avatar's carried inventory is a **deck of item instances**, not one item and
not a fixed forty-card list. Item weight and size, the avatar's SRD-derived
carrying capacity, and equipped bags/cases determine what can be carried.
Rooms likewise hold multiple loose item instances; reveal, craft, and drop add
cards to that location rather than replacing the one already there.
Bracelet slots determine which skill charms are active; the spell deck/hand
determines which owned Magic effects are ready. Collection, carried deck,
equipped, hand, exhausted/discard, world, and transfer are distinct
authoritative zones.

The play scene remains primary. Account, World, and Orbs should stop competing
as separate top-level destinations and move behind one **Menu** with Deck &
Loadout, Collection & Account, Sign in/Identity, World & Packs, Journal &
Export, Orbs, and Settings & Help. A compact identity or balance display may
remain status, but deck building and journal export are first-class Menu pages.

## Authoritative Loop

1. Rust builds authoritative scene context from the rules profile, kernel state, location/world cards, the player's active card zones, access context, projection state, and economy state.
2. Rust composes the legal action set, asks the kernel which rule actions remain legal, and records the contributing profile, packs, cards, target, resolver, and state revision.
3. Rust ranks a focused action hand from that legal superset and exposes optional commands, adding risk/effect metadata where that rule surface exists.
4. The player chooses an action.
5. Rust validates session, access, cost, rate limit, and target.
6. Rust submits a rule action to the C kernel or schedules a validated projection-only action.
7. The C kernel emits events for authoritative state changes.
8. Rust persists the source action, projects events, updates Orbs, clocks, tags, bonds, room memory, and Visit Ledger progress.
9. AI narrates or replies only through public, validated events; failed or unavailable dialogue inference emits no substitute speech.
10. The room state is broadcast to everyone present.

## Core Entities

### Actor

Actors include player avatars and residents.

- `id`
- `kind`: human or resident
- `location_id`
- `home_covenant_id`: the actor's sanctuary and ownership anchor
- `calling`: the avatar's drive statement (avatars only)
- `stats`: six internal stats, current HP/protection, level
- `skills`: replay-compatibility field for legacy avatar-owned skill steps; new
  active skill bonuses derive from possessed, equipped skill-charm items
- `tags`: short truths such as `inspired`, `tired`, `trusted by rati`
- `conditions`: rule-facing states such as damage, defended, hidden, exhausted, vulnerable
- `inventory`: kernel possession projected as authoritative Collection,
  Carried, Equipped, Spell deck, Exhausted, Contained, World, and Escrow zones,
  with physical capacity and container-fit validation
- `bonds`: relationship edges to residents, factions, rooms, covenants, or other actors
- `ledger_progress`: accrued, unbanked Visit Ledger marks
- `evolution_track`: optional resident or avatar progression

### Bond

- `id`
- `from_actor_id`
- `to_ref`: resident, actor, room, covenant, or faction
- `statement`: the player- or system-authored relationship text
- `strength`: deepening track
- `status`: forming, active, strained, resolved
- `source_event_id`
- `resolved_by_event_id`

### Room

A room is a persistent world actor.

- `id`, `name`, `description`
- `safety`: safe, risky, or dangerous (also selects sanctuary vs frontier rules)
- `access`: public, gated, preview-only, or locked
- `covenant_id`: optional owning covenant
- `aspects`: short room truths
- `memory`: public facts learned or caused in the room
- `residents`, `items`, `exits`
- `clocks`, `resources`, `boons`, `hooks`
- `season_state`

### Resident

Residents are public world actors, not private companions.

- `id`, `home_location_id`, `persona`
- `wants`, `boundaries`
- `relationship_tags`
- `evolution_requirements`
- `reaction_state`
- `memory_refs`
- `allowed_actions`
- Dialogue is inference-only; the worldpack does not ship authored fallback lines.

### Item

Items are the main build surface for a light RPG.

- `id`, `name`, `type`, `tags`
- `owner_actor_id` or `location_id`
- `charges`, `durability`, `slot_cost`
- `recharge_condition`, `break_effect`
- `kernel_effect`, when the item changes authoritative state
- `projection_effect`, when the item only changes clocks, tags, or presentation

### Clock

Clocks are first-class state, not only narration.

- `id`
- `scope`: room, actor, resident, faction, covenant, quest, season, or shard
- `kind`: progress, danger, relationship, project, exploration, or faction
- `zone`: sanctuary or frontier (gates player-turn pressure)
- `label`, `segments`, `filled`
- `visible_to_players`
- `created_by_event_id`, `resolved_by_event_id`
- `on_fill`: validated effect descriptor

### Job

Jobs replace simple item-only quests.

- `id`, `premise`, `stakes`
- `location_ids`, `participant_ids`
- `progress_clock_id`, `danger_clock_id`
- `reward`, `consequence`
- `status`, `memory_summary`

### Covenant

The home-base ownership layer.

- `id`, `name`
- `scope`: room, shard, guild, school, cottage, expansion
- `member_actor_ids`
- `boons`, `hooks`, `resources`
- `reputation`, and per-member `loyalty`
- `projects`
- `season_clock`

### Front

A season-scale frontier threat or opportunity.

- `id`, `premise`, `cast`
- `stakes_questions`: open questions the front will answer through play
- `portent_clock`: the impending-doom track that advances through frontier player turns
- `spawns`: jobs the front creates as it advances
- `resolution`: what completing or averting it does

## Stats And Checks

The kernel keeps the six familiar stats because the V2 prototype already uses them and they are easy to audit: Strength, Dexterity, Constitution, Intelligence, Wisdom, Charisma.

The product UI hides that texture behind friendlier groupings:

- Body: strength and constitution
- Grace: dexterity
- Mind: intelligence
- Heart: charisma
- Wisdom contributes to both Mind and Heart, projected as a defined split (Mind and Heart each take the larger of their primary stat and half of Wisdom), so the mapping is deterministic rather than double-counted.

**You only roll when something is at risk.** A safe authored discovery just
happens. A risky Search, Study, Influence, theft, or conflict action uses an
authoritative deterministic check. Offers expose bounded metadata while the
server, never the client, supplies mechanical inputs:

- `risk`: safe, risky, dire
- `effect`: limited, standard, great
- `clock_delta`: proposed progress or danger movement
- `consequence_pool`: allowed consequences on failure or partial success

The d20 check is fine near-term because it is implemented and familiar. The kernel supports normal, Advantage, and Disadvantage resolution through one deterministic roll path, allowing server-authored Help, Prepare, and condition effects without trusting a client to grant itself a better roll. The long-term design does not depend on a die shape. What matters is a clear fictional trigger, a visible result, and a constrained consequence.

## Action Surface

### Current Kernel Actions

Create Actor, Say, Move, legacy Ability Check, rules-profile Search, Study,
Influence and Magic, Pick Up/Use/Give/Drop/Trade items, theft, crafting, and the
versioned combat encounter actions. Journaled Rust reducers own the bounded
project, loadout, materialization, and progression operations.

### Current Product Verbs

Friendly labels now map to stable SRD 5.2.1 actions or explicit non-action
operations in the compiled registry. The same authoritative envelopes drive
the browser, terminal, inspector, and submission endpoint; see
[the action-system design](04-action-system.md) and
[the implementation ledger](../backlog/srd-action-card-foundation.md).

| Product verb | Kernel or projection | Purpose |
| --- | --- | --- |
| Chat | kernel Say plus AI generation | Public in-character line and resident response; deepens bonds. |
| Notice | kernel Ability Check | Receive an ambient room lead, mark the ledger, advance memory. |
| Inspect | kernel Ability Check | Examine a named target to reveal hidden content. |
| Scout | projection pathway action | Reveal the next adjacent route segment toward a named destination without moving. |
| Travel | kernel Move | Move through legal, accessible exits; crossing into frontier is explicit. |
| Take | kernel Pick Up Item | Move item to inventory. |
| Give | kernel Give Item | Resident evolution, bonds, job delivery, covenant contribution. |
| Use | kernel Use Item | Consumables, tools, relics, room effects. |
| Attack | kernel Attack | Rare frontier conflict, resolved as a risk toward an objective. |
| Defend | kernel Defend | Short defensive condition. |
| Flee | kernel Flee | A valid success path out of danger. |
| Prepare | projection action now; kernel later only if needed | Create advantage, lower next risk, add a temporary tag. |
| Rest | projection action now; kernel later only if needed | Reset fatigue/skill step-downs; in the frontier, costs a danger/season tick. |
| Contribute | projection clock action | Advance one named job or covenant clock through job-specific Push and, when available, Help strategies. |

Generated long-distance pathways use these same verbs and UI rules. Scout reveals one adjacent stretch as shared geography without moving, but it never replaces the rest of the hand or locks future movement. When an Explorer first opens a route, bounded structured generation may create every hidden waypoint's narrative identity from its deterministic biome and terrain; each identity remains concealed until its Scout edge is revealed. Invalid or disabled generation keeps the deterministic identity, and neither form may change topology or rules. Generated waypoint rooms begin risky and frontier-zoned. Every generated route receives one shared familiarity job and progress clock across its waypoint rooms; Push and Help are strategies on one contribution card and advance that same clock. Filling the clock settles the route into sanctuary rules and unlocks generated landscape art, while the deterministic SVG remains available throughout discovery and as the inference fallback.

### Primary Action Priority

The primary action is helpful, not exhaustive. As risk/effect metadata lands, it should make the choice visible rather than hidden:

1. Required onboarding action.
2. Urgent frontier-danger action: Flee, Defend, Use recovery, Attack.
3. Free ledger-earning action (always available without currency).
4. Act on your Calling, if a contextual option fits it.
5. Deepen or resolve a Bond.
6. Give a matching evolution/job item.
7. Use a meaningful carried or equipped item card.
8. Take a useful visible item.
9. Chat with an eligible target, only when advancement can create the friendship.
10. Notice, Inspect, Scout, Travel, or Contribute.

The primary action may vary by context, but the result is always public.

## Resolution Model

### Kernel Layer

Actor creation; movement legality; safe-room combat rejection; ability checks; HP/protection; Defend/Flee/Attack legality and results; item ownership transfer; consumable use; resident evolution gates; any effect that can grant, remove, kill, unlock, move, or spend authoritative world state.

### Projection Layer

Primary action selection; card projection; room memory; clocks; bonds; the Visit Ledger and its claim keys; the Orb ledger and claim keys; AI usage ledger; access feed; jobs/fronts/covenants until they require kernel enforcement; public event feed shape.

### AI Layer

Resident reply proposals; director narration; room beat suggestions; job and
front premise drafts; media prompts; summaries. A resident reply receives the
triggering card/event plus recent room-log entries, recent speech, cast,
location memory, goals, and resident continuity. AI output must be validated,
sanitized, and committed as public event content. AI never grants items, fills
clocks, applies conditions, deepens bonds, changes access, marks the ledger, or
spends currency directly.

## Clocks

Clocks give CosyWorld persistent pressure without heavy rules.

### Clock Types

- Progress: repair, research, prepare, befriend, unlock.
- Danger: storm, suspicion, exhaustion, instability, threat.
- Relationship: trust, rivalry, debt, warmth (often the mechanical face of a Bond).
- Project: room improvements, covenant goals, resident requests.
- Exploration: learn an area, map paths, discover features.
- Season: weekly or daily world cadence.

### Clock Movement

Clock changes are event-backed. A successful Listen may fill progress; a failed risky action may fill danger; Rest may reset fatigue and, on the frontier, tick a danger or season clock; Work fills project progress; later actions may deepen an existing Bond; combat fills objective clocks rather than only dealing damage. Chat creates the initial Bond by spending advancement and does not silently fill unrelated clocks.

**Offscreen movement is frontier-only.** A clock advances between visits only if its `zone` is frontier and it belongs to a goal the player opted into. Sanctuary clocks never move on their own.

### On-Fill Effects

Clock completion can add or remove a room tag, unlock an exit, spawn or reveal an item, change resident reaction state, complete or fail a job, create a new job, or advance a covenant or season. Every on-fill effect is a validated descriptor; if it changes authoritative state it compiles into kernel actions, otherwise into a `ProjectionMutation`. This compiler is the enforcement seam and is specified below.

## On-Fill Effect Descriptors

A descriptor is a closed-vocabulary instruction attached to a clock's `on_fill` list. Nothing free-form — including anything AI proposed — reaches authoritative state except by being expressed as one of these ops and surviving compilation.

### Runtime status

The projection-safe slice is landed. `ClockState` carries `on_fill: Vec<EffectDescriptor>`, `advance_clock` dispatches it when `filled >= segments` crosses for the first time, and the Moonlit Trail clocks use it to apply room tags and set job status. Implemented projection ops are `advance_clock`, `set_tag`, `clear_tag`, and `set_job_status`.

The remaining target shape is broader: resident reactions, job creation, covenant/season movement, authoritative kernel-routed ops, and bounded cascade handling.

### Closed op vocabulary

| `op` | Layer | Compiles to | Notes |
| --- | --- | --- | --- |
| `advance_clock` | projection | `ProjectionMutation::AdvanceClock` | `amount` bounded to `[1, target.segments]`. |
| `set_tag` | projection | `ProjectionMutation::SetTag` | tag `scope`/`scope_id`/`kind` from a closed enum. |
| `clear_tag` | projection | `ProjectionMutation::ClearTag` | `tag_id` must resolve. |
| `set_resident_reaction` | projection | reaction-state reducer | resident must exist; reaction from closed enum. |
| `set_job_status` | projection | job reducer | `complete` / `fail` only; transition must be legal. |
| `create_job` | projection | job seed reducer | premise/clocks validated like a seeded job. |
| `advance_covenant` / `advance_season` | projection | covenant/season reducer | bounded delta. |
| `unlock_exit` | authoritative | kernel Move-graph mutation | exit must exist and be currently locked. |
| `spawn_item` / `reveal_item` | authoritative | kernel item create at location | item template must exist; respects room capacity. |
| `grant_item` | authoritative | kernel Give Item | target actor present and the resulting carried deck legal by weight, size, containers, and typed slots. |
| `apply_condition` | authoritative | kernel condition set | condition from the kernel's known set. |

Authoritative ops never apply in Rust; they are submitted to the C kernel, which can still reject them (a safe room rejecting `apply_condition: vulnerable`, or an overweight/oversized carried deck rejecting `grant_item`). Projection ops apply in Rust and may never contradict kernel state.

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

On-fill dry-runs the whole list before applying anything:

1. **Parse.** Reject any descriptor whose `op` is not in the table. Fail closed — an unrecognized op aborts the whole list.
2. **Resolve.** Every referenced id must resolve in current state. Unresolved → reject the list.
3. **Bound-check.** Amounts within `[1, segments]`; deltas within configured caps; enum values within their closed sets.
4. **Stage.** Validate the entire list first; apply only if all descriptors validate, so a partial on-fill can't leave the room impossible.
5. **Apply and route.** Projection ops apply as `ProjectionMutation`s in event order. Authoritative ops go to the kernel; its accept/reject is authoritative and is recorded, not swallowed.

### Idempotency and cascades

- Current implementation carries a claim key `clock_fill:{clock_id}:{filled_crossing_event_seq}`. A clock fires its `on_fill` exactly once for that filled crossing even if the source action is retried.
- Target cascade guard: on-fill effects can fill other clocks, but before arbitrary content uses that power, add bounded depth (default 8) and a per-tick visited set of clock ids; exceeding either aborts the remainder and emits `clock.fill_cascade_aborted`.

### Failure modes

| Failure | Handling |
| --- | --- |
| Unknown `op` | Reject whole list; clock stays `filled`; emit `clock.fill_effect_rejected`. |
| Reference does not resolve | Reject at stage 2; emit `clock.fill_effect_rejected` with the missing id. |
| Amount/delta out of bounds | Reject at stage 3. |
| Authoritative op rejected by kernel | Applied projection ops stand (projection may lag, never contradict); emit `clock.fill_effect_partial`. |
| Cascade exceeds depth or revisits a clock | Abort remainder; emit `clock.fill_cascade_aborted`. |
| Replay of the same fill | `clock_fill` claim key makes it a no-op. |

The residual risk is stage 5: a kernel rejection after projection ops applied. Mitigate with ordering discipline — likely-rejected authoritative ops first — plus the `clock.fill_effect_partial` audit event so divergence is never silent.

## Tags, Aspects, And Conditions

One tag model, many scopes.

```json
{
  "id": "tag_tired",
  "scope": "actor",
  "label": "tired",
  "kind": "condition",
  "source_event_id": "event_123",
  "expires": { "type": "after_rest" }
}
```

Kinds: `aspect` (stable truth), `condition` (temporary/rule-facing), `memory` (public fact), `bond` (relationship state), `boon` (beneficial room/covenant trait), `hook` (complication/obligation), `calling` (avatar drive). Tags are short, concrete, reusable by rule filters and, in the target AI context layer, prompts. Because AI will read tags, tag text is untrusted input: sanitized before any prompt, never interpreted as an instruction.

## Progression And Advancement

Progression is earned through play and never bought. It has three surfaces, deliberately light:

- **Bracelet slots step up.** A skill exists in the world as an Item card—a
  lucky raven feather, brass thimble, carved tooth, or similar charm. Banking
  Visit Ledger progress unlocks another bracelet slot; it does not create a
  charm. A charm's authored skill bonus applies only while the avatar possesses
  and wears it. Gift, trade, drop, or steal the charm and its skill, bonus,
  rarity, and provenance travel with it; the former holder loses access. A
  rare skill still has to be found. The current avatar-owned skill-step field
  is migration state, not the target model.
- **Items are the build and the common UI.** Weapons supply Attack profiles;
  skill charms supply check modifiers or specialist qualification; prepared or
  drawn spell cards supply bounded Magic effects; other gear carries charges,
  durability, recharge conditions, and break-to-absorb-harm. All are acquired
  through play, crafting, covenant projects, or a free/core-equivalent path.
- **Carrying capacity is deck size.** Every item card has weight and size/bulk.
  The avatar's SRD-derived carrying capacity plus equipped bags, cases,
  sheaths, and other containers determines the legal carried deck; there is no
  arbitrary forty-card inventory rule. Bracelet slots decide which charms are
  active, not how much the avatar can physically carry.
- **Bonds, Callings, and Covenants are the long game.** Deep bonds unlock resident evolution and reactions; fulfilled callings define milestones; covenant projects open boons and expansions. These are the week-over-week goals the player sets for themselves.

Banking the ledger at a milestone is where a player chooses *how* to grow —
unlock a bracelet slot, add a bond slot, contribute to a covenant, or revise a
Calling — so advancement is an expressive choice, not an automatic drip.
Capacity and discovery remain separate: earning a second charm slot does not
grant the second charm.

## Economy

Two economies, kept strictly separate so the core loop is never gated.

**Progression** (skills, bonds, items, covenant standing) is earned by play, per the section above. It cannot be purchased.

**Orbs** are a public image-making currency, never a power source.

Their sole spend is community image generation for eligible generated cards. A card unlocks one generation at each authoritative level, the community pools exactly that level in Orbs, and the prompt incorporates committed public history so later images can evolve with the world. Contributions buy no ownership or rules authority; a fully funded retry costs nothing.

Chat, Say, resident heartbeats, Listen/Notice, Help, bond, travel, combat, access, and progression never spend Orbs. Chat instead spends one banked advancement point to create a new Bond. Reward rules remain claim-key gated and idempotent (next section), so identical actions never mint unlimited Orbs. The negative ledger is equally strict: new actions may use only `community_image_generation`, capped by `{subject, level}`.

## Claim Keys And Idempotency

Every mint, spend, ledger mark, and one-shot RPG effect is gated by a claim key. This is what makes "repeated identical actions never mint unlimited Orbs" — and "you can't farm the same bond twice" — true rather than aspirational.

### What already exists

The runtime carries snapshot-persisted claim sets and a ledger: `listen_attempt_claims` (earn-once-per-context attempts), `orb_reward_claims` (mint dedup), `rpg_claims` (one-shot effect dedup), and `OrbLedgerEntry.idempotency_key` (ledger-write dedup). Keys are deterministic strings built from authoritative facts, e.g. `ability_check_success:{actor_id}:{location_id}:{ability}:{dc}`, `listen_attempt:{actor_id}:{location_id}`, `combat_knockout:{actor_id}:{target_id}`. New effect types (ledger marks, bonds, on-fill, jobs, Rest, Work) extend this convention.

### The primitive

`set.insert(key)` returns `true` only if the key was newly added. Apply the effect iff insert returned true; otherwise it is a no-op. Because the claim sets are part of the persisted snapshot, this survives restart — a replay after a crash does not re-mint. Idempotency is two layers: the claim set decides *whether to attempt*; `OrbLedgerEntry.idempotency_key` independently guards the ledger write.

### The one rule that matters: key granularity

A key is a pure function of authoritative facts — never wall-clock time or RNG.

- **Too coarse** → a legitimate repeat reward is silently swallowed (under-mint). A recurring reward must fold the repeatable unit into the key — a season id, a job id, the source event seq — e.g. `work_clock:{actor}:{job}:{season}`.
- **Too fine** (includes event seq or timestamp on a once-only reward) → every retry mints again (over-mint). This is the dangerous direction; guard it in review.

So the design step for any new reward is explicit: decide intended repeatability, then choose the matching key granularity.

### Failure modes

| Failure | Effect | Mitigation |
| --- | --- | --- |
| Key too coarse | Legitimate repeat reward swallowed | Fold the repeatable unit into the key. |
| Key too fine / includes time or RNG | Replays double-mint | Keys are pure functions of authoritative facts; enforce in review. |
| Claim set not persisted | Restart re-mints | New sets must be added to the snapshot. |
| Concurrent same key | Two attempts race | `insert` is the single serialization point per runtime; one wins. |
| Set grows unbounded | Snapshot bloat | Prune only keys whose underlying state can no longer recur (archived job, closed season). |

Keys include `actor_id`, so two players earning at the same clock in the same tick never collide; the same actor repeating only collides when the key is intentionally earn-once.

## Ownership, Cards, And Secret Poems

CosyWorld owns its things without a blockchain or a token. Ownership rides a **signed, content-addressed, append-only provenance log** — the same substrate Signal already ships ([decentralization synthesis](../../../signal/docs/decentralization-synthesis.md)): Ed25519 identity everywhere, content hashes with merkle provenance, a per-authority signed event log, and Arweave for permanence. It is closer to "git with signatures and provenance" than to Ethereum: no consensus, no gas, no token, no global state machine.

### The substrate

- **Identity** is an Ed25519 keypair held by the client. Players and authorities (the kernel, a covenant) are pubkeys.
- **Assets are content-addressed.** A card *type* is the hash of its definition `{art, name, tags, edition}`; a card *instance* is `card_type + serial + mint_event`, carrying a `parent_merkle` that records exactly where it came from.
- **The authority surface is the log.** Each event (`mint`, `transfer`, `gift`, `swap`) is signed by the issuing authority's key; ownership is a fold over the log — the latest signed transfer naming your pubkey wins. A verifier (Signal's `signal_verify`, shared) walks the log and checks every signature.
- **Decentralization is a dial, not a rewrite.** Federation today: the operator signs as the authority — *quorum pinned to 1*. A future P2P endpoint quorum-signs across present shard members. The schema does not change; `authority` is just a pubkey either way.

Be precise about the claim: in federation this is **verifiable and permanent**, not yet **trustless** — players trust the operator not to rewrite the log, but signatures make tampering detectable. Full trustlessness is the P2P endpoint.

### Trading cards

A trading card is an `Item` with a chain instance behind it. Mint is bound to the moment it was earned (`because: event_id`), so a card carries its own story — *minted by calming the Moonlit Echo, Season 3*. Value is **provenance, not artificial scarcity**.

CosyWorld defaults to a **provenance-preserving** stance — the cozy middle between property and memory:

- **Gifting is free and first-class.** Handing a card to someone is a single signed `transfer`. The lineage records who gave it and when, forever.
- **Trading exists but is world-bound.** A `swap` requires both parties present in the same room or covenant; it is co-signed (or escrowed through the authority) and atomic. Nothing is laundered — a trade *re-attributes* provenance, it never erases it.
- **No anonymous secondary market.** Because every transfer is in-world, signed, and lineage-carrying, the design structurally resists cold speculation while keeping a real collection game.

### Playable item cards

Weapon, skill, and spell collection uses the same Item-card language as the
rest of the world:

- A **weapon card** is equipped or played to supply an authoritative Attack
  profile.
- A **skill-charm card** is worn on a bracelet. Its instance owns the skill id
  and authored bonus; the wearer supplies the ability, situation, and action.
- A **spell card** lives in a prepared spell deck and supplies one bounded
  Magic effect. A later draw/discard profile may make the spell deck a literal
  hand, but it can constrain only Magic choices, not ordinary SRD actions.

“Play this card” always means submit its server-authored action offer. Card
text, rarity, and browser state never apply an effect by themselves. Rarity
describes provenance, discovery, art, or unusual applicability independently
of the rules-power budget.

Because these are world items, they can participate in authored gifting,
trading, dropping, and theft. Theft is not an ownership shortcut: it is a risky
server-resolved action that atomically changes authoritative possession and
records a visible consequence. A charm's skill and bonus go with the successful
transfer. Paid acquisition cannot mint slots, automatic success, or exclusive
best-in-slot power; progression remains earned through play.

### Secret poems

Poems are the cozy face of cryptographic unlocks — the principle that *short phrases are mechanically real*, taken to its end. They do three distinct jobs, and the security of each is different:

- **Claiming and gifting → commit-reveal claim ticket (consumable).** A card minted as a reward can carry a claim poem. To claim, you first commit `hash(poem + your_pubkey)`, then reveal — so a watcher scraping the public log cannot front-run you. Reciting binds the card to your key *once*; afterward the poem is spent and inert. Gifting a card can be as simple as whispering its poem.
- **World gates → public incantation (repeatable).** A poem can be lore, not a secret: reciting it as a validated Say/Chat action triggers a kernel-checked unlock (a hidden exit, a covenant boon). Repeatable and shared — a covenant learns the Hearth-Song together. No key risk, because there is no key.
- **Never poem-as-key.** A poem must never *derive* the owning keypair. Low-entropy brainwallets are drained by bots that pre-hash every poem ever written, and in a world where everything is public a spoken poem would be a published private key. Keys are keys; poems are tickets and incantations.

Rule of thumb: card claims are **consumable** (first reciter binds it, then spent); world gates are **repeatable** (lore that spreads).

### External NFT bridge

External Solana NFTs (Ruby High cards, burnable Boxes) are an **optional bridge that gates official expansions**, not the base game's ownership layer. A held NFT can be projected into the native chain as a card and can count toward expansion access; the base game's cards, gifting, trading, and poems never require a wallet. This satisfies the invariant that CosyWorld Core is fully playable, ownable, and tradeable without NFTs.

## Combat And Conflict

Combat is not a separate subsystem; it is a risk roll on the frontier, usually toward an objective. Safe rooms reject it outright.

- Danger rooms can expose Attack, Defend, Use, and Flee.
- Conflict is usually about an **objective clock**, not only HP — calm the thing, reach the exit, protect the resident.
- **Flee is a valid success path**, and can mark the frontier ledger.
- Gear durability can **break to absorb harm**, turning a hit into a brief hindrance.
- KO is explicitly nonlethal: an otherwise-defeated actor remains at 1 HP, becomes Unconscious, and needs recovery before acting again.
- Bloodied is derived at half HP or lower and can drive recovery offers and resident reactions without becoming another persistent flag.

Near-term combat can keep the existing d20 attack, armor, defend bonus, d8 damage, crit, potion, nonlethal KO, Bloodied threshold, and flee primitives — but they are framed as one risk/effect resolution, not a bespoke D&D engine. The next evolution adds objective clocks, room danger clocks, durability-absorbs-harm, and public resident reactions to conflict.

Example conflict:

```text
Objective clock: Calm the Moonlit Echo, 4 segments
Danger clock: Echo Shatters the Trail, 4 segments
Actions: Listen, Defend, Use charm, Attack, Flee
Win: room gains "quieted moonlight"
Loss: room gains "echo-fractured"; travel is risky until repaired
```

## Jobs And Fronts

### Jobs

The current quest schema only supports item-at-location and item-owned checks. V2 replaces it with jobs. A job has a premise, a public room or route, stakes, a progress clock, a danger clock, involved residents or covenants, required item/room tags, rewards, consequences, and a completion memory.

```json
{
  "id": "job_greenhouse_warmth",
  "premise": "The Greenhouse is losing its morning warmth.",
  "stakes": "If nobody helps, seedling rooms become risky after sundown.",
  "progress_clock": { "segments": 6, "filled": 0 },
  "danger_clock": { "segments": 4, "filled": 1 },
  "actions": ["Listen", "Use", "Work", "Give"],
  "reward": { "orbs": 2, "tag": "greenhouse trusted", "ledger": "you helped" },
  "consequence": { "room_tag": "chilled panes" }
}
```

### Fronts

A front is a season-scale frontier threat or opportunity — the engine that keeps the wanderer's world alive through play. A front has a premise, a cast, open **stakes questions** the world will answer through play, and a **portent clock** that advances on frontier player turns toward an impending outcome. As it advances it **spawns jobs**; resolving or averting it changes covenants, rooms, and seasons.

Fronts only touch the frontier, and only against goals players opted into — the sanctuary never feels their pressure. Covenant hooks and unresolved job consequences are the usual seeds of new fronts.

## Room And Covenant Sheets

Every important location and covenant gets a sheet.

```json
{
  "id": "room_cosy_cottage",
  "name": "The Cosy Cottage",
  "safety": "safe",
  "covenant_id": "cov_hearthside",
  "aspects": ["warm threshold", "careful host"],
  "boons": ["new avatars can begin here"],
  "hooks": ["the hearth notices unfinished promises"],
  "resources": { "warmth": 3, "tea": 2 },
  "projects": [],
  "season_clock": { "segments": 7, "filled": 0, "zone": "sanctuary" }
}
```

This is how CosyWorld becomes more than a chat layer: the room and the covenant grow, strain, recover, and remember — and the covenant gives players a thing that is collectively theirs.

## Resident Behavior And Graceful Degradation

Residents remain deterministic world actors even though their visible dialogue requires live inference.

- **With AI:** residents propose lines through the validated AI layer, reading their persona, wants, reaction state, and the player's bonds.
- **Without AI:** deterministic reducers still run world actions such as gifts and evolution gates, but no resident or avatar dialogue is fabricated. Chat fails visibly without any currency effect, community image funding is unavailable before debit, and incidental reactions are skipped until inference is available.

This is enforced as an acceptance criterion for core world rules: reaction-state transitions, bond deepening, and evolution gates are deterministic projection logic. Generation may speak about those changes, but it does not own them; dialogue itself fails closed when inference is unavailable.

## Data Migration Direction

Suggested new projection stores: `tags`, `clocks`, `bonds`, `callings`, `jobs`, `fronts`, `room_sheets`, `resident_sheets`, `covenants`, `ledger_marks`, `season_turns`, plus the ownership chain: `identities` (pubkeys), `card_instances` (with `parent_merkle`), `card_events` (the signed mint/transfer/gift/swap log), and `poem_claims` (commit-reveal state). For SQLite, flexible JSON columns are fine for effect descriptors and sheets, but index lookup fields: `scope`, `scope_id`, `status`, `zone`, `visible_to_players`, `updated_at_ms`. Keep kernel state small and deterministic; projection state can be richer as long as it cannot contradict the kernel.

## Implementation Roadmap

### Phase 1: System Foundation (landed, with follow-ups)

Clock and tag projection state in Rust; Moonlit Trail clocks; sanctuary/frontier zone flags on room sheets and clocks; `/state` exposure; all clock/tag changes server-authored. Follow-up: event-backed room memory.

### Phase 2: Motivation Core (landed foundation)

Default Callings, first-class resident-gift Bonds, player-authored resident Bond slots, Bond revision/resolution, Visit Ledger marks for Search/Study/Calling/Helped/bond/frontier-return, Visit Ledger banking into advancement points, Calling revision, Bond slot creation/revision, claim-key gating, sanctuary/frontier zones, bracelet slots, equipped skill-charm bonuses, and the complete card-zone/materialization lifecycle are landed. Legacy avatar skill steps remain replay-compatible but are no longer the ordinary new progression path. Covenant contribution and additional advancement choices remain future breadth.

### Phase 3: Stable Verbs (landed foundation)

Search, Study, Influence, Magic, Ready/Prepare, Utilize/Work, Help, Rest,
Attack, Dodge, and Escape are bound to either the C kernel or a validated
journaled reducer. Dash, Disengage, and Hide remain explicitly unsupported.

### Phase 4: Jobs And Fronts (job seed landed; front seed first slice landed)

Seed job schema/projection, Moonlit job resolution, player-turn Moonlit encounter reset, and the first content-backed frontier Front records are landed. Follow-ups: migrate generated quests into jobs, let Use/Give/combat move job clocks, add rewards/consequences/completion memory, and add player-turn portent movement on the frontier only.

### Phase 5: Covenants And Sheets

Covenant sheets with boons/hooks/resources/reputation/loyalty; room sheets; covenant projects that spawn jobs and modify rooms; seasonal clock ticks.

### Phase 6: Conflict Objectives And Item-Card Progression (landed foundation)

Objective clocks in danger rooms, nonlethal outcomes, container contents and
size validation, equipped weapon profiles, executable bounded spell cards,
authoritative materialization/theft/transfer, bracelet-slot progression,
skill-charm equipment, and weight-based carrying capacity are landed.
Durability/armor and broader Calling milestones remain possible future systems.

## Acceptance Criteria For New Rules

A new RPG feature is ready to ship when:

- It serves a stated player fantasy (something owned, a reason to matter, or a goal set).
- It has a clear player-facing verb or passive effect.
- It states whether authority belongs to C kernel, Rust projection, or AI proposal.
- It has an event-backed audit trail.
- It cannot be triggered by client-only state.
- It behaves correctly in sanctuary, frontier, gated, and public core rooms.
- It has an idempotency strategy for rewards, ledger marks, or spends.
- A core world rule has a deterministic, non-AI path. A dialogue capability instead fails visibly and without charge when inference is unavailable, and never emits substitute speech.
- It preserves public-room behavior and never lets currency buy progression or outcomes.
- It has at least one local test or smoke assertion covering the authoritative path.

## First Concrete Slice

The smallest useful implementation, building on what is already landed:

1. `ClockState`, `TagState`, projection-safe `on_fill` descriptors, and zone flags exist in Rust (done).
2. Seed the Moonlit Trail (frontier) progress and danger clocks (done).
3. Make Listen fill the progress clock once per actor/location claim and add matching Visit Ledger marks (done).
4. Add a one-line Calling at avatar creation and mark the ledger when a Listen matches it (done).
5. Make repeat Listen pressure frontier-only without currency: Moonlit Trail repeats can add `tired`; Cottage repeats stay free and calm (done).
6. Add Rest to clear a `tired` tag and tick the Moonlit danger clock; danger ticks are zone-gated to frontier clocks (done).
7. Expose clocks, tags, jobs, room sheets, Calling, and unbanked ledger progress in `/state` (done).
8. Smoke coverage proving clocks are public, persisted, event-backed (done), and that sanctuary clocks do not move without a committed player turn once player-turn frontier movement expands.

This slice tests the whole philosophy — motivation, sanctuary/frontier, honest world — without a kernel rewrite.

## Design Summary

CosyWorld is cozy because you have a home you own, a covenant that is yours, bonds that remember you, and a sanctuary nothing can spoil. It is an RPG because you have a calling to live up to, a frontier with real stakes you choose to face, items that matter, and a world that changes in ways everyone can see — and credits *you* for.

The north star: press one meaningful action, let the server decide what is true, let the room and your bonds remember, let the home stay safe, and let AI make the public result feel alive — for everyone watching, together.

## Lineage And References

CosyWorld's mechanics are original writing, but their shapes were studied from a shelf of open tabletop systems. Each entry notes what we took, what we left, and the license signal from the [reference shelf](../../reference-library/rpg-systems/README.md). Adapt CC-BY wording with attribution; treat CC-BY-SA wording as reference-first unless we accept share-alike obligations.

### Fate

- **License:** CC-BY 3.0 / OGL options — `sources/fate-srd-content`.
- **Taken:** short phrases as mechanically real truths (aspects → tags, Callings); persistent consequences; create-advantage (Prepare); milestones as the moment a player chooses how to grow.
- **Left:** a Fate-point economy as the main player economy; open-ended negotiation at the moment of action.

### Blades in the Dark and Charge

- **License:** Blades CC-BY 3.0 (`sources/blades-in-the-dark-srd-content`); Charge CC-BY 4.0 (`raw/charge-srd.md`).
- **Taken:** clocks as first-class state; position/effect framing (risk/effect on every action); the **crew as a shared, advancing unit** (→ Covenants); **XP triggers** that reward expressing your beliefs and daring (→ the Visit Ledger and Callings); reputation and faction pressure that advances through play (→ Fronts).
- **Left:** the full heist/downtime structure; trauma/vice as a tonal fit; every action as a player-vs-GM negotiation.

### Dungeon World

- **License:** CC-BY 3.0 — `sources/dungeon-world-markdown`.
- **Taken:** the **End of Session move** (mark advancement for resolving bonds, fulfilling your drive, learning, overcoming, looting → the Visit Ledger); **Bonds** as resolvable, rewritable relationship statements (→ first-class Bond entities); **Fronts** with dangers, impending dooms, grim portents, and stakes questions (→ the Front entity and frontier-only portent clocks); fiction-triggered consequences and "play to find out."
- **Left:** requiring players to learn named tabletop moves; giving AI authority to invent unvalidated state.

### Cairn, 24XX, and Breathless

- **License:** Cairn CC-BY-SA 4.0 (`sources/cairn`, reference-first); 24XX CC-BY 4.0 (`raw/24xx-srd.md`); Breathless CC-BY 4.0 (`raw/breathless-srd.md`).
- **Taken:** **only roll when there is real risk** (keeps the sanctuary calm); step-down/step-up inspiration reshaped into earned bracelet slots plus discoverable skill charms; **gear breaks to absorb harm**; "if it costs less than a video game, the only cost is time" (→ progression earned not bought); short, legible risk rolls; "favor inclusion over realism" (KO continues play).
- **Left:** dense class progression; combat as the default solution.

### Ars Magica

- **License:** CC-BY-SA 4.0 (reference-first) — `sources/ars-magica-open-license`.
- **Taken:** the **covenant as an owned, persistent home base** with its own sheet, reputation, and members (→ Covenants); seasonal cadence and long projects that advance across days or weeks (→ season clocks, covenant projects); the home as the stable center of play (→ Sanctuary).
- **Left:** deep simulation that asks a player to manage a campaign workbook; magic-system depth.

### 5e CC SRD 5.1 and SRD 5.2.1

- **License:** CC-BY 4.0 — `sources/cc-srd-5e` and the separately
  attributed `v2/content/rules-srd-5.2.1` pack.
- **Current:** the six familiar stats and a bounded fifth-edition-compatible
  kernel surface; condition, monster, equipment, and spell material otherwise
  remains reference/conversion data.
- **Target:** SRD 5.2.1 supplies stable action identities and supported
  resolution semantics. Core and expansions reskin those actions; weapons,
  skill charms, and spell cards supply collectible Item bindings.
- **Left:** full class/subclass/spell-slot progression, tactical completeness,
  and any claim that CosyWorld implements the entire Dungeons & Dragons game.

### Discovery indexes

- **Awesome Tabletop RPGs** (`sources/awesome-tabletop-rpgs`) — a curated list used to find additional open systems. A discovery aid only; verify each linked project's license before adapting wording.

### Signal (internal substrate, not a tabletop source)

- **Source:** the sibling `signal/` project — [`docs/decentralization-synthesis.md`](../../../signal/docs/decentralization-synthesis.md), `server/chain_log.h`, `client/identity.h`, `shared/types.h`.
- **Taken:** the entire token-free ownership substrate — Ed25519 identity, content-addressed assets with `parent_merkle` provenance, the per-authority signed append-only chain log, the `signal_verify` verifier, Arweave/Irys permanence, and the "federation is P2P with quorum pinned to 1" framing. CosyWorld's kernel is, architecturally, a Signal station authority, so the `chain_log` code can be shared.
- **Left:** the physics sim, the per-station credit/FX economy, and the rock-combat model — those are Signal's game, not CosyWorld's.
