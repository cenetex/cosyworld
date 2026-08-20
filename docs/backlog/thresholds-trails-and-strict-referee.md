# Thresholds, trails, and the strict referee

**Epic**: [#586](https://github.com/cenetex/cosyworld/issues/586)

**Status**: Product contract accepted in
[ADR 0005](../decisions/0005-thresholds-trails-and-strict-referee.md).
Discovery authority v1 is specified by
[`discovery-authority-v1.schema.json`](../../v2/schemas/discovery-authority-v1.schema.json);
the shared Lead/Gate/Hazard/Pressure contract is specified by
[`threshold-descriptors-v1.schema.json`](../../v2/schemas/threshold-descriptors-v1.schema.json).
Player procedures and runtime enforcement remain dependency-ordered below, and
the unshipped slices carry their scope and acceptance in
[Open slice detail](#open-slice-detail).

## Shared model

Doors, containers, seals, traps, hidden passages, frontier tracks, and
chase-like scenes compose five small components:

| Component | Question |
| --- | --- |
| Discovery Slot | What bounded hidden truth may exist here, and what fixed result or table stocks it once? |
| Lead | What exact truth may this actor, expedition, or the world pursue? |
| Gate | What method permits this target to open, yield, or be crossed? |
| Hazard | What is telegraphed, what triggers it, and what follows? |
| Pressure | What makes relevant committed delay or repeated work consequential? |

Topology, legibility, access, and safety remain separate. AI receives only
certified visible facts and committed outcomes; it cannot choose truth,
methods, table rows, consequences, access, topology, or rewards.

## Player procedures

- **Scene notice** is free obvious sensory truth.
- **Notice** spends one turn on one unresolved broad sensory result.
- **Search** exhaustively examines one named local physical target.
- **Study** interprets an already perceived target.
- **Scout** pursues one exact geographic Lead from an Anchor or active foray
  and reveals the authorized next segment or target without moving.
- **Travel** performs movement through a revealed, accessible route.
- **Mark** creates a temporary expedition return cue.
- **Open** resolves one certified Gate method.
- **Take** transfers one revealed, accessible item after custody and capacity
  checks.

Reveal never implies Open, Take, or Travel.

## Product invariants

- No danger, no success roll.
- Telegraph every Hazard before dangerous commitment.
- No committed unchanged “nothing found” result.
- Stock hidden truth once; never reroll it through retry, reconnect, or model
  failure.
- Required discoveries have a finite Sign budget or deterministic fallback.
- Required progression preserves retreat, camp, aid, rescue, alternate-route,
  or recovery reachability.
- A cairn stabilizes a traversed return leg and may authorize later branching;
  it does not reveal forward topology, settle a place, provide shelter, grant a
  rest grade, or create sanctuary.
- Navigation stability, route familiarity, place settlement, shelter, and rest
  grade are independent state.

## Delivery order

| Order | Issue | Outcome |
| --- | --- | --- |
| 1 | [#587](https://github.com/cenetex/cosyworld/issues/587) | Product, vocabulary, compatibility, and migration law. |
| 2 | [#600](https://github.com/cenetex/cosyworld/issues/600) | Discovery Slot and deterministic stocking receipt. |
| 3 | [#588](https://github.com/cenetex/cosyworld/issues/588) | Lead, Gate, Hazard, Pressure, and Anchor descriptors. Shipped in 0.0.282. |
| 4 | [#589](https://github.com/cenetex/cosyworld/issues/589) | Kernel-owned conditional transitions. |
| 5 | [#590](https://github.com/cenetex/cosyworld/issues/590) | Custody, recovery, and route reachability proof. |
| 6 | [#591](https://github.com/cenetex/cosyworld/issues/591) | Concrete methods and consequence-first offers. Shipped in 0.0.287. |
| 7 | [#592](https://github.com/cenetex/cosyworld/issues/592) | Telegraphed method-aware Hazards. Shipped in 0.0.288. |
| 8 | [#601](https://github.com/cenetex/cosyworld/issues/601) | One discovery pipeline across Notice, Search, Study, and Scout. |
| 9 | [#593](https://github.com/cenetex/cosyworld/issues/593) | Bounded Pressure scenes and event rolls. |
| 10 | [#602](https://github.com/cenetex/cosyworld/issues/602) | Bounded item and location materialization. |
| 11 | [#594](https://github.com/cenetex/cosyworld/issues/594) | Perishable frontier Leads and forays. |
| 12 | [#595](https://github.com/cenetex/cosyworld/issues/595) | Fail-closed referee presentation packet. |
| 13 | [#596](https://github.com/cenetex/cosyworld/issues/596) | Worldpack validation and developer inspection. |
| 14 | [#597](https://github.com/cenetex/cosyworld/issues/597) | End-to-end door, chest/item, and marked-trail proof. |

Rest/fatigue numbers remain outside this epic. [#603](https://github.com/cenetex/cosyworld/issues/603)
must decide them before [#604](https://github.com/cenetex/cosyworld/issues/604)
implements them. Threshold and Scout work consumes that decision and may not
invent a parallel fatigue system.

## Compatibility gate

Current Scout is `scout_v1`: the journal stores legacy Search plus an
`explore_path` projection mutation that reveals one edge without movement.
Existing hidden-exit chance, route discovery/unlock, local Lead, loot, clock,
rest, cairn, and Scout records retain their exact historical meaning.

New work uses append-only procedure and descriptor versions. A migration may
project old state into the new inspector, but must not reroll hidden truth,
re-award a claim, add a consequence, change topology, or newly authorize
access. The complete field-by-field inventory is normative in ADR 0005.

## Open slice detail

The delivery table above is the index; ADR 0005 is the normative contract.
The sections below carry the per-slice scope and acceptance for the slices
that have not shipped, folded in from their issues on 2026-07-30 so the
criteria survive outside the issue tracker. THR-7G, THR-7C, THR-7S, and
THR-7L are proposed extensions with no filed issue.

---

## THR-6 — Add Bounded Pressure Scenes For Layered Obstacles

**Priority**: P1 / later / blocked

**Scope**: Persistent scene state, progress/danger clocks, concurrency

**Depends on**: THR-2, THR-4, THR-D0

### What to do

- Add a bounded Pressure scene that can represent:
  - a pursuer closing during a chase;
  - a patrol arriving while a lock is opened;
  - weather erasing a track;
  - rising water, spreading fire, or a collapsing passage.
- Reuse authoritative progress and danger clocks. Name clocks for the obstacle
  or impending truth, not for one prescribed method.
- Keep simple obstacles outside Pressure. Authoring a scene requires at least
  two meaningful beats, strategies with different tradeoffs, and a terminal
  consequence.
- Define participants, controller eligibility, target conflicts, turn order,
  joining/leaving, and stale-offer behavior under the scene concurrency policy.
- Give each strategy explicit position/risk, effect, cost, and clock movement.
  `Hurry`, `Proceed carefully`, `Investigate`, `Help`, `Mark the way`, and
  `Withdraw` are pack vocabulary over certified operations, not free-form AI
  choices.
- Separate soft and hard consequences. A soft consequence exposes an
  approaching threat or cost and creates a response window. A hard consequence
  applies only when committed resolution, an ignored warning, or a filled
  danger clock authorizes it.
- Define terminal results for progress first, danger first, simultaneous fill,
  voluntary withdrawal, loss of all participants, and snapshot recovery.
- Advance scenes only through relevant committed turns; never through wall
  time or unrelated room actions.
- On an authored trigger, select a versioned contextual event row. The common
  OSR-shaped categories are `Encounter`, `Sign`, `Environment`, `Loss`,
  `Exhaustion`, and `Discovery`; worldpacks may weight or replace them within
  the closed result vocabulary.
- Event rolls happen after committed time/noise, entering a new zone, hurrying,
  unsafe rest, or another authored trigger. They are not stocking rolls and
  cannot mint unauthorized topology, loot, or actors.
- If a `Sign` or `Discovery` row advances hidden truth, it must name an
  existing compatible Discovery Slot or a bounded typed follow-up table.
- Record table/version/inputs/seed/row and effects for replay. An authored
  quiet interval is a real safe interval or opportunity, never a null result.

### Acceptance

- One scene schema expresses a chase, patrol-vs-lock, and fading-track example.
- Every strategy changes progress, danger, information, position, resources,
  or scene status.
- The same scene never both completes and silently discards its filled danger
  consequence; simultaneous fill has an authored result.
- Co-present actors cannot double-apply one scene beat through concurrent
  submissions.
- Leaving, reconnecting, restoring a snapshot, or handing control between
  direct input and inference does not lose or duplicate scene state.
- Sanctuary and unrelated players cannot advance a frontier Pressure scene.

---

## THR-D2 — Materialize Bounded Item And Location Discoveries

**Scope**: Worldpack stocking tables and bounded runtime materialization

**Depends on**: THR-3, THR-D0, THR-D1

### Status: item materialization shipped; locations and authored sources have not

The discovery procedure previously committed a frozen receipt and then
recorded `"materialization": "not_performed"` alongside `movement`, `custody`,
and `reward`. A resolved `item` slot now places its selected item through the
same fail-closed `EffectDescriptor::RevealItem` seam authored clock effects
use, so the kernel remains the only authority on whether the item may appear,
and the committed event reports what actually happened — `revealed`,
`rejected`, `unresolved_result`, or `unsupported_target_kind` — instead of a
constant.

Because that changes what a committed row means, the procedure version is
append-only: `discovery-procedure-v2` rows keep their receipt-only meaning on
replay forever and `discovery-procedure-v3` rows materialize. Both versions
must stay accepted by `discovery_record_preconditions_hold`, because replay
fails the entire boot on one rejected record.

Still open, in dependency order:

- **Authored sources.** No pack ships `x-cosyworld-discovery-slots` yet, so the
  procedure still only runs against fixtures. This is now the binding
  constraint on everything below.
- **Location and route materialization.** `location`, `route`, `feature`, and
  `resource` slots keep their frozen receipts and report
  `unsupported_target_kind`. The bounded hidden graph, incremental reveal, and
  `authorized_topology_ids` enforcement are untouched.
- **Movement, custody, and reward** remain `not_performed` by design; Open,
  Take, and Travel stay separate operations after Reveal.

### What to do

- Author discovery sources for containers, room features, wilderness
  discoveries, hidden caches, resolved encounters, resource sites, and Hazard
  aftermaths.
- A location Slot declares its parent route/region, allowed point-of-interest
  kinds, maximum topology and directionality, biome/terrain, danger band,
  entrance/return rules, required/optional status, Sign budget, and referenced
  encounter/loot tables.
- An item Slot declares quantity, placement/reveal policy, tell, uniqueness,
  fallback, capacity implications, claim state, and provenance.
- Freeze the selection before materialization; the result may remain hidden
  until the discovery procedure reveals it.
- Instantiate a bounded dungeon's hidden graph once and reveal it
  incrementally. Event rows may choose a compatible typed follow-up but may
  not exceed the Slot.
- Keep Open/Take/Travel as separate access and movement operations after
  Reveal.

### Acceptance

- One hidden item and one ruin share receipt, claim, reveal, and replay code.
- The table cannot exceed an authored quantity or topology bound.
- Required content has a finite completion proof; optional content may be
  explicitly missable.
- Core and Project 89 provide mechanically identical examples with distinct
  presentation vocabulary.
- AI may name and describe the selected result but cannot choose or materialize
  it.

---

## THR-7 — Make Frontier Scouting Pursue Perishable Leads

**Priority**: P1 / later / blocked (distinctive exploration payoff)

**Scope**: Scout/Travel contract, route legibility, connection capacity,
cairns, and lost-track recovery

**Depends on**: THR-1 through THR-3, THR-D0 through THR-D1

**First proof**: the frozen Bethlehem–Jerusalem pathway with one substantial
midpoint location

### What to do

- Freeze the full bounded route and all destination identities once. Generated
  pathway allocation remains the live authoritative procedure; replay stores
  its inputs, seed, topology, identity allocations, and content version.
- Replace new-content Scout's current “reveal without moving” meaning with
  pursuit of one exact geographically valid Lead:
  - while the Lead is legible, Scout is offered once and cannot be farmed;
  - completing it enters the already allocated destination;
  - a lost Lead may be reacquired by Scouting toward that same destination;
  - reacquisition never chooses a different waypoint or rerolls its content.
- Keep historical Scout events replay-readable under their legacy meaning.
- Make Travel movement over a durable known accessible connection. Moving over
  a perishable trail, including returning from a newly scouted place, remains
  Scout toward a known place and may expose a named lost-track consequence.
- Give every substantial connectable location a bounded
  `connection_capacity` and count unique neighbors rather than reciprocal exit
  records:
  - **Scouted — 1**: the perishable return Lead occupies the only slot;
  - **Cairn / Signal Anchor — 2**: the return becomes durable and a forward
    or branch slot becomes available;
  - **Established fire ring / field station — 3**: a third connection becomes
    available;
  - later settlement tiers may grant more only through authored data.
- Reserve capacity at both endpoints before exposing a Lead. A failed
  reservation creates no half-edge, dangling return, or duplicate exit.
- Treat a capacity tier as location development, not a number derived from
  how many directed exit rows happen to exist. Tiers upgrade monotonically;
  constructing a fire ring cannot skip the cairn/Anchor tier.
- Let `Build a cairn` install a fixture in the already scouted location,
  promote only the traversed return connection to durable Travel, and grant
  the second connection slot. Do not create a second “cairn location.”
- Once marked, present the same stable waypoint as an authored ordinary
  location. A pack may name it “Bethlehem–Jerusalem Trail Cairn,” but its
  identity does not change when its art, name, description, or fixture state
  arrives.
- Define bounded lost-track outcomes such as delay plus Fatigue, retreat to
  the departure Anchor, resource loss, or displacement to an authored adjacent
  node. Loss always changes state and never creates arbitrary topology.
- Keep route familiarity and place settlement as separate later cooperative
  progress. Capacity and a cairn do not make a place familiar, settled,
  sheltered, or sanctuary.
- Give first entry, loss, reacquisition, cairn construction, and durable
  traversal semantic Journal beats.

### Acceptance

- A traveler Scouts once from Bethlehem toward a frozen midpoint and enters
  it. Repeating Scout cannot produce another midpoint.
- Before construction, the midpoint has one occupied connection slot and its
  return is a fallible Scout toward Bethlehem, not ordinary Travel.
- Building its cairn consumes no new topology, makes the Bethlehem return
  durable, and grants exactly one free slot for the next Lead.
- After the Jerusalem Lead is discovered, the cairned midpoint has exactly two
  unique neighbors; each reciprocal exit pair counts once.
- A scouted one-slot location cannot accept another Lead. Rejection is
  mutation-free and explains which endpoint lacks capacity.
- A lost Lead leaves canonical topology, route ownership, waypoint identity,
  generated media identity, and allocation receipt unchanged.
- Reacquisition targets the same place, and a mapped route uses ordinary
  Travel without replaying discovery.
- A cairn never reveals the route ahead, settles the location, supplies
  shelter, lights a fire, or changes sanctuary state.
- Holy Land cairn and Project 89 Signal Anchor vocabulary preserve the same
  capacity, target, construction cost, effects, and persistence.
- Direct input, inference, reconnect, snapshot restore, and replay expose the
  same capacity and route state.

---

## THR-7G — Make Place Knowledge Travel As Gossip

**Priority**: P1 / later / proposed

**Scope**: actor-scoped place knowledge, truthful rumors, Sign discovery, and
conversation transfer

**Depends on**: THR-7; integrates with the shared conversation and Journal
contracts

### What to do

- Represent canonical place existence, actor knowledge of the place, and route
  knowledge as separate facts.
- Record actor-scoped knowledge at least as:
  - target place identity;
  - `signed`, `rumored`, or `visited` state;
  - source event and, when applicable, the actor who told it;
  - a source Anchor, region, direction, or other authored geographic context;
  - confidence/provenance for presentation, not for rerolling truth.
- On first entry, grant `visited` knowledge to participating witnesses.
  Building a cairn changes route state; it does not broadcast omniscience.
- Let authored dialogue and explicit actions such as `Ask`, `Tell`, or
  `Share directions` transfer eligible knowledge. Do not infer that every
  co-present avatar automatically exchanges every known location.
- Offer Scout toward a rumored place only where the rumor's geographic context
  and an available connection slot make it actionable.
- Let broad frontier investigation find a truthful bounded Sign selected from
  already allocated compatible destinations. The random result is which Sign
  becomes available, never whether the destination is recreated.
- Give required destinations a deterministic or finite-budget Sign path.
  Optional rumors may remain missable.
- Start with truthful but incomplete rumors. False destinations, deliberate
  lies, confidence decay, and contested testimony are later social-system
  work, not part of the first gossip slice.

### Acceptance

- Two avatars in the same world may legitimately have different maps and
  Scout offers without disagreeing about canonical topology.
- Visiting a hidden cottage teaches its identity to the visitor but does not
  reveal it globally.
- Telling another avatar about the cottage creates a replayable rumor with
  provenance; the listener still needs a geographically valid Lead.
- Hearing of Jerusalem in one region does not permit Scouting toward it from
  every wilderness location.
- Repeated frontier investigation cannot mint a second cottage or replace its
  frozen route.
- AI may phrase a rumor but cannot select its target, origin context, truth
  status, or recipients.

---

## THR-7C — Let Cairns Fall, Be Rebuilt, And Be Rumoured

**Priority**: P2 / later / proposed

**Scope**: cairn condition state, rebuild contribution, belief publication

**Depends on**: THR-7, THR-7G; place-establishment method resolution
([#471](https://github.com/cenetex/cosyworld/issues/471))

Folded from [#472](https://github.com/cenetex/cosyworld/issues/472) and
[#473](https://github.com/cenetex/cosyworld/issues/473), 2026-07-30.

### Maintenance, not monument

A cairn can fall and be rebuilt without the place it anchors ever becoming less
real. That is the difference between a monument system and a maintenance
system, and it should be chosen deliberately. **The proposal is maintenance:**
stones scatter, the road stops being guided, and someone who comes later can
set them back up.

**The invariant this must not break.** Anchoring is a ratchet. A fallen cairn
changes what the place *communicates*, never whether it *exists*.

- The place stays anchored. Its location, exits, clocks, and jobs are
  untouched.
- Forgetting cannot close or recreate a route; Anchored is a derived view over
  durable facts, not an independently mutable stage.
- No cairn state may delete a location, exit, or route. Location deletion is
  the one direction that breaks journal replay, and nothing here should reach
  it.

**Cause, not timer.** A cairn falls because of represented play, never because
a background tick elapsed.

- Falling is driven by a relevant danger clock filling — for example The Road
  Goes Fully Dark taking the Mothwood road — not by a decay interval.
- Sanctuary cairns never fall. Sanctuary cannot receive offscreen danger or
  irreversible loss from background simulation.
- The fall is journaled as a world event naming the clock that caused it, so a
  returning player can read why.

**Rebuilding.**

- Rebuilding is a normal contribution action available to any actor, not only
  the original builder.
- The rebuilt cairn retains the original builder's provenance and reason and
  adds the rebuilder's. **A cairn accumulates its keepers rather than
  overwriting them.**
- Rebuilding is claim-keyed so a repeated submission cannot double-credit.

### Rumoured and rediscovered

A cairn can be rumoured, half-remembered, and gone looking for — without the
world ever forgetting that it is there. This costs almost nothing new: the
separation already exists and is already tested by
`discovered_routes_survive_memory_decay_for_later_actors_and_replay`
(`topology.rs:2017`), which establishes that world facts are durable while
beliefs decay. Cairns publish into that same belief substrate rather than
inventing a second forgetting rule.

`BELIEF_TUNING` already distinguishes firsthand from secondhand and has an
action floor:

| Belief | Behaviour |
| --- | --- |
| "I raised this cairn" / "I stood at it" | firsthand confidence and salience; durable |
| "Someone said there is a cairn past the barrow" | gossip decay rates; can fall below `minimum_action_confidence` |

Belief storage is `capacity` bounded, so cairn beliefs are evictable like any
other. The result is a rumoured cairn: residents stop acting on it, a player
hears it mentioned without knowing where, and going to look becomes a real
errand. The cairn itself never moves and is never destroyed.

**What must not happen.** Belief decay must never affect whether the cairn, its
place, or its routes exist — knowledge is never topology authority. A decayed
belief must not re-close a discovered route or re-hide a discovered exit.
Replay must reproduce identical beliefs and identical world facts,
independently.

Publish cairn existence and provenance on the same path as other firsthand and
secondhand knowledge, and use the unified belief storage rather than a parallel
cairn-belief store.

### Acceptance

- A cairn has a legible standing/fallen condition in the room projection.
- Only a named clock outcome can fell a cairn; no elapsed-time path exists.
- A cairn in a sanctuary zone cannot fall.
- Felling a cairn leaves the place anchored, and its location, exits, routes,
  clocks, and jobs unchanged.
- Rebuilding preserves original provenance and appends the rebuilder, and is
  idempotent under a claim key.
- Replay of a fall-and-rebuild sequence reproduces identical state and
  identical accumulated provenance.
- Raising or visiting a cairn records a firsthand belief; hearing of one
  records a secondhand belief with gossip decay.
- A fully decayed or evicted cairn belief leaves the cairn, its place, and its
  routes unchanged.
- A rediscovered cairn restores firsthand confidence without creating a
  duplicate world fact.
- Residents do not assert a cairn below `minimum_action_confidence`.

---

## THR-7S — Make Field Supplies And Infrastructure Physical

**Priority**: P1 / later / proposed

**Scope**: wilderness gathering, carried expedition capabilities, installed
route/camp fixtures, and construction authority

**Depends on**: THR-7, RT-2; coordinates with crafting and natural affordances

### What to do

- Add a small physical expedition capability vocabulary before adding
  continuous survival meters:
  - **Waymark** — material and tools for route infrastructure;
  - **Shelter** — equipment that can satisfy the existing Camp gear gate;
  - **Light** — carried charges/fuel for authored dark beats;
  - **Water** — carried charges for authored dry/deep beats.
- Use existing item weight, size, charge, container, and zone rules so carrying
  stone, water, fuel, or loot creates an understandable choice.
- Let free Scene Notice expose obvious material facts. Focused Notice or Search
  resolves a bounded gathering opportunity such as loose cairn stone, dry
  sticks, clean water, or usable salvage.
- Make gathering eligibility biome- and feature-authored. Not every biome
  supplies stone, fuel, clean water, or suitable marker material.
- Materialize a finite physical bundle or resource-site charge. After
  construction exhausts the opportunity, stop offering Gather; do not erase
  the location's geology or imply all stones vanished.
- Unify generated-place `Work` and physical crafting behind one authoritative
  construction receipt. Building a cairn cannot be both free progress and an
  item-consuming recipe.
- Treat the established fire ring as the persistent capacity-three fixture.
  Lighting it is a separate action that consumes compatible fuel and creates
  transient light/warmth/pressure state.
- Keep the rest contract compositional: a prepared site or cairn may be
  required for frontier Camp, but the site still needs equipped Shelter, and a
  fire ring still needs fuel where authored. Sanctuary and lodging retain
  their existing rest rights.
- Consume Light and Water only on declared exploration beats such as entering
  a dark zone, completing a watch, or crossing a dry depth. Never drain them
  by wall time.

### Acceptance

- A stony wilderness location can reveal and yield a heavy cairn-stone bundle;
  an incompatible biome cannot.
- Installing the bundle creates one persistent cairn fixture, exhausts the
  relevant opportunity, and cannot also complete through a free parallel
  Work path.
- The same bundle cannot be installed twice after retry, reconnect, or replay.
- An established fire ring grants the authored third connection slot while
  an ordinary lit campfire does not.
- A fire ring cannot be installed as a shortcut around the cairn/Anchor tier.
- An unlit fire ring provides no free light, warmth, or fuel.
- Cairn, shelter, fire ring, lit fire, lodging, and sanctuary remain distinct
  facts with distinct offers.
- Exhausting Light or Water changes an authored consequence or blocks a named
  method; it never silently ticks down while the player is away.

---

## THR-7L — Explore Bounded Labyrinths Through The Same Procedure

**Priority**: P1 / later / proposed

**Scope**: dungeon graph allocation, incremental reveal, doors, chests,
darkness, supplies, and presentation templates

**Depends on**: THR-2, THR-5 through THR-7, THR-D2

### What to do

- Treat a labyrinth as a bounded hidden graph allocated once:
  - entrance and substantial rooms are Locations;
  - unexplored passages are Leads;
  - doors and seals are Gates;
  - traps are Hazards;
  - chests and room contents are Discovery Slots;
  - darkness, pursuit, flooding, or collapse are Pressure.
- Freeze room count, adjacency, return rules, required route, optional branches,
  contents, hazards, and receipts before the first reveal. AI may not extend
  the graph because the party kept walking.
- Use hallway, doorway, chamber, and chest templates as presentation inputs to
  the image workshop. Generated text and images decorate certified room state;
  they do not create exits, contents, or mechanics.
- Apply location connection capacity to substantial branching rooms and
  entrances, not to every decorative corridor segment. A hallway template may
  be part of an edge rather than a development node.
- Let the same Scout-toward-a-place procedure reveal and enter the next
  chamber. Use setting-appropriate return fixtures—chalk marks, rope, lamps,
  sconces, cairns, signal repeaters—through the same Waymark capability.
- Bind Light, Water, Shelter, and other supplies only where the authored
  labyrinth declares relevant beats and consequences.
- First prove one deterministic five-room dark labyrinth with one locked door,
  one telegraphed Hazard, one chest, one optional branch, one return mark, and
  one finite light budget.

### Acceptance

- The five-room graph, door, Hazard, chest result, and optional branch are
  identical after replay and cannot grow beyond their authored bounds.
- Scouting a known chamber twice cannot replace it or reroll its contents.
- Losing the return trail changes expedition state without deleting rooms.
- Door, chest, trap, route, and darkness use the shared descriptor and supply
  rules rather than labyrinth-only handlers.
- Running out of Light has an authored stateful consequence and preserves a
  retreat, aid, or rescue path.
- The browser can render each certified chamber through an image-workshop
  template while remaining fully playable with AI disabled.

---

## THR-8 — Give AI A Fail-Closed Referee Presentation Packet

**Priority**: P1 / later / blocked

**Scope**: AI context, narration gate, deterministic fallback, audit trace

**Depends on**: THR-4 through THR-7, THR-7G, THR-D0 through THR-D2

### What to do

- Build one versioned scene packet containing:
  - perceivable sensory truth;
  - hidden truth excluded from player output;
  - certified targets and methods;
  - visible requirements and disabled reasons;
  - named costs and consequences;
  - current Lead, Gate, Hazard, and Pressure presentation state;
  - player-visible Discovery Slot state and committed receipt result, excluding
    seeds, unused rows, latent identities, and hidden topology;
  - the exact committed outcome when narrating resolution; and
  - allowed nouns, voice anchors, and pack vocabulary.
- Separate situation narration from outcome narration. The former cannot imply
  an uncommitted result; the latter cannot contradict committed events.
- Let AI choose wording only. If free-form player input is supported later, AI
  may propose a mapping to an existing certified method but cannot submit or
  mutate it without the ordinary confirmation and stale-offer checks.
- Compile a bounded referee move vocabulary for presentation:
  show a sign, warn of an approaching threat, state a requirement, offer a
  certified opportunity with its cost, or narrate an authorized consequence.
  The resolver chooses the legal move and facts; the model realizes them.
- Reject narration that invents an exit, item, route, trap, affected actor,
  requirement, consequence, reward, historical fact, table row, or mechanical
  state.
- Preserve deterministic authored fallback prose for model absence, timeout,
  invalid output, moderation rejection, and failed grounding.
- Store prompt version, input fact hashes, provider/model attribution,
  validation outcome, and published event references without storing secrets.

### Acceptance

- Turning AI off leaves every threshold and frontier procedure mechanically
  complete and understandable.
- An ungrounded narration cannot create or imply a legal method or state
  transition that the action surface does not contain.
- Hidden mechanism and topology facts do not leak before their reveal evidence.
- Notice, Search, Study, and Scout narration cannot imply a discovery outside
  the selected Slot or committed receipt.
- Model failure publishes deterministic prose and never rolls back a committed
  action.
- Direct-input and inference-controlled actors receive identical rules; only
  controller selection and prose source differ.
- Audit tooling can explain which facts authorized every published sentence
  and committed consequence.

---

## THR-9 — Add Worldpack Validation And Threshold Inspection

**Priority**: P1 / later / blocked

**Scope**: Compiler checks, fixtures, developer inspector, author guidance

**Depends on**: THR-1, THR-3, THR-5, THR-7, THR-7G, THR-7S, THR-7L,
THR-D0, THR-D2; coordinates with RT-9 and RT-10

### What to do

- Add schema and semantic validation for all descriptors, Discovery Slots,
  table/version references, methods, predicates, effects, scope, transitions,
  tells, finite budgets, fallbacks, and recovery references.
- Extend reachability checks with gate transitions and unique-key custody
  states from THR-3.
- Reject:
  - Hazards with no tell;
  - rolls with no named consequence;
  - methods with no state change;
  - Pressure scenes with no terminal result;
  - actor-scoped gates presented as world-open transitions;
  - critical unique keys with no recovery;
  - required discoveries with no finite completion/fallback;
  - table rows incompatible with a Slot or exceeding its topology;
  - Leads whose endpoints lack compatible connection capacity;
  - reciprocal exits that are double-counted as two unique neighbors;
  - rumors with no stable target or geographic source context;
  - cairns or anchors that create topology;
  - a fire-ring tier that skips its required Anchor tier;
  - construction paths that can install the same fixture without its physical
    material receipt;
  - bounded labyrinths with unbounded expansion or no reachable return,
    retreat, aid, or rescue;
  - generated prose bound to an authoritative descriptor.
- Add a developer-only inspector that shows:
  - canonical topology;
  - player-visible Lead state by scope;
  - current Gate predicates and satisfied evidence;
  - hidden and revealed Hazard facts;
  - Pressure participants, strategies, clocks, and terminal rules;
  - key lifecycle and recovery path;
  - Discovery Slot, claim, receipt, materialized IDs, Anchor, connection
    capacity/reservations, perishable return Lead, and actor-scoped rumor
    provenance;
  - construction materials, installed fixture tier, fire/fuel state, and
    (when RT-9/RT-10 land) Fatigue/rest capacity;
  - descriptor versions and source pack.
- Clearly separate “player currently perceives” from “authoritative hidden
  truth.” Raw details never appear in the production Journal.
- Publish author examples for a mundane door, holder-only seal, trapped chest,
  installed relic gate, fading trail, geographic rumor, capacity-tiered
  location, prepared camp, bounded labyrinth, and simple chase.
- Add a content-ratio report showing which keys, gates, Hazards, and Leads have
  reachable uses and recovery.

### Acceptance

- A content author can diagnose why a method is disabled and why a route would
  deadlock without reading Rust or C.
- The compiler fails closed with actionable messages for every rejected case
  above.
- Inspector state agrees with kernel offers and journal evidence after item
  movement, gate transitions, hazard triggers, Lead promotion/loss, and table
  claims.
- Replaying a receipt explains why one result was chosen and proves that it
  cannot be rerolled.
- Production player surfaces cannot expose hidden truth or developer nouns
  through inspector APIs.
- Core and one official expansion compile with representative fixtures before
  broader content migration begins.

---

## THR-10 — Prove Discovery, Thresholds, And Traversal End To End

**Priority**: P1 / later / blocked (release proof for the substrate)

**Scope**: Core/Holy Land content, browser, terminal, inference parity, replay

**Depends on**: THR-2 through THR-9, THR-D0 through THR-D2,
THR-7G/THR-7S/THR-7L, RT-8 through RT-10

### What to do

Ship five deliberately different examples using no bespoke resolver. The
Bethlehem–Jerusalem route-capacity proof in THR-7 lands earlier; this ticket is
the broader release proof.

1. **Mundane door**
   - obvious material and signs beyond it;
   - exact retained key;
   - quiet tool method with time;
   - force method with noise and inability to relock;
   - reciprocal return and visible disabled reasons.
2. **Trapped chest and hidden item**
   - sensory tell;
   - exact key bypass;
   - Search/Study reveal path;
   - tool method that risks the named Hazard;
   - force method with a different cost;
   - a frozen item-table receipt and no reroll on repeat;
   - Reveal, Open, Take, and capacity as separate transitions;
   - opened, disarmed, triggered, and spent replay states.
3. **Frontier trail and bounded location**
   - begin from an Anchor with a truthful geographically bounded rumor;
   - Scout once toward an exact frozen midpoint and enter it;
   - one-slot scouted state with a fallible Scout return;
   - fading-track Pressure scene;
   - careful, hurry, investigate, reacquire, and withdraw strategies;
   - one contextual event receipt and one bounded location-table receipt;
   - physical cairn construction that makes the return durable and grants a
     second connection slot without becoming shelter;
   - discovery of the second neighbor only after capacity exists;
   - established fire ring granting a third slot separately from lit fuel;
   - lost-track recovery without topology loss;
   - actor-scoped visit and gossip transfer; and
   - later ordinary Travel on the mapped return route.
4. **Bounded labyrinth**
   - one frozen five-room dark graph;
   - incremental chamber reveal through Scout;
   - one door, one chest, one telegraphed Hazard, and one optional branch;
   - a finite Light capability and a marked return;
   - image-workshop room presentation with deterministic fallback.
5. **Fatigue and rest**
   - accrue Fatigue through the foray;
   - spend the accepted number of short rests;
   - expose the Spent survival hand; and
   - prove retreat or Camp reaches recovery.

- Exercise all examples through browser buttons, terminal commands, API
  envelopes, and one inference-controlled avatar.
- Cover action-hand reachability, stale offers, concurrent attempts, reconnect,
  snapshot restore, journal replay, model-disabled fallback, and pack-version
  migration.
- Render semantic Journal beats for discovery, warning, chosen method,
  consequence, gate transition, lost/recovered Lead, and durable mark.
- Add golden state and transcript fixtures with no raw internal type, predicate,
  descriptor, clock fraction, or claim-key vocabulary.

### Acceptance

- The five examples share descriptor evaluation, action projection, journal
  evidence, and referee presentation code; content labels and target facts are
  their meaningful differences.
- No example can enter an unchanged retry loop.
- The door, chest, item, trail, and labyrinth remain fully playable without
  AI.
- Item and location selections freeze once and replay identically.
- A one-slot scouted place cannot grow forward until development supplies
  another connection slot.
- Gossip changes actor knowledge without changing topology or globally
  revealing the route.
- Physical cairn, shelter, fire-ring, fuel, Light, and Water facts do not
  collapse into one generic prepared flag.
- Fatigue can restrict outward actions but never removes the recovery hand.
- Losing the frontier trail is consequential and recoverable; it does not
  delete or reroll the route.
- Direct and inference controllers produce identical legal surfaces and
  mechanical results from identical state.
- Golden replay from before each interaction reconstructs the same final
  topology, access, item, Hazard, Lead, Pressure, and Journal state.
- The worldpack checker proves key recovery and route/recovery reachability for
  all five examples.

---

## Definition of ready for downstream issues

A downstream issue may start only when all its listed predecessors are closed
and its implementation:

1. names the exact component and descriptor version it owns;
2. preserves the four-way topology/legibility/access/safety split;
3. records deterministic claim and replay evidence;
4. provides authored fallback presentation without AI;
5. proves no-null-commit, no-reroll, finite-required-discovery, and recovery
   reachability where applicable; and
6. keeps direct and inference-controlled action legality identical.
