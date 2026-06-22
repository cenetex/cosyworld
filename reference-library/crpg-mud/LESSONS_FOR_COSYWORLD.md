# Lessons For CosyWorld

Derived from the local CRPG/MUD reference pull and the current CosyWorld v2 docs/kernel.

## Executive Takeaway

CosyWorld is already pointed in the right direction: a deterministic core, a Rust orchestrator, shared room events, sanctuary/frontier pressure, cards, bonds, clocks, and public AI output. The reference projects mostly argue for one next move: stop treating content as seed code and make it a first-class, validated worldpack system.

The durable engines all converge on the same shape:

- A small authoritative runtime.
- Explicit content manifests and prototypes.
- Server-derived command/action offers.
- Builder/admin tooling.
- Replayable events and migrations.
- Strong separation between engine, game data, user saves, and generated narration.

## Highest-Value Lessons

### 1. Make `seed_content.json` Become A Worldpack

Flare, Solarus, RPG-JS, Crossfire, GoMud, CoffeeMud, and Evennia all make the content layer concrete: maps, items, commands, quests, rooms, scripts, prototypes, and builder metadata live outside the engine. CosyWorld has the beginning of this in `v2/orchestrator-rust/src/seed_content.json`, but the C kernel still hardcodes seed locations, exits, actors, and items.

CosyWorld lesson:

- Define a `worldpack` format for actors, residents, locations, exits, items, room features, jobs, clocks, access gates, fallback lines, cards, and AI prompt contracts.
- Add a content validator/linter before runtime boot.
- Load kernel-safe ids from the worldpack rather than duplicating seed topology in C and Rust.
- Store the worldpack hash in snapshots and journal records so replay knows which content version produced the events.

Suggested first structure:

```text
v2/content/core/
  worldpack.json
  actors.json
  residents.json
  locations.json
  exits.json
  items.json
  room_features.json
  jobs.json
  clocks.json
  cards.json
  access_gates.json
  fallback_lines.json
```

### 2. Use Prototypes, Not Bespoke Rows Everywhere

Evennia's prototype spawner, FluffOS/LPMUD clone objects, Crossfire archetypes/types, and Flare's mod data all separate a type definition from live instances. CosyWorld's signed card plan already has this distinction: card type is content-addressed; card instance is minted by a world event.

CosyWorld lesson:

- Give every actor/item/location/card a `type_id` and every live object an `instance_id`.
- Support `prototype_parent` or `extends` for content inheritance.
- Let live instances carry only deltas: owner, location, holder, charges, damage, bond strength, clock fill, tags.
- Keep Rust projection responsible for turning kernel ids into display cards.

This will make item/resident expansion much cheaper and will align content, cards, and provenance instead of making them three parallel systems.

### 3. Keep The One Button, But Build Command Sets Underneath

Evennia's command sets, Kalevala's controller/command routing, RPG-JS's server-owned event model, and classic MUD parsers all treat available commands as state-dependent. CosyWorld's one-button UI is a good product stance, but the engine should expose a richer ranked command set.

CosyWorld lesson:

- Continue exposing one primary action in the browser.
- Internally model actions as command offers with: `id`, `label`, `rank`, `zone`, `target`, `risk`, `effect`, `cost`, `claim_key`, and `disabled_reason`.
- Split offers into `primary`, `contextual`, `inventory`, `travel`, `social`, `builder`, and `hidden/system`.
- Let the client render a simple surface while tests and future clients can inspect the complete command set.

This keeps the UX cozy without trapping the engine in a single-button architecture.

### 4. Give Every Interactive Object A Small Lifecycle

Crossfire's object types register lifecycle hooks like apply, process, trigger, and move-on. FluffOS has `create`, `init`, `heart_beat`, and timers. CosyWorld already has actions and projection mutations, but objects do not yet have a general content-authored lifecycle.

CosyWorld lesson:

- Add a small set of validated lifecycle hooks for worldpack objects:
  - `on_look`
  - `on_listen`
  - `on_use`
  - `on_give`
  - `on_enter`
  - `on_leave`
  - `on_tick`
  - `on_clock_fill`
- Hook bodies should be typed effect descriptors, not arbitrary scripts.
- The C kernel validates rule-facing effects; Rust applies projection-only effects.

This is the safe middle path between hardcoding every item and letting AI invent mechanics.

### 5. Treat Actions As Request / Resolve / Commit

Kalevala's movement and item events use request/abort/commit patterns. This maps neatly to CosyWorld's AI constraint: AI may propose, but the world must validate.

CosyWorld lesson:

- Model richer actions as:
  - intent/request
  - rule validation
  - room/object vetoes or modifiers
  - commit event
  - projection mutations
  - public narration
- Use the same pattern for player actions, resident actions, AI proposals, scheduled clock ticks, and builder-triggered test actions.

This will help when multiple systems care about one action: access gates, room safety, jobs, bonds, clocks, inventory, Orbs, and AI narration.

### 6. Builder Tooling Is Not Optional

CoffeeMud, GoMud, Evennia, Solarus, Eldiron, and Flare all invest in builders: online creation, admin pages, map editors, prototype menus, guide docs, import/export, and validation. Shared worlds become content operations.

CosyWorld lesson:

- Build a local `worldpack check` command before adding more content.
- Build a read-only browser admin for room sheets, exits, actors, items, jobs, clocks, and generated cards.
- Then add editing for low-risk content: room text, aliases, fallback lines, feature uses, and clock labels.
- Keep builder edits as worldpack patches that can be reviewed and migrated, not silent DB drift.

The first great CosyWorld dev tool is probably not a combat simulator. It is a room/job/clock inspector.

### 7. Clocks Should Become Scheduled Rule Actions

MUDs have heartbeats, timers, resets, respawns, and process hooks. CosyWorld's clocks are conceptually stronger because they already distinguish sanctuary and frontier zones. The next step is to make clock movement executable and auditable.

CosyWorld lesson:

- Scheduled ticks should submit typed actions through the same reducer path as player actions.
- Sanctuary clocks only move from explicit player or builder actions.
- Frontier clocks can move from scheduled actions, but those actions should create journaled events with claim keys and reasons.
- `on_fill` should stay as validated effect descriptors.

This keeps "the world moves" from becoming spooky offscreen mutation.

### 8. Separate Room Memory From Transcript

MUDs, GemRB/Exult-style engine reimplementations, and long-lived MMO servers all distinguish durable world state from output logs. CosyWorld already separates events, memory, and AI context, but AI can tempt the design back toward transcript-as-state.

CosyWorld lesson:

- A room transcript is evidence, not state.
- Room memory should be a compact set of authored or validated facts with source events.
- AI summaries should propose memory facts, but Rust should validate, classify, and commit them.
- The `/state` API should expose room facts and recent events separately.

This will make replay, moderation, and deterministic fallback much easier.

### 9. Use Explicit Quests/Jobs, Not Pure Narrative Promises

Flare quests, CoffeeMud quests, Crossfire triggers, Stendhal tasks, and GoMud quest progress are explicit structures. CosyWorld's Jobs and Fronts are the right abstraction; they should be content-authored and event-backed.

CosyWorld lesson:

- A Job needs explicit participants, locations, progress clock, danger clock, rewards, consequences, and eligible actions.
- AI can write warm connective tissue, but completion must come from rule events.
- Ledger marks should reference job/clock/bond ids, not only generated summaries.
- Jobs should include deterministic fallback text for every phase.

This keeps "helping" mechanically visible in a crowded shared room.

### 10. Make Social State Inspectable

MUDs survive because social affordances are concrete: who is present, who heard what, who belongs where, which faction/clan/group owns what, what commands are available, and what changed. CosyWorld's Bonds, Callings, Covenants, and Visit Ledger are excellent; they need UI/API treatment as first-class state.

CosyWorld lesson:

- Show each player's relevant Calling and one or two active public Bonds in room context.
- Make resident Bond state queryable by `/state`.
- Add event types for bond deepened, bond strained, bond resolved, calling followed, covenant helped.
- Keep the language cozy, but make contribution legible.

This is how CosyWorld avoids becoming "AI chat with vibes" and becomes a place.

### 11. Prefer Modules/Contrib Over One Giant Core

Evennia has contrib systems; Flare splits engine from game; Solarus has an engine plus quest editor; GoMud has modules and sample scripts. CosyWorld should keep Core small while letting expansions and shards add content packs.

CosyWorld lesson:

- Treat CosyWorld Core, Ruby High, Forbidden Mountain, Lonely Forest, and future areas as worldpacks/modules.
- Each module declares ids, dependencies, access gates, cards, room sheets, jobs, and fallback content.
- Official hosted shard trusts official modules; self-hosted shards can load custom modules.
- Keep module manifests readable enough for review.

This matches the product thesis: free core stays complete; official NFTs unlock expansions; self-hosting stays possible.

### 12. Preserve The AI Boundary Ruthlessly

Evennia now has LLM NPC contribs, but the older engines show why rules must not depend on generated prose. Mature systems are stable because content and mechanics are inspectable. CosyWorld's AI boundary is one of its strongest choices.

CosyWorld lesson:

- AI output remains public event narration, resident speech, fallback embellishment, or proposed memory.
- AI never creates authoritative exits, items, rewards, bond resolutions, or room safety changes directly.
- AI-generated content that should become durable must compile into a worldpack patch or validated projection mutation.
- Prompt context should be assembled from authoritative room facts, not from the raw transcript alone.

The right mental model: AI is a performer and assistant builder, not the game master of record.

## Anti-Lessons

- Do not copy classic MUD licensing assumptions. Diku/Circle/ROM/SMAUG descendants are valuable architecture references but can carry non-commercial or attribution constraints.
- Do not copy GPL/CC-BY-SA data or prose into CosyWorld unless the project intentionally accepts those obligations.
- Do not adopt full telnet-era command complexity as the main UX. Use the command architecture, not the player-facing clutter.
- Do not build a general scripting language before typed effect descriptors are exhausted.
- Do not let content packs silently mutate live state without journaled events and migrations.

## Concrete Next Steps

### P0: Content Contract

- Create `v2/content/core/`.
- Move seed actors, locations, items, room features, exits, jobs, clocks, cards, and fallback lines into worldpack files.
- Add a Rust `worldpack check` test/command that validates ids, references, access gates, duplicate aliases, safety zones, and `on_fill` descriptors.
- Record worldpack version/hash in snapshots and journal records.

### P0: Ranked Action Offers

- Expand kernel/Rust action offers beyond bit flags into typed command offers.
- Include risk/effect/cost/claim metadata.
- Keep the browser rendering one primary action.

### P1: Prototype System

- Add `type_id`, `instance_id`, and optional `extends` fields to worldpack objects.
- Support prototype flattening in Rust at boot.
- Keep live state as deltas from type definitions.

### P1: Object Lifecycle Effects

- Define typed lifecycle hooks: look, listen, use, give, enter, leave, tick, clock-fill.
- Restrict hooks to validated effect descriptors.
- Add tests that AI cannot bypass these descriptors.

### P1: Builder Inspector

- Add a read-only admin/dev page for rooms, exits, jobs, clocks, ledger marks, bonds, and recent events.
- Add a diff/export path for content edits before making editing broad.

### P2: Module Packs

- Split Core and expansions into module manifests.
- Add dependency and access-gate declarations.
- Support self-hosted custom packs while keeping official shard trust rules strict.

## Source-Mapped Reference Threads

- Engine/game-data split: `repositories/crpg/flare-engine`, `repositories/crpg/flare-game`, `repositories/crpg/solarus`, `repositories/crpg/rpg-js`.
- Legacy engine/data reimplementation discipline: `repositories/crpg/gemrb`, `repositories/crpg/exult`, `repositories/crpg/opentesarena`.
- Prototype/type systems: `repositories/mud/evennia/evennia/prototypes`, `repositories/mud/fluffos`, `repositories/crpg/crossfire-server/types`.
- Command sets and contextual commands: `repositories/mud/evennia/evennia/commands`, `repositories/mud/kalevala/lib/kalevala/character`, `repositories/mud/gomud/internal/usercommands`.
- Event request/commit pattern: `repositories/mud/kalevala/lib/kalevala/event`.
- Builder/admin tooling: `repositories/mud/gomud/_datafiles/html/admin`, `repositories/mud/coffeemud/guides`, `repositories/mud/evennia/evennia/prototypes/menus.py`.
- Quest/job/task structure: `repositories/crpg/flare-game/mods/*/quests`, `repositories/mud/coffeemud/resources/quests`, `repositories/mud/gomud/internal/quests`.
- Long-lived shared-world persistence: `repositories/crpg/stendhal`, `repositories/mud/ex-venture`, `repositories/mud/gomud`.
