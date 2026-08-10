# ADR 0005: thresholds, trails, and the strict referee

- Status: Accepted
- Date: 2026-07-30
- Decision owners: CosyWorld maintainers
- Related: [#586](https://github.com/cenetex/cosyworld/issues/586),
  [#587](https://github.com/cenetex/cosyworld/issues/587),
  [#600](https://github.com/cenetex/cosyworld/issues/600),
  [#601](https://github.com/cenetex/cosyworld/issues/601)

## Context

CosyWorld already has authored and hidden exits, route discovery, generated
waypoints, local Leads, locked flags, item custody, deterministic loot
receipts, clocks, cairn-like place fixtures, and graded rest. They do not yet
share one product law. In particular, a route can exist without being known, a
known route can be locked, a safe-looking threshold can contain a Hazard, and
a discovered place can still lack a durable return. Treating those facts as one
state would make replay, recovery, and player-facing explanations dishonest.

The threshold substrate therefore composes five small components. It does not
create a universal obstacle object:

| Component | Owns | Does not own |
| --- | --- | --- |
| **Discovery Slot** | The bounded kind and quantity of hidden truth, plus the fixed result or versioned stocking table that selects it once. | Whether anyone can perceive, reach, cross, carry, or safely interact with the result. |
| **Lead** | The exact hidden truth an actor, expedition, or the world may currently pursue or interpret. | The existence of topology or permission to cross it. |
| **Gate** | The conditions and authored methods that permit a target to open, yield, or be crossed. | Whether the target exists, has been noticed, or is safe. |
| **Hazard** | A sensory tell, trigger, affected targets, bypasses, and deterministic consequences. | Access permission or multi-turn scene cadence. |
| **Pressure** | Consequence-bearing played time for a layered or opposed situation. | Stocking hidden truth or choosing permanent topology and rewards. |

A trapped hidden door can compose a Discovery Slot, Lead, Gate, and Hazard. A
chase can be Pressure without a Gate. Components keep stable pack-owned
identities and may reference one another, but they remain independently
inspectable and versioned.

## Decision

### Four independent questions

Every offer, resolver, inspector, and migration must answer these questions
separately:

1. **Topology:** does the route, target, item, actor, or fact exist?
2. **Legibility:** who has enough evidence to perceive or pursue it?
3. **Access:** who may open, take, use, or cross it by which method?
4. **Safety:** what has been telegraphed, what can trigger, and what consequence
   is at stake?

Revealing a target never opens it. Opening a container never Takes its
contents. Making a route accessible never reveals it. Disarming a Hazard never
unlocks its Gate. No presentation layer may collapse those transitions.

### Authority and ownership

| Concern | Authority | Required record |
| --- | --- | --- |
| Authored bounds, fixed outcomes, table membership, tells, methods, recovery declarations, and presentation fallbacks | Versioned worldpack compiled by the host | Pack/version, canonical IDs, descriptor versions, and validation result |
| Stocking selection | Server-owned deterministic resolver | Slot/table/version, eligible inputs, algorithm version, seed input, selected row, claim key, fallback, and materialized IDs |
| Opening, passage, item placement/custody/charges, irreversible transitions, and authoritative consequences | C kernel, or a temporary bounded journal reducer that cannot contradict it | Accepted intent, evidence, expected entity versions, action/event versions, and resulting events |
| Lead scope, route discovery, Anchor/foray state, and compatibility projections | Journaled runtime state until the matching kernel substrate lands | Stable identities, scope, source event, expected revision, transition, and result |
| Pressure cadence and clocks | Server scheduler over journaled authoritative state | Participants, strategies, played-time event, progress/danger movement, and terminal result |
| Offer enumeration and disabled reasons | Server projection from current authoritative state | Exact component, target, method, requirement, cost, effect, consequence, and state revision |
| Narration and decorative media | Authored fallback first; validated AI may realize only the certified packet | Fixed facts and committed outcome; never hidden rows, seeds, predicates, or uncommitted alternatives |
| Rendering and input | Client | Select an exact certified offer and acknowledge presentation; never supply rules evidence or results |

AI is the referee's voice, never the referee's authority. Model failure uses
deterministic fallback copy and cannot prevent or alter a committed mechanical
result.

### Canonical procedures and player verbs

Internal procedure IDs are versioned. Player copy may use an approved
pack-specific reskin, but the binding below cannot change.

| Procedure | Player verb | Contract |
| --- | --- | --- |
| `scene_notice_v1` | no button; the scene simply shows it | Free on arrival or relevant state change. Publish obvious exits, creatures, objects, landmark cues, sensory Signs, and perceivable Hazard tells. Never roll and never consume played time. |
| `focused_notice_v2` | **Notice** | Spend one turn to resolve one broad, authored sensory Lead or stateful safety/environment result. Offer it only while an unresolved result exists. Under Pressure, a check avoids a named consequence; it never decides whether stocked truth exists. |
| `search_v2` | **Search** | Spend one turn exhaustively examining one named local physical target. A safe Search is certain. It may reveal a frozen item, mechanism, secret feature, actor trace, or evidence, but never opens, Takes, equips, or moves through the result. |
| `study_v2` | **Study** | Spend one turn interpreting an already perceived target. Reveal requirements, operation, provenance, meaning, or a better method. Study cannot materialize physical truth. |
| `scout_v2` | **Scout** | Spend played time pursuing one exact geographic Lead from a legal Anchor or along its active foray. Reveal only the authorized next segment or target. Scout never moves the actor; **Travel** is a separate commit. |
| `travel_v1` | **Travel** | Move through one revealed route whose Gate permits this actor or expedition. Travel does not stock, reveal, or secure a destination. |
| `mark_v1` | **Mark** | Create an expedition-scoped, potentially perishable navigation mark on a traversed leg. It supports the active return chain but does not create topology, reveal forward truth, authorize an independent branch, or establish an Anchor. |
| `open_v1` | **Open** | Apply one certified Gate method to a named door, seal, or container. The offer states its requirement, cost, effect, and telegraphed consequence. Open does not reveal hidden contents or transfer them. |
| `take_v1` | **Take** | Transfer one revealed, accessible item into legal custody after capacity and placement checks. Take does not reveal, Open, equip, install, or use it. |

`Inspect` is approved copy only when it binds to `search_v2` for physical
examination or `study_v2` for interpretation. It is not a third resolver.
`Listen` and `Tune In` may reskin focused Notice. `Head To` may reskin Travel.

The currently journaled route procedure is named `scout_v1`: it uses the
legacy Search action and an `explore_path` projection mutation to reveal one
adjacent segment without moving. It remains replay-readable. `scout_v2` keeps
the honest no-movement result but adds an exact Lead, Anchor/active-foray
evidence, descriptor versions, and no-null-commit law. New code must use a new
append-only action or procedure version rather than reinterpret `scout_v1`.

The `discovery-procedure-v2` runtime implements `focused_notice_v2`,
`search_v2`, `study_v2`, and `scout_v2` as one slot-bound pipeline. A pack
catalog freezes the receipt, claim scope, stocked result, and any pressure
consequence before an offer is projected. Browser, terminal, API, and
inference controllers select that same offer and receipt. A safe Search
commits without an ability roll; under Pressure the roll only avoids the
already-frozen consequence. The discovery projection records a Lead or Reveal
and cannot Open, Travel, Take, equip, materialize, or award the result.
Snapshots and journal records preserve the frozen claim, and exact retries or
replay cannot roll or publish it twice. Legacy Search, Study, and `scout_v1`
records retain their original meanings.

### Shared discovery progression

The common vocabulary is:

`latent → signed → lead → revealed → accessible → secured`

These words describe separable transitions, not one mega-enum. `revealed` is
normally monotonic shared truth; `accessible` may change when a key, charge,
installed item, standing, or Hazard state changes. A lost or forgotten Lead
does not erase topology or a prior shared reveal.

| Kind | Latent | Signed | Lead | Revealed | Accessible | Secured |
| --- | --- | --- | --- | --- | --- | --- |
| Item | A fixed authored item or frozen Slot result exists. | A sensory tell is perceivable. | A scoped opportunity names where/how to look. | The item and placement are visible. | Container/Gate/Hazard permits interaction. | Legal custody or an authored durable cache records it. |
| Location | A bounded point of interest and its topology are fixed. | A geographic Sign is perceivable. | An exact foray target is active. | The place becomes shared world truth. | A revealed route and Gate permit arrival. | A durable navigation Anchor records a return; settlement remains separate. |
| Route/edge | The canonical edge exists. | A trail, draft, notation, or other tell is perceivable. | An exact destination/edge may be pursued. | The edge is shared and may be offered. | Its Gate permits Travel for the relevant scope. | A traversed return leg is durably anchored; familiarity remains separate. |
| Actor | An authored or frozen actor result exists. | Tracks, voice, rumor, or presence cue is perceivable. | A scoped opportunity points to the actor. | Identity/presence is visible according to its policy. | Interaction rules permit the attempted action. | Not applicable to personhood; rescue, relationship, custody of items, or completed objectives use their own state. |
| Lore | A fixed fact exists. | Evidence is perceivable. | A question or source can be pursued. | The proposition is known to its declared scope. | Required language, source, access, or interpretation method is satisfied. | A durable journal, memory, or authored record preserves it when the content declares that terminal state. |

Kinds may stop at the last meaningful phase, but they may not silently skip
Gate, Hazard, custody, capacity, or movement checks.

### Three table classes

1. **Stocking tables** create bounded hidden truth once. The server freezes the
   table/version/inputs/algorithm/seed/row/claim before reveal. Reconnect,
   controller change, abandonment, repeat Search, model failure, and replay
   cannot reroll it. A location row can fill only topology authorized by its
   Slot.
2. **Event tables** apply typed Pressure after relevant committed played time.
   They may alter a Lead, position, resource, Hazard, clock, or method
   availability. They cannot invent permanent topology, unique loot, required
   keys, or rewards outside a previously frozen Slot.
3. **Presentation tables** vary wording or media for facts already fixed. They
   have no claim key and no authority over quantities, targets, rules, access,
   consequences, or state transitions.

The existing quest-loot weighted receipt is the seed/weight/unique/fallback
implementation to generalize. A second deterministic table algorithm must not
be invented without a new ADR and replay version.

### Anchors, forays, Marks, cairns, and settlement

- An **Anchor** is a durable navigation role held by an authored stable place
  or an authored worldpack-specific fixture.
- A new Lead or independent branch begins at an Anchor.
- One active Lead may continue through provisional nodes while its return
  chain remains recoverable. It does not require a new fixture at every step.
- Mark records a temporary expedition return cue. Losing it changes Lead or
  return confidence, never canonical topology.
- A **cairn** makes an already traversed return leg durable and may authorize a
  later independent branch. It does not invent topology, reveal the way ahead,
  provide shelter, grant a rest grade, create sanctuary, or settle a place.
- Project 89's **Signal Anchor** is a pack-specific presentation of the same
  navigation role. It remains place-bound infrastructure, never inventory.
- Existing generated-place `anchor_clock_id`, `anchor_job_id`, and
  `generated-place:<id>:anchor-fixture` state are retained. Their completion
  means a durable navigation Anchor. The distinct connection and settlement
  jobs still own connection and settlement; no historical event gains a new
  side effect.

Five facts must remain independent:

| Fact | Current representation | Law |
| --- | --- | --- |
| Navigation stability | Authored stable place or completed anchor fixture | Permits durable return and later branching only. |
| Route familiarity | Generated-pathway `familiar`, traffic class, and familiarity job/clock | Describes repeated shared use; it neither reveals an edge nor settles a place. |
| Place settlement | Generated-place connection/settlement jobs, clocks, and room safety transition | May change services or sanctuary only through its own committed contract. |
| Shelter | Authored room feature or equipped `camp_shelter` capability | Determines whether Camp can be offered; a navigation fixture is not shelter. |
| Rest grade | ADR 0004 Hearth/Lodged/Camp derivation | Never inferred from a cairn, Mark, Lead, familiarity, or route reveal. |

Rest/fatigue cadence is owned by #356 and the decision in #603. Scout and
Pressure consume that contract after it is accepted; they do not invent short
rests, fatigue thresholds, or a second recovery system.

### Product laws

- **No danger, no roll.** Ordinary skilled work with the required method is
  certain when no meaningful consequence is at stake, although it may cost
  played time.
- **Telegraph before danger.** Every Hazard and dangerous method exposes an
  authored sensory tell before commitment.
- **No null commit.** A committed procedure resolves the target, produces a
  Lead/fact, changes Pressure, proves the target safe/empty, consumes a
  resource, changes position, or removes that method. It never returns
  unchanged “nothing found; try again.”
- **No reroll.** Stocking truth and unique results freeze once. Player action
  reveals or interacts with the receipt; it cannot select another row.
- **Finite required discovery.** Required progression has a finite Sign budget
  or deterministic fallback. Optional missable content must declare itself
  optional.
- **Recovery reachability.** A required key, reclosable Gate, provisional
  foray, Lead loss, or future fatigue transition cannot remove every legal
  retreat, camp, aid, rescue, alternate route, or recovery source.
- **Controller parity.** Direct and inference controllers receive the same
  certified methods and authoritative outcomes.

Simple obstacles resolve in one action. Pressure is reserved for situations
with at least two meaningful beats, differentiated strategies, and a terminal
consequence.

## Migration inventory

This ADR adds no runtime state. It assigns each existing field a migration
disposition so #600, #588, and later slices can add versioned state without
guessing.

### Topology, legibility, and access

| Existing field/state | Current authority | Migration disposition |
| --- | --- | --- |
| `SeedExitContent.{pack_id,from_location_id,to_location_id,direction,flags,distance,directionality,fallback_location_id,discovery}` | Compiled worldpack seed | Retain as authored topology. Compile `discovery` into initial legibility; never infer access or safety from it. |
| `CwExit.{from_location_id,to_location_id,flags}` and `CW_EXIT_LOCKED` | Kernel | Retain exactly for historical crossing. New `Gate v1` compiles an equivalent legacy lock projection until all authored locks migrate. |
| `RouteRecordState.{id,canonical_id,edges,owner,owner_pack_id,owner_pack_version,generation_policy,provenance,directionality,fallback_location_id,lifecycle,discovery,unlocks,entity_version}` | Journaled route state | Retain as canonical route identity/lifecycle and compatibility discovery/unlock history. New Slot, Lead, and Gate references point to `canonical_id` plus `entity_version`; they do not replace route existence. |
| `RouteEdgeState.{from_location_id,to_location_id,flags}` | Journaled route projection | Retain topology and legacy lock flags. Do not add legibility or Hazard meaning to `flags`. |
| `RouteDiscoveryState.{actor_id,event_seq,reason}` | Journaled projection | Retain as historical first-discovery evidence. New scoped `Lead v1`/reveal receipts provide explicit actor/expedition/world scope. |
| `RouteUnlockState.{from_location_id,to_location_id,actor_id,event_seq,reason}` | Journaled projection feeding kernel exits | Retain as historical unlock evidence. New Gate transitions use append-only descriptor/action versions. |
| `RouteLifecycle::{latent,open,blocked,frozen}` | Journaled route state | Retain as topology lifecycle only. `blocked` must not stand in for unknown, unsafe, or inaccessible-to-one-actor. |
| `SeedHiddenExitContent.{id,pack_id,from_location_id,to_location_id,feature_key,direction,return_direction,reveal_chance_percent,source,discovery_text}` | Compiled seed plus legacy Search projection | Retain for old saves/events. `reveal_chance_percent` is legacy reveal/selection coupling and is forbidden for newly authored `DiscoverySlot v1`; new truth freezes before reveal and safe Search is certain. |

### Generated routes, Leads, and Anchors

| Existing field/state | Current authority | Migration disposition |
| --- | --- | --- |
| `GeneratedPathwayState.{id,identity_version,canonical_id,source_route_id,source_route_version,owner_pack_id,owner_pack_version,generation_policy,origin_location_id,destination_location_id,distance,created_by_actor_id,way_class,traffic_count,waypoints,generation,revealed_edges,art_eligible,familiar}` | Journaled generated topology | Retain all identity, ownership, topology, prose provenance, reveal, traffic, art, and familiarity fields. New Slot/Lead/Anchor state references the pathway and route version. `revealed_edges` remains the `scout_v1` compatibility projection; `familiar` is never an Anchor or reveal. |
| `GeneratedWaypointState.{id,canonical_id,name,meta,generation_policy}` | Journaled generated topology/presentation | Retain. New location Slots may authorize creation, but presentation generation cannot alter IDs, topology, Gate, Hazard, or ownership. |
| `JourneyState.{actor_id,pathway_id,origin_location_id,destination_location_id,destination_name,path,current_step,explorer}` | Journaled active traversal | Retain for `scout_v1` and Travel replay. `scout_v2` adds exact Lead and Anchor/return-chain references rather than inferring them from `explorer`. |
| `LocalLeadState.{id,actor_id,source_actor_id,source_offer_id,source_reference,source_event_seq,origin_location_id,destination_location_id,destination_hint,received_tick,consumed,settled,forgotten,consumed_event_seq,settled_event_seq}` | Journaled actor-scoped lead | Retain and compile into `Lead v1` compatibility state. `forgotten` maps to lost legibility, not deleted topology; `settled` maps to resolved Lead, not place settlement. |
| `GeneratedPlaceState.{schema_version,location_id,canonical_id,pathway_id,connected_from_location_id,discovered_by_actor_id,discovered_event_seq,source_generation,pack_id,pack_version,generation_policy,anchor_clock_id,connection_clock_id,settlement_clock_id,anchor_job_id,connection_job_id,settlement_job_id,connection_item_id,building_proposal}` | Journaled generated-place progression | Retain. Anchor completion projects navigation stability; connection and settlement remain distinct. Schema v2 freezes the represented item identity required by a generated-place Connection so projection rebuilds, snapshots, and journal replay cannot silently substitute cargo. New Anchor state references the committed fixture event without changing past milestones. |
| `generated-place:<id>:anchor-fixture`, cairn policy copy, and Project 89 Signal Anchor policy copy | Journaled tag plus pack presentation | Retain. Standardize their mechanical role as durable navigation Anchor; worldpack terminology remains presentation. |
| `rpg_claims`, `listen_attempt_claims`, route discovery/unlock receipts, and Visit Ledger marks | Journaled compatibility claim sets/records | Preserve exact keys for replay. New Slot/Lead receipts use namespaced versioned claim IDs; migration may backfill references but never re-award or reinterpret a historical claim. |

### Items, custody, and deterministic stocking

| Existing field/state | Current authority | Migration disposition |
| --- | --- | --- |
| `SeedItemContent.{pack_id,id,name,description,kind,charges,location_id,role,capabilities,weight_tenths,size,container_capacity_tenths,skill_id,skill_bonus,mechanics,container_opening_size,allowed_contents,access_cost,nested_containers}` | Compiled item seed | Retain as fixed authored item/template data. A Discovery Slot may reference a fixed item or template but cannot override mechanics, capacity, or placement law. |
| `SeedPlayableItemMechanics.{binding,equipment_profile,target_predicate,resolver,effect_budget,uses,exhaustion,recovery,transfer_policy,theft_policy,magic_effect}` | Compiled rules binding | Retain. Gate predicates may reference closed capabilities or exact items; generated text cannot author these fields. |
| `CwItem.{id,kind,charges,max_charges,weight_tenths,container_capacity_tenths,size_class,role,zone,recovery,recovery_zone,location_id,holder_actor_id,container_item_id,held_since_tick,recharge_at_tick}` | Kernel | Retain as custody, placement, capacity, charge, exhaustion, and recovery authority. Discovery never mutates these except through an explicit kernel transition. |
| `ItemProvenanceState.{item_id,origin,acquisition,previous_holder_actor_id,current_holder_actor_id,current_location_id,transfer_count,source_event_seq,possession_journey}` | Journaled provenance projection | Retain for explanation and recovery validation; kernel custody remains authoritative. |
| Equipped charms, prepared spells, card zones, materialization/craft receipts, transfer offers, and item placement events | Kernel plus journaled receipts | Retain. New Gate/Take/Open methods consume their existing exact state and stale-offer checks. |
| Loot table catalog `{schema_version,replay_version,item_templates,tables}` and table `{id,version,allocation_policy,quantity,eligibility,entries,fallback_template_id,already_present_policy,unavailable_policy,presentation}` | Compiled worldpack | Generalize as the only stocking algorithm family. Presentation stays non-authoritative. |
| `LootAllocationState.{schema_version,id,job_id,quest_template_id,table_id,table_version,replay_version,pack_id,pack_version,rules_profile,completion_event_seq,allocation_event_seq,roll_seed,roll_input,selected_template_ids,item_ids,allocation_policy,destination_kind,destination_id,recipient_actor_id,location_id}` | Journaled deterministic receipt | Reuse as the model for `DiscoveryReceipt v1`; never discard or recompute an existing selection. |

### Clocks, Pressure, settlement, and rest

| Existing field/state | Current authority | Migration disposition |
| --- | --- | --- |
| `ClockState.{id,scope,scope_id,kind,zone,label,segments,filled,visible_to_players,status,presentation,on_fill,recent_contributions,completion,created_event_seq,updated_event_seq}` | Journaled clock state | Retain. `Pressure v1` may bind existing progress/danger clocks only for layered situations; a clock never stocks hidden truth or replaces a Gate/Hazard descriptor. |
| `JobState.{pack_id,id,premise,stakes,location_ids,participant_ids,progress_clock_id,danger_clock_id,status,reward,consequence,memory_summary,action_copy,contribution_schema_version,contribution_strategies,narrated_thresholds,delivery,loot,focused_profile,focused_encounter}` | Journaled project state | Retain. Pressure may reuse strategies and clocks; reward/loot still requires its existing typed commit and receipt. |
| Focused encounter `objective_clock_id`, optional `danger_clock_id`, `pressure_trigger`, participant order, round/current actor, completion/stop/retreat predicates, and profile/version | Server projection over journaled combat/project state | Retain as ordered-scene binding. Objective and danger IDs reference ordinary `ClockState`; they do not create a fourth table class or let a scene reroll hidden truth. |
| Room sheet `safety`/`zone`, generated-place connection/settlement jobs, and pathway familiarity job/clock | Compiled seed plus journaled state | Keep separate from discovery and Anchor state. Only their own versioned transitions may alter sanctuary, settlement, or familiarity. |
| `SeedRoomFeatureContent.lodging.gate.kind`, equipped `camp_shelter`, and kernel `CW_REST_GRADE_{CAMP,LODGED,HEARTH}` | Compiled eligibility plus kernel rest authority | Retain ADR 0004 exactly. Anchor/cairn/Mark/Lead/familiarity never grants a rest grade. |
| `tired`, `trained_since_rest`, `frontier_travel_since_rest:*`, rest actions, item recovery profiles, and expedition projection | Kernel/journal compatibility state | Retain historical meaning. #603 owns any new cadence/fatigue state and must use append-only versions. |

### Action and replay compatibility

| Historical operation | Compatibility law |
| --- | --- |
| `CW_ACTION_ABILITY_CHECK` (4) | Legacy generic checks replay unchanged; they do not become focused Notice, Gate, or Hazard receipts. |
| `CW_ACTION_SEARCH` (13) | Legacy hidden-item and `scout_v1` Search records replay unchanged, including their existing projection mutations. |
| `CW_ACTION_RULES_SEARCH` (21) and `CW_ACTION_RULES_STUDY` (22) | Keep their current learn-once claim semantics. New focused Notice/Search/Study bind exact Slots and descriptors through append-only procedure versions. |
| `CW_ACTION_UNLOCK_EXIT` (28) | Keep historical lock clearing. New Gate transitions must not reinterpret its evidence or scope. |
| `CW_ACTION_REVEAL_ITEM` (29) | Keep historical item reveal. Reveal remains separate from Open, Take, equip, and use. |
| Existing hidden-exit chance, route discovery, local Lead, loot, clock, rest, cairn, and Scout events | Remain readable and reconstruct their original state. Migration may emit explicit compatibility projections but cannot reroll, re-award, add a consequence, or newly authorize behavior. |

Snapshots and event exports continue to carry canonical content context. New
descriptors and receipts must be append-only, pack/version bound, and
self-describing enough to inspect after active content changes. Unknown
versions fail closed for new execution while historical records remain
inspectable.

## Consequences

- #600 can define one bounded Slot/receipt contract without deciding player
  verbs or inventing another loot algorithm.
- #588 can define Lead, Gate, Hazard, Pressure, and Anchor descriptors against
  explicit ownership boundaries.
- #601 can unify discovery procedures without coupling reveal to Open, Take,
  or Travel.
- Route, item, rest, and generated-place migrations have an explicit source
  inventory and compatibility disposition.
- Cairns and Signal Anchors gain one shared navigation meaning without
  becoming shelter, settlement, or a universal visual noun.
- Content validation can reject null commits, rerolls, untelegraphed Hazards,
  unbounded required discovery, and unrecoverable progression before runtime.

## References

- [Thresholds, trails, and the strict referee backlog](../backlog/thresholds-trails-and-strict-referee.md)
- [CosyWorld RPG System Bible](../systems/09-cosyworld-rpg-system.md)
- [SRD-backed action and collectible system](../systems/04-action-system.md)
- [ADR 0004: rest grades and expedition depth](0004-rest-grades-and-expedition-depth.md)
- [Worldpacks](../../v2/docs/worldpacks.md)
