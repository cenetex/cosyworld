# Construction, Place Development, and Route Discovery

Status: reconciled cross-worldpack design plan. Shipped behavior, accepted but
unshipped contracts, and new proposals are labelled separately below.

This document describes how exploration, logistics, construction, and local
services can make every worldpack feel alive without introducing a `void_`
namespace or a parallel settlement engine.

The canonical product contract for location class, typed slots, project-derived
levels, and human/AI civic parity is
[Location Classes, Development Projects, and Buildings](../location-development.md).
This document distinguishes that accepted direction from the generated-place
behavior currently shipped in the runtime.

## Product model

```json
"archetypal_resonance": {
  "formula": "(topology ⊗ differentiation) → world",
  "core_archetypes": ["World", "Gate", "Facet", "Rhizome", "Void"]
}
```

- **World** is the shared authority, journal, and simulation contract.
- **Gate** is a typed boundary or transition whose topology, legibility, access,
  and safety remain separate facts.
- **Facet** is a functional face created by an installed capability, service,
  building, relationship, or other durable arrangement. A place may have more
  than one Facet.
- **Rhizome** is the branching connective graph produced by routes and changing
  relations between places.
- **Void** is undifferentiated potential: a place or connective site whose civic
  function has not yet been established. It is not a special namespace, engine
  branch, required biome, or Elysium-only type.

An **Anchor** is a durable navigation role, not a synonym for Void, settlement,
shelter, sanctuary, or Hearth. A cairn and Project 89 Signal Anchor are
worldpack-specific presentations of that shared role.

The word **purpose** remains player-facing language for an actor's Calling. Do
not add a second mandatory `location.purpose` concept. A location may gain a
class, but that class is derived from the completed building in its identity
slot. Local function continues to emerge from completed work and installed
capabilities rather than from a free-floating label chosen in advance.

## Status vocabulary

| Label               | Meaning                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Shipped**         | Runtime behavior exists, is replayed/snapshotted, and has executable tests.                                   |
| **Substrate**       | Schema or runtime support exists, but official worldpack content does not yet prove the complete player loop. |
| **Accepted target** | Product/compatibility law is recorded in an ADR or backlog, but the full behavior has not shipped.            |
| **Proposal**        | Design direction that still needs a bounded proof before becoming a runtime contract.                         |

This distinction is essential. A type appearing in Rust is not automatically a
shipped player experience, and a tested lifecycle should not be planned again as
if it were missing.

## What is already shipped

### Generated-place development ladder

A revealed generated waypoint already receives a complete, causal development
ladder:

1. **Anchor** — one contribution completes the worldpack-named fixture and
   installs the durable room tag.
2. **Connection** — a real item is carried from the connected location and
   delivered at the waypoint.
3. **Settlement** — three distinct contributions from at least two actors make
   the place eligible for a building proposal.
4. **Governance** — legal building alternatives are frozen into a public
   decision.
5. **Construction** — the selected footprint opens a job and clock; contribution
   completes the building rather than the selection click doing so.
6. **Operation** — completion installs authored capabilities, follow-up jobs,
   public memory, and any declared safety change.
7. **Civic expansion** — later civic work can open a second major footprint.

This is the generated-place lifecycle. Only its first stage is the Anchor or
cairn stage. Connection and Settlement retain separate authority and meaning.
It remains accurate shipped behavior, but it is not the target universal
founding flow. The accepted location contract lets an active Cairn directly
authorize a legal founding proposal; Connection and Settlement may remain
separate projects or archetype prerequisites without being universal gates on
originating that proposal.

### Location classes, typed slots, and levels — accepted direction

A selected founding proposal reserves one identity slot and opens a real
construction project. Completion installs the identity building, derives one
of the initial Pathway, Hearth, Garden, or Shrine classes, and awards the first
replay-safe location advancement receipt. Supporting buildings occupy typed
Amenity or Landmark slots and must fit that class as well as the existing
environment, resource, capability, access, and governance predicates.

Location level is the count of unique credited development-project
completions, capped at 20. Founding, construction, civic expansion, building
upgrade, conversion, and landmark work may count. Repeatable production,
maintenance, delivery, care, and stewardship jobs do not. Event volume, chat,
model activity, and community-art funding never count.

An autonomous avatar and a directly controlled avatar use the same proposal,
governance, and contribution rules. Either may originate a legal proposal;
neither may unilaterally install a building or bypass the place's governance.

### Natural affordances and building eligibility

Generated pathways interpolate endpoint environment profiles. Their waypoints
derive deterministic natural-potential rules from that environment. A shared
survey freezes and reveals any eligible resource, after which building legality
combines:

- mounted building catalog and pack ownership;
- public access and covenant restrictions;
- allowed-location and capability requirements;
- environment tags;
- universal versus resource-specific classification; and
- the revealed natural resource, where required.

The current catalog already covers sanctuary, route support, craft/repair,
resource gathering and processing, care, cultivation, signals, knowledge, and
expedition functions. A completed building installs capabilities; that
capability set is its initial Facet.

### Branch identity and legacy scouting

Authored and generated routes already have stable identity and an entity version.
Legacy `explore_path` composition emits one targetable offer per unrevealed
branch and distinguishes branches even when they share a destination. Generated
long routes can reveal intermediate waypoints one segment at a time without
moving on the reveal action.

## What exists only as substrate or accepted target

### Discovery Slots

The versioned Discovery Slot authority and one procedure pipeline across focused
Notice, Search, Study, and Scout are implemented. `route` is already a legal
target kind. The claim key is derived from authored slot identity, slot version,
scope, and scope identity, which preserves fixed truth and no-reroll behavior.

Official content does not yet mount a representative production Discovery Slot,
and current v2 resolution records a Lead or Reveal without materializing a new
item, location, route, reward, or movement. Bounded item/location materialization
and perishable frontier Leads remain accepted follow-on work.

Do not create a second route-discovery action or place clues, Hazards, rewards,
and Journal history directly into `RouteRecordState`. The accepted model keeps:

- route records authoritative for topology identity and lifecycle;
- Discovery Slots authoritative for bounded hidden truth;
- Leads authoritative for actor/expedition/world legibility;
- Gates authoritative for access;
- Hazards and Pressure authoritative for risk; and
- the Journal authoritative for happened history.

### Anchored forays

The accepted traversal contract lets an Anchor begin a new Lead or independent
branch, lets one active Lead continue through provisional nodes, and lets a
cairn make an already-traversed return leg durable. Full perishable-Lead,
connection-capacity, track-loss, and recovery enforcement has not shipped.

The existing generated-place Anchor remains valid historical state, but it must
not silently acquire future effects. In particular, an Anchor does not itself
reveal forward topology, settle the place, provide shelter, grant a rest grade,
or create sanctuary.

## Real gaps

### Cairned authored places cannot yet enter the universal founding flow

Authored locations may expose environment and natural potentials, and a survey
may show eligible building archetype IDs. Current major building-slot capacity,
however, is created only by a generated place's settlement proposal. An authored
location can therefore advertise eligibility without having a construction
footprint to claim.

The accepted direction is now explicit: an active Cairn or setting-equivalent
authorized Anchor permits any legal avatar to originate a founding proposal at
that location. The same jobs, governance, slot reservation, construction,
capability, Journal, and replay contracts must work for authored and generated
places. Do not fabricate a generated pathway merely to obtain settlement state.

The versioned authoring contract still needs to express Cairn equivalence,
governance policy, allowed class families or exact archetypes, typed-slot caps,
establishment presentation, and migration behavior. The target shape and
invariants live in the canonical location-development document; it must be
implemented as a versioned extension rather than inferred from prose.

### Completed buildings are mostly capability endpoints

Construction can open services and follow-up jobs, but the broader living-world
loop still needs buildings that respond to represented need, staffing, physical
inputs, bounded storage, played-world pulses, and damage. The intended direction
is an emergent staffed processor, not a settlement-management screen:

- world conditions open concrete construction, supply, staffing, upgrade, or
  repair jobs;
- actors learn those facts through observation or attributable conversation;
- each actor may volunteer only itself and contribute through ordinary legal
  actions;
- a sufficiently staffed building performs one authored, claim-keyed process on
  eligible played time;
- missing staff/input or full storage stalls without consuming or duplicating;
  and
- output enters a bounded cache and uses ordinary Take, Give, Trade, and delivery
  rules.

### Knowledge and gossip are not yet a clean gameplay surface

The Journal already projects recent room beats, but those beats are not a
skill-gated room-memory reward. The missing player loop is typed, scoped
knowledge:

- Search can reveal an authored or event-grounded place-history fact;
- Scout can reveal one exact route segment;
- observation can disclose a bounded visible fact about another actor; and
- conversation can transfer one fact the speaker actually knows, with
  provenance.

This knowledge layer should make construction needs and route discoveries travel
through the world without making every actor or client omniscient.

### Equal human and AI civic agency needs one action surface

Inference-controlled actors already use the same legal contribution surface and
can help complete construction. Current permanent building selection favors a
directly controlled chooser. The accepted location contract gives both
controller modes the same bounded civic acts:

- propose one currently legal alternative;
- support or object to a public alternative for an authored reason;
- volunteer themselves for a concrete job or staffing commitment; and
- explain their choice from certified needs, bonds, duties, and known facts.

AI must not invent an archetype, output, resource, rule, slot, class, or
permanent topology, and it must never assign another actor. Selection remains
governed by an explicit authored policy. Human control grants no mechanical
override.

## Discovery repeat law

Do not use a room's canonical `entity_version` or a route's topology
`entity_version` as a discovery reset. Those versions are optimistic concurrency
guards and change for reasons much broader than new discoverable truth.

Use one of these instead:

- the existing `(slot_id, slot_version, scope, scope_id)` claim;
- a newly authored Slot/version for genuinely new bounded truth;
- a new exact Lead identity when geography changes; or
- a typed delta-observation claim over a bounded Journal/event window when the
  subject is “what changed here?”

Changing circumstances may create new evidence. They do not reroll an old
stocking receipt or republish every fact in a room.

## Player-facing discovery language

A player may naturally say “check this,” and a client may group discovery offers
under “Look closer.” The authoritative offer must still name the exact procedure
and target:

| Procedure      | Subject                                    | Promise                                                    |
| -------------- | ------------------------------------------ | ---------------------------------------------------------- |
| Scene Notice   | Current scene                              | Free obvious truth and danger tells.                       |
| Focused Notice | One unresolved broad sensory subject       | One authored Sign or safety/environment result.            |
| Search         | One local physical target                  | Exhaustively resolve its fixed physical truth.             |
| Study          | One perceived target                       | Interpret mechanism, provenance, requirement, or relation. |
| Scout          | One exact geographic Lead or route subject | Reveal authorized geography without moving.                |

Skill modifies the ability check used to avoid a named consequence under
pressure. It does not grant universal depth tiers, secretly rewrite the stocked
result, or turn the Journal into full surveillance.

## First cross-worldpack proof

The first construction proof after the current trust and remembered-arc gates
should use an **intermediate construction site on an exploration path**, not a
mandatory purpose field on every location.

Elysium is a useful content proof because its current rhizome consists entirely
of authored, distance-one Void cells and does not declare a generation policy.
Use one bounded branch rather than changing the whole graph:

1. declare a reviewed Elysium generation policy and neutral Anchor presentation;
2. make one reciprocal branch long enough to allocate one deterministic
   intermediate waypoint;
3. allocate/reveal that waypoint through the existing exact legacy branch offer;
4. mount one bounded Discovery Slot against the branch or site and prove that it
   records only its authored Lead/Reveal rather than creating topology or moving;
5. enter the revealed waypoint through separate Travel;
6. expose its Anchor, exact-resource Connection, and Settlement work with
   concrete copy;
7. derive or author one natural potential and complete its survey;
8. settle it with at least two separately controlled actors;
9. govern and complete one existing functional building;
10. show the resulting capability, need, and Journal history to a later arrival;
11. replay and snapshot the complete sequence; and
12. prove provider outage changes only optional prose/media.

Prefer an existing building such as a Waystation, Workshop, or Archive. A new
archetype belongs in this proof only if it installs a real capability and creates
a meaningful downstream action or job.

## Planning sequence

These are planning stages, not a standing GitHub issue queue. Promote only the
first bounded, executable slice whose prerequisites are satisfied.

1. **Reconcile language and status.** Keep this document, ADR 0005, player
   guides, and action contracts consistent about Anchor, settlement, Facets,
   discovery claims, and shipped versus target behavior.
2. **Make logistics exact.** Ensure delivery jobs match the required physical
   resource as well as origin, destination, holder, and movement history.
3. **Prove one path construction site.** Use the existing generated-place
   lifecycle and one mounted Discovery Slot in one real worldpack branch; capture
   player-facing and replay evidence.
4. **Make needs discoverable.** Add typed local facts and attributable gossip so
   actors learn construction/supply work through the world rather than an
   omniscient task list.
5. **Prove one staffed processor.** Run one building from represented need through
   construction, staffing, one bounded output cycle, collection, upgrade stall,
   and repair.
6. **Decide authored development.** Only after those proofs, decide whether
   existing authored locations need an opt-in development profile.
7. **Complete frontier Leads.** Finish bounded materialization, perishable Lead,
   capacity, recovery, and anchored-foray work under ADR 0005 rather than adding
   route-local shortcuts.

## Building families

Treat these as capability families, not a promise to add every noun:

| Family                  | World function                                    | Existing examples                                      |
| ----------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| Shelter and hospitality | Rest, hosting, sanctuary, arrival                 | Dwelling, Healing House, Bathhouse                     |
| Route and logistics     | Travel support, delivery, expedition, signals     | Waystation, Signal Tower, Expedition Lodge             |
| Craft and repair        | Transformation, maintenance, tools                | Workshop, Smithy, Kiln, Carpenter's Lodge              |
| Harvest and extraction  | Bounded access to represented natural features    | Fishery, Shallow Mine, Market Garden, Orchard          |
| Processing and power    | Transform inputs through a place-bound capability | Smokehouse, Pottery, Watermill, Windmill               |
| Knowledge and memory    | Investigation, traces, exhibits                   | Archive, Museum, Conservatory                          |
| Care and medicine       | Healing, herbs, recovery services                 | Herbalist, Apothecary, Healing House                   |
| Civic, trade, and watch | Public coordination, custody, exchange, safety    | Future work only when concrete actions and state exist |

Names such as `bridge_post`, `trail_beacon`, `relay_hub`, or `caravan_post` are
not useful merely as catalog entries. Each needs a bounded capability, inputs,
outputs, offers/jobs, failure behavior, and replay contract.

## Non-goals

- No `void_` engine fork or Elysium-only construction rules.
- No required singular purpose on every location.
- No mayor, city-builder, workforce-assignment, tax, or production dashboard.
- No generic Build, Upgrade, Harvest, Gather, Process, or Extract action card.
- No AI-selected topology, mechanics, resources, outputs, rewards, or staffing
  eligibility.
- No wall-clock production or decay.
- No route entity version as a reroll token.
- No inference from a cairn to shelter, settlement, sanctuary, or rest grade.
