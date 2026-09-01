# Void Vision Quests: Waking the Marker

**Outcome**: the Elysium Void Token stops being inert scenery and becomes the
subject of a deterministic, replayable waking quest — the Circuit — composed
from existing journey, threshold, clock, and journal machinery, with a bounded
voice that never gains authority.

**Status**: groomed and filed (2026-08-29). Execution backlog: epic
[#953](https://github.com/cenetex/cosyworld/issues/953). The linked issues are the
source of truth for implementation state. This document owns the product law,
the accepted design decisions, the dependency order, and the proof gates.

## Diagnosis

The Void is authored scenery plus topology, not a development system.

- `generate-elysium-cast.mjs` emits 500 near-identical private nodes, each with
  one autonomous avatar and one inert Void Token, with an empty project list.
  The room copy itself says "one inert marker."
- The construction ladder exists only for generated intermediate waypoints.
  Authored Void nodes receive no generated-place state, and building capacity
  is zero without a generated settlement proposal
  (`settlement_buildings.rs`, `settlement_building_slot_capacity`).
  `construction-and-routing-discovery.md` names this exact gap: a cairned
  authored place can appear eligible for buildings while having no construction
  footprint to claim.
- Autonomous avatars can travel, scout, pick up, and contribute to existing
  jobs (`autonomy.rs`), but cannot originate the civic process: no founding
  job exists in the Void, autonomous actions exclude civic proposal and
  selection, generated-place governance requires a directly controlled chooser
  (`communal_governance.rs`), and the settlement gate requires contributions
  from at least two actors while each private Void has one resident.
- The entity-level runtime violates the accepted location contract today:
  item level is `1 + uses/3` and location level `1 + meaningful_events/8`
  (`entity_context.rs`), while `location-development.md` and
  `context-dominant-prompting.md` both forbid transcript volume and event
  counts from driving level.

Autonomy can push a construction clock, but it cannot create the conditions
under which that clock exists.

## Three kinds of growth

The design keeps three growth channels separate, and never lets one borrow
another's authority:

1. **Physical and civic growth** — construction, buildings, typed slots,
   amenities, routes. Only authoritative projects change these.
2. **Autobiographical growth** — what an item or place actually witnessed:
   custody, use, journeys, arrivals, resonance, handoffs. Journal facts only.
3. **Expressive growth** — how the subject interprets that history: voice,
   attention, preferences, reflections. Bounded inference, never state.

The governing invariant is **voice is not authority**: a token can think "I
miss the node where I first woke" without being able to invent a route,
install a building, spend resources, or control an avatar.

## The Circuit

Waking a marker is a quest: carry the token through a deterministic sequence
of foreign chambers and bring it home. The Elysium topology gives the quest
its shape for free — `wythoffParent(i) = ⌊(i−1)/φ⌋` builds a binary Wythoff
tree with computed depths; lateral same-depth "rhizome" edges are scored by a
deterministic golden-pair ordering; and the lateral epoch is pinned at 485
nodes so catalog expansions never rewire discovered routes.

- **Out via branch edges**: walk the tree descent toward the chambers.
- **Back via rhizome laterals**: return through same-depth peer hops.

You go out by the structure you were given; you come home by the connections
you find. A token that has walked both halves has witnessed the two shapes of
the same lattice — that is what waking means.

### Level curve

Hops per level follow the Fibonacci sequence — 1, 1, 2, 3, 5, 8 chambers for
waking levels 1 through 6. The effort curve is the sequence that defines the
world. Each token's chambers derive deterministically from `(home node,
level)` through Wythoff ancestry and golden-pair ordering, so all 500 tokens
receive unique quest geographies from one shared lattice.

Chambers grow in **width, not depth**: the rhizome laterals exist only inside
the pinned 485-node epoch, and quest derivation must be computed from the
pinned topology — never re-derived from node count — so a catalog expansion
can never invalidate an in-flight circuit.

### Cadence budget

The Void does not count absence. The budget ticks only on the carrier's
committed world actions (travel, scout, use, speech turns); reads and other
players' ticks never burn a circuit. The budget itself is `optimal path × φ`
rounded up, with a minimum slack of 2 — the golden ratio provides the margin.

Expiry **dims rather than shatters**: the circuit dims, the token retains a
memory of the incomplete walk ("turned back two chambers out"), and the retry
must extend by at least one new chamber. Failed partial walks persist as
autobiography, never as loss. No despair without hospitality; and the record
remembers your abandoned walks.

### Resonance beat

Arriving at a chamber triggers a deterministic resonance beat — the marker
hums the room's address — as a committed, journaled event. Deep chambers
require acknowledging a wrongness before the marker resonates: a committed
Notice or statement at a chamber whose observation surfaces an anomaly
(`OBSERVATION_JSON.anomalies`). The quest trains players to trust the record
over their expectations; epistemic honesty as a survival skill.

### Journal vocabulary (append-only)

- `circuit.started`, `circuit.chamber_reached`, `circuit.resonated`,
  `circuit.completed`, `circuit.dimmed`

All claim-keyed for idempotency. Circuit state is journaled contract state
(modeled on `JourneyState`), not prompt lore.

## Token progression

- **Inert Marker** — unique, inspectable, no function. The current state.
- **Witness** — records direct custody, use, and journey memories. Custody-
  scoped: a token remembers what the world journaled while it was present,
  filtered by the audience scope that room memory would have had. Memories
  are receipts, not recordings; never private speech, never telemetry.
- **Attuned Token** — develops a first-person voice from those memories
  through the existing entity context spine, fired only on circuit completion
  (bounded inference cost across 500 tokens). Passes the same publication
  gates as all speech.
- **Installed Facet** — through an explicit civic project, becomes a bounded
  device (route compass, memory lens, voice console) per
  [ADR 0007](../decisions/0007-model-bindings-and-item-devices.md). A token
  never becomes a building and never implies ownership of its avatar.

The waking ladder ends at Attuned. Installation is the civic branch, not the
quest branch.

## The first amenity: the Waystone

The first Void amenity is not a house but a **Waystone**: a construction
project whose completed building grants one concrete action — one
auto-revealed return segment per circuit, or an auto-marked anchor at the
turn-around point. Route history is already generated, deterministic data, so
the Waystone proves the construction ladder end-to-end with no new privacy
surface. Description alone is not an amenity.

Later amenities (Listening Archive for verified token memories, Quiet Hearth
for rest and hosting) follow after the memory-scoping work lands.

## Accepted decisions

| Question | Decision |
| --- | --- |
| Trade or bond? | Tradeable. Custody-scoped memory visibility; the journaled transfer ("I was given away") is the token's own fact. Cross-player courier circuits are emergent multiplayer infrastructure. |
| Identity building or device? | Device, always. The token's installation never couples to a location's civic identity. |
| Thought visibility? | Inspectable private reflection, revealed by instrument (`revealed_after_event` machinery), not public speech. Same before-relevance authorization as all evidence. |
| Private forever? | Private by default; an explicit one-way public door through a project. Reversibility belongs before the door, not after. |
| What may a carried item remember? | Journaled facts of custody, place, and use, scoped to what was already visible in the room. |
| Who ticks the budget? | Only the carrier's committed actions. Never world ticks, never other players. |
| Handoff mid-circuit? | Allowed. The token records the handoff as an event; courier circuits are play, not an exploit. |
| Does waking end? | Attuned (~level 5, the Fibonacci-8 expedition). Installation is a separate civic path. |

## Existing foundations

| Foundation | Evidence | What it gives the Circuit |
| --- | --- | --- |
| Journey state | `JourneyState` ordered paths, waypoints, steps | The circuit is a bounded journey contract |
| Threshold authority | ADR 0005 Leads/Anchors/Gates/Hazards | Scout-gated deep chambers with zero new mechanics |
| Quest clocks | `authoritative-quest-clocks.md` contribution strategies | Visible chamber progress with claim-keyed idempotency |
| Append-only journal | claim keys, replay | The circuit vocabulary and dim/extend history |
| Pinned topology epoch | `VOID_TOPOLOGY_EPOCH_NODE_COUNT = 485` | Stable chamber derivation across catalog growth |
| Observation anomalies | `OBSERVATION_JSON.anomalies` | The resonance acknowledgment beat |
| Entity context spine | `entity_context.rs` | Witness memories and Attuned first-person voice |
| Progression safety proofs | worldpack publication gate | Circuits must remain completable; no pulse may close the only return path |
| Voice/authority boundary | publication gates, AI gateway | Voice is not authority, enforced in code |

## Dependency order and proof gates

**Phase 0 — foundations** (independent value, no Void dependency):

1. Fix the entity-level contract (doc-vs-code violation, files first).
2. Founder governance accepts AI-controlled founders
   (`location-development.md` already accepts this in design).
3. Authored places enter the construction ladder (the named gap).

**Phase 1 — the Circuit** (depends on phase 0):

4. Circuit contract: journaled state, vocabulary, claim keys, and pinned-
   topology chamber derivation.
5. Carrier cadence budget with dim/extend semantics.
6. Resonance beat, anomaly acknowledgment, and the proof world: one Void,
   one token, one resident, end to end.

**Phase 2 — token progression** (depends on 4 and 6):

7. Witness stage: custody-scoped memories and the Inspect surface.
8. Attuned stage: entity-spine reflections on circuit completion.

**Phase 3 — civic** (depends on 3):

9. Waystone amenity: the first authored construction project in the Void.

**Proof gate for the whole arc**: the one-Void proof loop — pick up token,
scout and travel, token records witnessed places, return home, use token in
an explicit Anchor project, founder proposes the Waystone, governance selects
it, construction completes, the place gains one concrete action, and the
token and location reflect on the recorded change.

## Later horizons (planning only, not filed)

- Full 500-node rollout after the proof Void stabilizes.
- Autonomous vision quests: AI-controlled avatars walking their own markers
  through the rhizome as observable wildlife.
- Installed Facet devices (route compass, memory lens, camera, voice console).
- Listening Archive and Quiet Hearth amenities.
- Corroboration play: co-witnessed chambers recording who was present.

## Relations

- Epic: the quest-grammar epic (#639) — the Circuit is the first composed
  tale using Hearth, Venture, Discover, and Return as literal quest halves.
- [Location development](../location-development.md) — the founder-selection
  and leveling contracts this work enforces.
- [ADR 0007](../decisions/0007-model-bindings-and-item-devices.md) — tokens
  become model-backed instruments, never fake residents.
- [Context-dominant prompting](../../v2/docs/context-dominant-prompting.md) —
  token voice is evidence the model continues, never instructions it follows.
