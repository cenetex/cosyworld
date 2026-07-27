# Action Verbs And Economy — Backlog

**Epic**: Make every playable choice concrete, correctly costed, reachable,
and semantically identical across the browser, terminal, API, replay, and
inference-controlled avatars.

**Status**: Groomed, not estimated (2026-07-26). This is follow-on product work
after the implemented `cosyworld.srd5/1` action-card foundation. It does not
authorize or imply full SRD 5.2.1 compatibility.

**Related architecture**:

- [SRD-Backed Action and Collectible System](../systems/04-action-system.md)
- [CosyWorld RPG System Bible](../systems/09-cosyworld-rpg-system.md)
- Generated-place lifecycle contract (dedicated document pending)
- [ADR-001: SRD 5.2.1 Action-Card Profile](../decisions/001-srd-action-card-profile.md)
- [ADR 0002: the action hand is authoritative state](../decisions/0002-action-hand-is-authoritative-state.md)

The current rules substrate is sounder than its vocabulary. Stable rule
bindings, targets, resolvers, traces, and stale-offer rejection exist, but
several player-facing choices still describe lifecycle state or implementation
requirements instead of a thing the avatar can intentionally do. User-observed
copy such as **“anchor a lasting fixture”** belongs to the same family as the
runtime's “install a durable anchor,” “answer the place's current need,” and
“mature this discovered place.” These phrases are mechanically meaningful to
the engine and vague to a player.

This backlog also resolves the action-economy ambiguity around the ordinary
two-card hand, world turns, combat Tempo, progression spends, and actions that
are legal but not currently dealt.

---

## Product Decisions Proposed By This Backlog

Except for item 1, these are recommendations until AVE-0 records the final
decision. #354 and ADR 0002 settle item 1 now:

1. The ordinary two-card hand is a **spotlight over the legal action set**, not
   the sole source of legality. Free deterministic redeal pages every other
   currently legal choice without currency, command knowledge, or draw luck.
   The proposed grouped **More Actions** surface is explicitly closed.
2. Every offer declares its action economy explicitly. Labels and action kinds
   never imply whether something consumes a world turn, Tempo, advancement, or
   an item use.
3. Ordinary state-changing world actions consume one world turn. Read-only
   inspection is free. Personal loadout and progression maintenance is free in
   sanctuary and either unavailable or explicitly Tempo-costed during danger.
4. Combat uses a small two-Tempo economy. Movement and setup may leave one
   Tempo; Attack, Dodge, Ready, Dash, and Flee commit all remaining Tempo.
5. A player-facing title follows **concrete verb + concrete target**. Internal
   lifecycle words such as Anchored, Connected, claim, trace, typed output, or
   resolver never serve as the only explanation.
6. Dash, Disengage, and Hide land only with the movement, engagement,
   visibility, and replay state that makes them real. Adding names to the
   registry or browser is not implementation.

---

## Acceptance Principles

Every ticket in this epic must preserve these constraints:

1. The same canonical action or operation has the same meaning in every
   transport. Friendly pack vocabulary may reskin it without changing the
   target, cost, effect, timing, or resolver.
2. Every state-changing action exposes:
   - a concrete verb;
   - a concrete target or object;
   - structured requirements;
   - world-turn, Tempo, progression, and item-use costs;
   - immediate effect;
   - important follow-on unlock or consequence; and
   - a useful disabled reason when unavailable.
3. A scene card is never an invitation to satisfy hidden validation logic.
   If the engine requires a particular item, recipe, origin, destination,
   second participant, or action class, the player can see that requirement.
4. Informational needs and executable actions are different UI objects. When
   there is no eligible recipe, item, target, or strategy, show a need—not an
   active generic button.
5. AI may decorate an approved noun or sentence shape. It never decides what
   qualifies, what an action costs, or what state transition occurs.
6. The C kernel or a narrowly validated journaled reducer remains
   authoritative. Copy improvements never move resolution into the client.
7. Old action and event meanings remain replay-readable. A changed economy or
   tactical contract receives a new versioned identity.
8. Orbs never buy an ordinary verb, turn, Tempo, success, progression, or
   better outcome.

---

## Current Confusion Inventory

| Current or observed copy | Hidden mechanical meaning | Why it is confusing | Target direction |
| --- | --- | --- | --- |
| Anchor a lasting fixture | Craft a typed durable item at this generated location | No item, recipe, location, cost, or immediate result | **Build a mossglass waymarker at Alder Hollow** |
| Install a durable anchor | Produce `place.anchor.created` and advance Discovered to Anchored | “Anchor” is both a verb and lifecycle noun; “durable” is an invisible predicate | **Install the Mothglass Lantern here** |
| Answer the place's current need | Select any contribution that may qualify for the current maturity stage | It names neither the need nor an executable approach | Stage-specific Build, Deliver, or Welcome action |
| Mature this discovered place | Advance the aggregate place maturity clock | Describes system state rather than player intent | **Make Alder Hollow a safe stopping place** |
| Unanswered local needs | Generated-place danger clock | No threatened fiction or fill consequence | **The path is washing away** plus the consequence |
| Physically deliver the declared needed supplies | Prove actor-causal pickup, continuous carrying, and delivery | “Physically” and “declared” expose validation language; the item and route are absent | **Carry bridge rope from Rain-Soft Garden to Alder Hollow** |
| Build familiarity through distinct visits, contributions, and traces | Meet settlement claim diversity and participant thresholds | “Distinct,” “contribution,” and “trace” are audit vocabulary | **Help more travelers use and care for this place**, with visible progress |
| Contribute / Push / Pitch in / Take point | Advance a project through Study, Utilize, Help, or another strategy | The approach, object, and likely result are hidden | **Repair the bell frame** / **Help Rowan fit the lens** |
| Chat | Spend advancement to create a new Bond | Players expect ordinary conversation, not a progression purchase | **Begin a friendship with Rati** |
| Remember | Resolve an active Bond | It does not disclose that the active Bond ends | **Close this chapter with Rati**, with an explicit consequence |
| Make room for Watch Bell | Spend advancement to unlock a bracelet slot | It may sound like equipping or granting the charm | **Add a bracelet slot for Watch Bell** |
| Prepare | Create a scoped, consumable project setup | It does not name what is prepared or what consumes it | **Lay out the repair tools** / **Brace the lantern frame** |
| Inspect | Study in product copy; Look in the terminal alias table | The same word invokes different domains | Reserve Inspect for analytical Study; use Look for read-only examination |
| Help | SRD Help in product copy; command help in the terminal | The same word is both gameplay and interface | Gameplay keeps Help; terminal documentation becomes Commands or `?` |
| Defend / Dodge | One current combat action under two primary names | Players cannot form a stable combat vocabulary | Dodge is canonical; Defend remains an input-only compatibility alias |

---

## AVE-0 — Establish A Green, Truthful Baseline

**Priority**: P0 (blocks action-economy and vocabulary changes)
**Scope**: Decision records, runtime/docs alignment, action-focused tests
**Depends on**: nothing

### What to do

- Record the current runtime contract before changing it: two ordinary hand
  entries, up to five current combat choices, a complete server-side legal
  offer set, and structured non-browser access.
- Consume ADR 0002's settled spotlight + deterministic redeal model. Do not
  reopen the rejected **More Actions** list or leave “hard two-card gate” and
  “all legal actions remain reachable” simultaneously normative.
- Resolve current three-versus-five combat-hand documentation drift.
- Keep Say and shuffle/redeal as supported turn-exempt inputs, then update tests
  and help copy to match.
- Align package and Rust crate versions.
- Triage the existing Rust failures into:
  - restricted-environment listener tests;
  - obsolete expectations after an accepted product change; and
  - real action, clock, inventory, evolution, or combat regressions.
- Keep unrelated failing infrastructure tests visible, but define a green,
  action-focused gate that this epic cannot regress.

### Acceptance

- The ADRs, RPG Bible, action-system document, browser copy, and runtime agree
  on ordinary and combat hand capacity and browser reachability.
- Tests continue to require supported Say and shuffle/redeal. No test expects a
  retired Defend, Grow, or legacy skill action unless it is explicitly a
  compatibility test.
- `npm run v2:worldpack:inspect` and `npm run v2:kernel` pass.
- The action-offer, Search/Study, Influence, project Help/Prepare/Work, bounded
  Magic, item Utilize, combat action-hand, and golden SRD replay tests pass.
- Restricted listener tests are reported separately from semantic failures;
  they do not conceal a red action baseline.

---

## AVE-1 — Canonicalize The Player Verb Lexicon

**Priority**: P0
**Scope**: Rules registry, operation bindings, pack vocabulary, browser, terminal
**Depends on**: AVE-0

### What to do

- Adopt one canonical player meaning for each core word:
  - Notice → perceptual Search;
  - Inspect → analytical Study;
  - Use → Utilize;
  - Cast → Magic;
  - Help → the Help action;
  - Dodge → the current avoidance action;
  - Prepare → current scoped project setup;
  - Ready → future explicit trigger and response;
  - Flee → current Escape operation;
  - Disengage → future avoidance of engagement consequences;
  - Chat/Befriend → decide whether the player-facing promise is conversation
    or creating a Bond, and name it truthfully.
- Move terminal documentation from `help` to `commands` and/or `?`, leaving
  Help available as a gameplay verb.
- Make Look the read-only examination verb and Inspect the Study-bound action.
- Retain old words as input-only compatibility aliases where replay or muscle
  memory warrants it. Do not render two primary names for one mechanic.
- Generate aliases and help output from the same registry consumed by action
  offers instead of maintaining a parallel semantic switch.
- Require every pack reskin to preserve a visible or inspectable canonical
  action identity.

### Acceptance

- Typing and clicking the same word resolve to the same action domain.
- `inspect <target>` never silently performs free Look while an Inspect card
  resolves Study.
- `help <target/project>` performs gameplay Help; `commands` or `?` opens help.
- New combat offers say Dodge. Historical Defend commands and journals remain
  compatible without rendering Defend as a second action.
- A vocabulary parity test covers browser label, accessible label, terminal
  command, API binding, and inspector identity for every supported action.

---

## AVE-2 — Make Action Economy Explicit In Every Offer

**Priority**: P0
**Scope**: Action-offer schema, submission receipts, turns, inspector, clients
**Depends on**: AVE-0, AVE-1

### What to do

- Replace action-kind inference with an explicit economy block, versioned with
  the offer contract. At minimum it declares:
  - `world_turn`: `consume` or `exempt`;
  - `tempo`: integer combat cost or absent outside combat;
  - `ends_turn`;
  - advancement cost;
  - item instance and use/charge cost; and
  - any other allowed non-Orb resource cost.
- Record the resolved economy in the committed receipt so replay does not
  depend on today's kind table.
- Adopt and test the default taxonomy:

| Activity | Default economy |
| --- | --- |
| Look, UI inspection, inventory, accessibility, report | World-turn exempt |
| Calling/Bond wording, bracelet/loadout maintenance | Exempt in sanctuary; unavailable or explicitly Tempo-costed during danger |
| Travel, Search, Study, Influence, relationship-forming Chat | One world turn |
| Take, Drop, Give, Trade, Steal, Use, Craft | One world turn |
| Prepare, project Work, Help, Rest | One world turn |
| Combat | Explicit Tempo under the active combat protocol |

- Make disabled reasons distinguish “not legal,” “legal but unaffordable,”
  “wrong phase/turn,” and “stale; refresh.”
- Continue to expose `risk` and `effect`; neither substitutes for cost.

### Acceptance

- A reviewer can determine whether an offer consumes time or resources without
  reading its kind or resolver implementation.
- Browser, terminal, API, and inferred submissions commit identical costs.
- A stale or tampered economy block causes no partial mutation.
- Turn-exempt actions cannot accidentally advance clocks, fronts, encounter
  order, resident heartbeats, or world simulation.
- No ordinary action economy field permits an Orb cost.
- Golden replay preserves the economy version and committed turn effect.

---

## AVE-3 — Make The Two-Card Hand And Redeal Complete

**Priority**: P0 product decision resolved by #354; P1 implementation
**Scope**: Browser action surface, action-hand ADR, accessibility, analytics
**Depends on**: AVE-0, AVE-2

### What to do

- Keep two authoritative spotlight actions in ordinary scenes.
- Keep one compact free **redeal** affordance that replaces the visible pair
  with the next pair in the finite server-authored legal-offer order.
- Exclude already shown offers until the current pool is exhausted, allow a
  final one-card page, then cycle back to the authoritative opening pair.
- Keep `hand.shuffled` as the journal record and preserve `shuffle` plus `more`
  as input aliases for the same turn-exempt redeal.
- Do not add the rejected grouped **More Actions** list, a command field, random
  draw, or client-authored reconstruction. “More” means “next two,” not “show
  all.”
- Preserve provider reasoning—Calling, friendship, held item, job, location—
  as “why this is suggested,” not “why all other legal actions disappeared.”
- During the active actor's combat turn, show every legal combat action family
  up to the protocol cap; combat does not use ordinary redeal.
- Instrument spotlight selection, redeal, disabled-action inspection,
  abandonment, and stale refresh without recording private text.

### Acceptance

- Every legal ordinary action appears after a finite number of deterministic
  redeals without luck, currency, or command knowledge.
- The first two cards remain deterministic and retain their provider reasons.
- Redeal cannot create, re-rank, retarget, or enable an offer and consumes no
  world turn.
- Keyboard and screen-reader users can advance the redeal cycle and enumerate
  the complete legal set, including cost, risk, effect, target, and disabled
  reason.
- Two clients with the same authoritative state receive the same spotlight and
  legal set and produce the same redeal order.
- Combat continues to present its complete bounded choice set directly.
- Browser contract tests continue to require the shuffle control, glyph, and
  compact “more” label recorded by ADR 0002.

---

## AVE-4 — Introduce A Concrete Action-Copy Contract

**Priority**: P0
**Scope**: Action envelope, pack schema, authoring guide, browser and terminal
**Depends on**: AVE-1, AVE-2

### What to do

- Give every action offer structured presentation fields rather than one
  overloaded label:
  - canonical verb;
  - concrete title;
  - target;
  - requirements;
  - cost summary;
  - immediate effect preview;
  - important unlock/consequence preview; and
  - disabled reason/remedy.
- Require the title to follow **concrete verb + concrete object/target** unless
  the verb is self-contained and universally understood, such as Rest or
  Dodge.
- Prefer names already grounded in world state:
  “Use Dawn Oil on the Beacon,” not “Answer the need.”
- Keep rule binding, lifecycle stage, claim keys, resolver, and exact
  provenance in the inspector. They may supplement but never replace the
  player explanation.
- Separate a non-executable need panel from an executable action card. A place
  may say “A permanent landmark is still needed” before the player possesses a
  qualifying recipe or item.
- Require pack reskins and contextual offers to satisfy the same clarity
  fields as Core.

### Acceptance

- For every card, a player can answer: what will I do, to what, what do I need,
  what will it cost, and what changes next?
- No active state-changing card is titled only Work, Contribute, Push, Current
  Need, Mature, Anchor, or another lifecycle/umbrella term.
- If a required item or target is unavailable, the UI names it and does not
  present a generic action that is guaranteed to fail.
- Browser confirmation and terminal preview use the same structured copy.
- Copy changes cannot modify mechanics, and mechanical changes cannot ship
  without refreshed effect/cost previews.

### Reference presentation

```text
Build a mossglass waymarker
At Alder Hollow · Stone + Moonwool Thread · 1 turn · Safe
Creates a permanent landmark here.
Afterward, travelers can begin supply deliveries.

Inspector: Craft → place.anchor.created → Discovered to Anchored
```

---

## AVE-5 — Replace Generated-Place Lifecycle Jargon With Stage-Specific Play

**Priority**: P0 (current generated-place loop is mechanically legible but
player-copy opaque)
**Scope**: Generated-place jobs, biome templates, requirements, clocks, UI
**Depends on**: AVE-4 and the generated-place lifecycle contract

### What to do

- Preserve the authoritative lifecycle:
  `Unfound → Discovered → Anchored → Connected → Settled`.
- Replace its generic job premise and action copy with deterministic,
  stage-specific needs:

| Stage | Need panel | Executable offer examples |
| --- | --- | --- |
| Unfound | The route has not been explored | **Scout toward Alder Hollow** |
| Discovered | This place needs a permanent landmark | **Build a mossglass waymarker here** / **Install the Mothglass Lantern here** |
| Anchored | The landmark is ready, but supplies have not arrived | **Carry bridge rope from Rain-Soft Garden to Alder Hollow** |
| Connected | People can reach this place; it needs shared use and care | **Welcome Rowan to Alder Hollow** / **Repair the waymarker** / **Leave a trail account** |
| Settled | Alder Hollow is now a safe stopping place | No maturity action; show completion and resulting sanctuary |

- Author a closed, validated vocabulary of possible landmark/fixture nouns by
  biome and qualifying recipe: waymarker, lantern post, shelter frame, bridge
  marker, garden bed, bell frame, or another pack-authored noun.
- Never ask AI to decide whether an object qualifies. Decorative generation
  may name an already selected noun within content hygiene rules.
- Expose the exact item, recipe, origin, destination, and delivery method
  needed for the current stage.
- Translate settlement evidence into visible human progress without exposing
  claim-key jargon:

```text
Landmark built                 ✓
Supplies delivered             ✓
Travelers who helped           1 of 2
Different helpful acts         3 of 5
```

- Give every generated danger clock concrete authored stakes and a visible
  fill consequence. Replace “Unanswered local needs” with a biome- and
  stage-appropriate threat such as “The path is washing away.”
- Rewrite job reward and consequence copy as observable world outcomes, not
  “advances one represented maturity stage.”

### Acceptance

- The phrases “anchor a lasting fixture,” “typed durable anchor,” “answer the
  current need,” “declared needed supplies,” and “distinct contributions and
  traces” do not appear as primary player instructions.
- A qualifying craft offer names the actual output and location before
  confirmation.
- A delivery offer names the item, origin, destination, and accepted completion
  interaction.
- Players can see settlement participation/diversity progress without seeing
  claim keys, event IDs, controller kinds, or anti-farming internals.
- Repeated generic Work still cannot skip any stage.
- Generated names or unavailable AI never change requirements, lifecycle
  outcome, or deterministic fallback copy.

---

## AVE-6 — Replace Generic Project Buttons With Concrete Approaches

**Priority**: P1
**Scope**: Jobs, project offer composition, Study/Utilize/Help/Prepare bindings
**Depends on**: AVE-1, AVE-4

### What to do

- Treat Contribute as an internal grouping/result, not the default action title.
- Let each active job publish one or more concrete strategies:
  - Study to understand or plan;
  - Utilize to act with a named tool or feature;
  - Help a named actor performing a named task;
  - Prepare a named setup with duration and consumption rules;
  - Give or deliver a named physical item;
  - Attack, Dodge, Influence, or another action only when authored stakes make
    that approach meaningful.
- Replace Work/Push labels with the strategy's concrete fiction.
- Show differing risk, effect, requirements, and consequences between
  strategies before selection.
- Record both the stable action and project contribution in the receipt so the
  same outcome cannot be farmed through vocabulary changes.

### Acceptance

- The Moonlit job and every generated-place stage expose at least two
  mechanically distinct concrete approaches when the state actually supports
  them.
- A Help offer names both the recipient and task.
- A Utilize offer names its item/feature and cannot execute after that source
  is transferred or exhausted.
- A Prepare offer names what is set up, what consumes it, and when it expires.
- No project relies on generic Work as an undocumented resolver.

---

## AVE-7 — Version A Two-Tempo Tactical Economy

**Priority**: P1
**Scope**: `cosyworld.combat/6`, positions, combat offers, AI policy, replay
**Depends on**: AVE-2, AVE-3, AVE-6

### What to do

- Keep existing combat protocols replay-readable; introduce a new protocol for
  the economy change.
- Give the active participant two Tempo at turn start.
- Start with this bounded cost table:

| Action family | Proposed cost |
| --- | --- |
| Step between authored positions | 1 Tempo |
| Use, Help, Hide, Disengage | 1 Tempo |
| Attack | Commit all remaining Tempo |
| Dodge | Commit all remaining Tempo |
| Ready | Commit all remaining Tempo |
| Dash | Commit remaining Tempo for additional legal movement |
| Flee | Commit remaining Tempo and exit when legal |

- Model three to five authored positions and validated relations—adjacency,
  cover, sight, hazard, and exit—without grids or client geometry.
- Recompose the complete combat hand after a non-ending first action.
- Prevent repeated Attack and accidental free movement by making end-turn
  behavior explicit in the economy block.
- Give inference-controlled avatars the identical legal set, costs, previews,
  and deterministic selection trace.

### Acceptance

- Move-then-act is possible; attack-twice is not.
- The client cannot invent positions, movement allowance, cover, Tempo, or
  end-turn behavior.
- Every legal combat family is visible without ordinary-scene redeal.
- Hit, harm, finish, objective effect, and movement previews match the actual
  resolver.
- Snapshot, reconnect, stale submission, and legacy replay tests cover both
  Tempo and position state.

---

## AVE-8 — Implement Dash, Disengage, And Hide As Real Actions

**Priority**: P1 after the tactical foundation; otherwise unsupported
**Scope**: Rules profile successor, combat/movement/visibility state, tests
**Depends on**: AVE-7

### What to do

- Introduce a versioned successor profile or explicit compatible extension;
  do not silently change `cosyworld.srd5/1`.
- Implement Dash only when additional movement has a defined value and legal
  path.
- Implement engagement and its ordinary movement consequences before
  Disengage. Keep Flee/Escape a distinct operation.
- Implement Hide only with:
  - scene-provided concealment eligibility;
  - authoritative hidden/concealed state;
  - detection and reveal rules;
  - targeting consequences;
  - Search interaction;
  - duration and invalidation triggers; and
  - replay/snapshot identity.
- Keep each action absent when its preconditions or meaningful effect do not
  exist.

### Acceptance

- Dash, Disengage, and Hide each have a resolver, legal targets, safe/risky
  behavior, event outputs, stale rejection, and replay fixture.
- Travel is never mislabeled Dash, and Flee is never mislabeled Disengage.
- Hide cannot be activated in an exposed scene or retained after an
  invalidating action.
- Search and visibility tests prove who can target or reveal a hidden actor.
- The profile conformance report moves an action from unsupported only after
  its full deterministic contract passes.

---

## AVE-9 — Broaden Ready And Magic Only Through Authored Content

**Priority**: P2
**Scope**: Trigger contracts, bounded spell effects, pack authoring
**Depends on**: AVE-2, AVE-4; Ready also depends on AVE-7

### What to do

- Continue calling the current one-use project setup Prepare.
- Add Ready only when an offer names:
  - a perceivable trigger;
  - one bounded response;
  - duration;
  - reserved/committed Tempo;
  - invalidation conditions; and
  - deterministic trigger ordering without reaction chains.
- Broaden Magic by adding complete effect descriptors and authored cards, not
  by enabling prose or importing a spell list wholesale.
- Every spell declares target, range/position predicate, uses/exhaustion,
  duration, stacking, recovery, effect budget, and replay behavior.

### Acceptance

- Prepare and Ready never appear as interchangeable primary labels.
- A Ready card can be understood without consulting prose or guessing its
  trigger.
- An unsupported or unprepared spell produces no executable Magic offer.
- Adding one spell cannot change ordinary action access or bypass the free/core
  power ceiling.
- Triggered responses and spell effects are deterministic, journaled, and
  snapshot-safe.

---

## AVE-10 — Add Action-Clarity Gates And Comprehension Evidence

**Priority**: P1, introduced with AVE-1 and expanded as tickets land
**Scope**: Compiler/checker, browser smoke, terminal parity, playtest script
**Depends on**: AVE-1 through AVE-6 for the first complete gate

### What to do

- Add a worldpack/action-copy checker that flags high-risk abstract primary
  labels such as:
  - current need;
  - mature;
  - typed;
  - declared;
  - trace;
  - contribute;
  - lasting fixture; and
  - bare Work, Push, Prepare, or Anchor without a concrete target.
- Use an allowlist with reviewed rationale rather than banning ordinary words
  globally; “anchor” may remain a lore noun or inspector term.
- Validate that every state-changing offer has structured target,
  requirements, cost, effect preview, and remedy when disabled.
- Add cross-surface golden fixtures for representative Search, Study,
  Influence, Magic, Prepare, Help, Utilize, inventory, progression,
  generated-place, and combat offers.
- Run a short comprehension study using five questions:
  1. What will your avatar do?
  2. What or whom will they act on?
  3. What do you need and what will it cost?
  4. What changes immediately?
  5. What becomes possible or risky afterward?
- Track repeated confirmation cancellation, disabled-action selection, stale
  refresh, and redeal use as usability signals, not success metrics by
  themselves.

### Acceptance

- Core and mounted expansion packs pass the action-copy checker.
- Browser and terminal previews answer all five comprehension questions from
  the same server fields.
- Tests fail when concrete nouns are replaced with generic lifecycle copy.
- At least one generated-place playthrough reaches Settled without the tester
  asking what “anchor,” “current need,” “declared supplies,” or “trace” means.
- Accessibility review confirms that screen-reader labels contain verb,
  target, cost, and important consequence without reading inspector jargon.

---

## Dependency Order

```text
AVE-0 truthful baseline
  ├── AVE-1 canonical vocabulary
  │     ├── AVE-4 concrete copy contract
  │     │     ├── AVE-5 generated-place copy and offers
  │     │     └── AVE-6 concrete project approaches
  │     └── AVE-2 explicit action economy
  │             └── AVE-3 spotlight + deterministic redeal reachability
  │                     └── AVE-7 combat/6 two-Tempo economy
  │                             └── AVE-8 Dash, Disengage, Hide
  └── AVE-10 clarity gates grow alongside AVE-1 through AVE-6

AVE-9 Ready/Magic breadth depends on AVE-2 and AVE-4;
Ready additionally depends on AVE-7.
```

AVE-1, AVE-2, and the schema portion of AVE-4 may proceed together after
AVE-0. AVE-5 should land before scaling generated pathways because every new
generated place otherwise multiplies opaque copy. AVE-7 and AVE-8 are a
separate versioned tactical slice and must not block ordinary-scene clarity.

---

## Out Of Scope

- Full Dungeons & Dragons or full SRD 5.2.1 compatibility.
- Importing complete class, spell, monster, equipment, rest, or death systems.
- Randomly drawn ordinary-action legality.
- Client-authored actions, costs, targets, or effects.
- AI-generated mechanics or AI deciding whether an item satisfies a lifecycle
  requirement.
- Grid pathfinding, measured range, facing, ammunition simulation, reaction
  chains, or a large tactical hotbar.
- Rewriting internal lifecycle, claim, provenance, or replay vocabulary when
  it is already correct and confined to developer/inspector surfaces.
