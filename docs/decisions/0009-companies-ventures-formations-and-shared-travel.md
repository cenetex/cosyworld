# ADR 0009: companies, ventures, formations, and shared travel

- Status: Accepted design; implementation staged behind current P1 work
- Date: 2026-08-12
- Decision owners: CosyWorld maintainers
- Related: ADR 0002, ADR 0003, ADR 0004, ADR 0005,
  `docs/cosyworld-dungeons.md`

## Context

CosyWorld has authoritative actors, rooms, routes, generated pathway segments,
individual journey cursors, vehicles as world fiction, and a room-scoped
transcript. The browser can project an individual journey as a destination,
way name, segmented progress bar, and a travelling-party treatment.

The hosted runtime also has bounded **rendezvous party** records created by
invites. They are temporary social state for meeting at one canonical location.
They grant no access and drive no movement. Their historical `party` name does
not make them a Company or Venture.

That presentation does not yet make a party true. Current journey state belongs
to one actor. The faces in the journey treatment are the actors presently
visible in that actor's room, and conversation remains room-scoped. Two actors
standing together may have different destinations and journey cursors. A
resident encountered on the road may appear in the treatment without having
agreed to travel, while a companion who does not take the same movement action
may be left behind.

Making a vehicle create the party does not solve this:

- strangers can ride the same carriage without sharing a purpose;
- one company can travel on several mounts or jetskis;
- a walking group has no vehicle;
- a ship can contain crew, passengers, guests, and an away party with different
  commitments; and
- a dungeon delve needs a party after its carriage or ship has been left at the
  threshold.

Travel also cannot be reduced to a percentage bar. A known road, an uncertain
sea crossing, and a branching dungeon expose different information and demand
different progress projections.

## Decision

CosyWorld separates **Company**, **Venture**, **Formation**, **Vehicle**, and
**world structure**. These are independent authoritative facts.

> A Company undertakes a Venture, adopts a Formation, and moves through
> persistent places together.

The player-facing word **party** means the members of a Company currently
committed to the active Venture. Co-presence, common transport, friendship, and
party membership are related but never interchangeable.

### Company: who has chosen to act together

A Company is a durable social entity. It has a stable identity, members,
membership history, a shared chronicle, and optional shared custody or
resources established through explicit world actions.

Membership is consensual and graded:

| Relationship | Duration and authority |
| --- | --- |
| **Accompany** | Join one leg or bounded local undertaking. |
| **Join Venture** | Remain with the active Venture until completion, departure, or explicit withdrawal. |
| **Join Company** | Become a persistent member across Ventures. |
| **Guest or passenger** | Share a place or vehicle without receiving Company membership or decision authority. |

Being in the same room, boarding the same vehicle, following the same route, or
holding a Bond never silently creates membership. Company membership grants no
location access, item ownership, controller authority, or exemption from a
Gate. Every such entitlement remains independently authored and validated.

The Company is an internal system identity, not an eighth global player noun.
The ordinary interface may say **your party**, **your friends**, or use the
Company's chosen name when context makes the meaning obvious.

Companies may include direct-input avatars, inference-controlled residents,
linked avatars, and other actors permitted by the active rules profile.
Controller kind never changes membership effects. A direct-input actor joins
through authenticated consent; an inference-controlled actor accepts only
through a certified legal decision grounded in authored state. Generated
dialogue may express that decision but cannot create it.

### Venture: what the party has agreed to do

A Venture is a bounded shared undertaking with an objective, participants,
current phase, history, and completion or abandonment condition. Examples
include reaching Emmaus, carrying medicine, escorting a resident, recovering a
bell, crossing open water, or exploring a ruin.

This entity instantiates the existing **Venture** function in CosyWorld's tale
grammar; it does not introduce an unrelated use of the word. Solo Ventures
remain valid. A party Venture adds an explicit participant set and shared
transition state rather than changing what Venture means in a tale.

A Company may exist without an active Venture. One Venture can outlive several
routes and Formations: its members might begin on foot, hire a carriage,
continue by boat, and enter a dungeon without creating four unrelated stories.

Arrival may complete a journey phase without completing the Venture. The
delivery, meeting, rescue, discovery, or Return that gave the travel meaning
still has to resolve.

### Formation: how the party is presently operating

Formation is the shared movement and operating contract. It supports zero, one,
or several vehicles without pretending that walking is a vehicle.

| Formation | Characteristic facts |
| --- | --- |
| **Walking group** | pace, fatigue, visibility, carried gear, ability to leave the path |
| **Carriage** | vehicle, driver, seats, cargo, road dependency, condition |
| **Jetski flotilla** | multiple vehicles, riders, fuel, water access, cohesion range |
| **Ship's company** | vessel, stations, cargo, crew roles, interior rooms, sea capability |
| **Delve formation** | marching order, light, noise, carried supplies, retreat chain |
| **Scattered** | members are separated and cannot resolve a group transition as one |

Changing Formation does not dissolve the Company or Venture. Formation roles
are contextual responsibilities, not permanent rank or compulsory leadership.

### Vehicles remain world objects

A vehicle is a physical entity or composed set of entities with location,
capacity, condition, custody, capabilities, cargo, and possibly interior
locations. Vehicles can be named, repaired, upgraded, borrowed, stolen, lost,
or left behind.

A vehicle may host Company members, guests, passengers, prisoners, crew, and
unaffiliated travelers at the same time. Boarding authorizes only occupancy
permitted by the vehicle's current Gate; it does not create a party.

Large vehicles such as pirate ships may be mobile places and homes. Their crew
or covenant can be durable social structures, but the active party remains the
subset explicitly committed to the Venture.

### Departure and shared movement require consent

One actor cannot move another actor merely by pressing Travel. Shared departure
uses a replayable consent handshake:

1. one member proposes the next leg, route, pace, or Formation;
2. eligible members explicitly become ready, decline, or leave the departing
   party;
3. one committed Venture transition moves the ready party and its authorized
   vehicles or creates the next shared situation; and
4. anyone who did not authorize departure remains in a truthful world location.

An absent member cannot hold the room hostage. The ready subset may depart,
forming a temporary detachment or continuing the Venture without the absent
member according to the proposal shown before commitment. No wall-clock timeout
mutates membership or position.

The transition is atomic for its declared participants. It is not a race in
which each actor must independently draw and play the same Travel card before
the world changes.

The unit of shared movement is a **leg**: one consequential Venture beat with a
declared route or heading, Formation, pace when relevant, participants, known
cost, and known risk. Resolving a leg may advance, arrive, expose a situation,
force camp, damage or strand a vehicle, consume an authorized resource, or
separate a detachment. Scout remains a distinct discovery action when the way
is genuinely unknown; it must not become a mandatory reveal click before every
otherwise routine leg.

Company resources are never inferred by pooling member inventories. A supply
is shared only through explicit Company custody, authorized vehicle storage, or
another represented world relation. The leg preview names exactly which
resource or holder can be affected.

### Company conversation and local conversation are distinct

A Company owns a durable Venture chronicle and may own a conversation channel
when the current fiction and capabilities permit communication. It is an
authoritative shared event stream with an explicit audience, never a private
per-player AI response.

Local speech remains spatial. Nearby non-members can witness speech made in
their location. A separated detachment does not hear distant Company members
unless a device, ability, vehicle system, or other authored capability permits
it. The interface must not relabel a room transcript as party conversation when
the server has not projected Company membership and channel scope.

### Progress belongs to the Venture

Progress presentation is selected from authoritative knowledge rather than
forced into one universal percentage:

| Venture situation | Honest projection |
| --- | --- |
| Known segmented route | completed legs, current leg, remaining known legs |
| Unexplored route | revealed return chain, current Lead, uncertainty; no false total |
| Open water or air | heading, known landmarks, supplies, condition, estimated arrival when justified |
| Dungeon delve | current site, discovered branches, depth, objective evidence, and safe retreat chain |
| Delivery or pilgrimage | story milestones that may continue after geographic arrival |

Preparation, setbacks, camps, separation, repair, route decisions, and arrival
are Venture beats. A progress bar that counts only one actor's movement is not a
party-progress projection.

### Dungeons are Ventures through sites, not trails in disguise

A dungeon is a persistent branching site graph. A Company normally enters it
on a **Delve Venture** and adopts a **Delve Formation**. The useful questions
are where the party is, what branches are known, what constrains them, what the
objective requires, and whether the entrance or another refuge remains
reachable.

Dungeon progress therefore does not claim a known completion percentage. A
detachment that scouts another site remains part of the Company but has its own
location, local transcript, known return chain, and immediate action context.
Rejoining, losing contact, rescuing, and extracting are recorded events.

### Pathway development is not party development

Pathways remain durable geography governed by ADR 0005. Their names describe
the way, not the destination: `Emmaus` is a place while `Road to Emmaus` can be
a developed pathway presentation.

Repeated traversal may establish use and familiarity, but infrastructure must
reflect its cause:

- use can wear an unmarked way into a track or trail;
- wayfinding work can establish cairns and marked paths;
- construction and stewardship can establish and maintain roads; and
- high-capacity ways require sustained traffic plus appropriate investment.

Route length must not cause a way to develop faster merely because one journey
emits more per-edge movement events. The adopted progression contract must
normalize its evidence per traversal or leg and keep physical improvement
separate from social Company state.

### Authority, replay, and projection

Company, Venture, membership, readiness, Formation, detachment, vehicle
occupancy, and shared transition state are server-authoritative. Deterministic
movement and physical custody continue to cross the kernel boundary. Every
membership or movement transition has a versioned action/receipt, explicit
participants, state revision, and idempotency identity, and survives journal
replay and snapshot round trips.

The client projects these facts. It never infers the party from actors in the
room, assumes passengers are members, moves companions optimistically, invents
a shared channel, or estimates hidden distance as known progress.

## Current implementation boundary

The shipped journey cursor and progress strip remain an individual travel
projection. They are useful orientation but are not the Company/Venture system
accepted here. Until the authoritative contracts land:

- `JourneyState` remains actor-scoped;
- visible co-present actors are not certified party members;
- the transcript remains room-scoped;
- each actor moves independently; and
- route traffic classification remains the existing compatibility behavior.

Documentation and UI copy must not imply stronger shared-party authority than
the server provides.

Existing rendezvous-party records retain their social-only meaning. They may
seed an explicit invitation to form or join a Company, but replay never upgrades
them automatically and no historical Follow action gains shared movement.

## Amendment (2026-09-27): Accompany v1 before Company identity

Status: Accepted. This section narrows, and does not replace, the design above.

The first shared-movement slice ships ahead of step 1 of the delivery sequence
as a deliberately transient case: **one player travels one leg together with
one bonded resident**. No Company, Venture, or Formation record is created, so
nothing here claims Company membership, a durable party, or a shared channel.

### The move

- The Story Hand combination is **Avatar + Location**: selecting a resident's
  Avatar card and an adjacent destination's Location card resolves to the exact
  sentence "Travel with ⟨resident⟩ to ⟨place⟩". The offer belongs to the
  destination Location card and targets the resident Avatar card, so both
  selected nouns are used (Story Hand rules 2 and 3). A plain move never claims
  that pair, and Accompany never claims a single Location card.
- One new append-only kernel action, `CW_ACTION_ACCOMPANY_MOVE` (42), carries
  the proposer (`actor_id`), the companion (`target_actor_id`), the origin
  (`location_id`), and the destination (`destination_location_id`). The kernel
  requires both actors active and co-located, a direct exit, and no gate or
  lock on it; then it moves both and emits one `actor.moved` event for each.
  The companion's event carries reason `accompanied` and the proposer as its
  target. Either both move or neither does, as the atomic-transition rule
  above requires; like `CW_ACTION_COMPLETE_AVATAR_RESCUE`, it is one replayable
  transition over several actors.
- It is a committed card: it consumes the proposer's room turn under the fixed
  turn taxonomy. The companion's move is part of the same action and spends
  none of the companion's resident budget.

### Consent

The companion is an inference-controlled resident, so consent is a certified
decision from authored state, evaluated when the offer is built and again at
commit, never from generated dialogue. A resident accepts only when all hold:

- its control mode is `local_ai`, `roaming_ai`, or `delegated_ai`;
- it is not in an encounter, resting, knocked out, suspended, or mid-rescue;
- the proposer holds a Bond to it whose status is `forming` or `active`; and
- it has no active journey of its own.

When the rule fails, no offer exists; the combination resolves to nothing
rather than to a refused sentence. Direct-input actors (other players, and any
linked avatar a holder is controlling) are never companions in v1; they need
the consent handshake of step 3.

### Deliberate limits

- **Ungated, unlocked exits only.** Gates evaluate one actor's access, and one
  action carries one threshold proof. Crossing a Gate together needs a proof per
  participant and waits for the Formation work.
- **One adjacent leg.** Multi-leg journeys stay actor-scoped
  (`MovementPlan::Journey`); no Accompany offer appears while either actor has
  an active journey.
- **No encounters.** No offer while either actor is in an initiative scene.
- **No staying together.** After arrival the companion is an ordinary resident
  again and may roam away on a later ripple. Keeping company is Company state.
- **Honest presentation.** The client shows the public accompanied event. It
  does not label the companion "your party" or change the journey strip.

### Replay, traffic, and compatibility

- Pathway traffic counts one traversal per leg: `accompanied` moves are
  excluded from traffic evidence, so a shared leg develops a way exactly as much
  as a solo one.
- Historical journals contain no action 42, so their replay is unchanged. Code
  41 stays reserved: the first Abandon Avatar release journalled it, and replay
  keeps those rejected rows as settled no-ops.
  Historical Follow and rendezvous-party records keep their original meaning.
- Every Accompany record names its participants, origin, and destination, so a
  later Company can adopt shared legs without reinterpreting history.

### Tests required before merge

- Kernel: both move; each refusal (not co-located, no exit, gate, lock,
  inactive companion) leaves both in place; events carry the accompanied
  reason.
- Server: the offer exists only for bonded, free, co-located residents across
  ungated adjacent exits; it resolves from exactly Avatar + Location; a stale
  or re-targeted submission fails without mutation; replay and snapshot
  restore reproduce positions; one leg adds one unit of traffic.
- Browser smoke: the combination shows the partner highlight and the exact
  sentence, and the transcript shows the accompanied event.

## Delivery sequence

1. **Company identity and consent.** Persist Company membership, invitations,
   guests, withdrawal, moderation, replay, and snapshot behavior. Define an
   explicit bridge from live rendezvous parties without reinterpreting their
   historical records.
2. **Venture and party projection.** Persist one active shared undertaking and
   expose its exact participant subset, objective, phase, and chronicle.
3. **Formation and departure.** Add readiness, atomic shared transition,
   walking formation, detachments, and no-hostage behavior.
4. **Vehicle occupancy and capability.** Compose one-vehicle and multi-vehicle
   Formations without conflating occupancy and membership.
5. **Honest progress profiles.** Support known-route, uncertain-route, voyage,
   delivery, and Delve projections.
6. **Dungeon integration.** Bind Companies and detachments to semantic site
   graphs, retreat chains, local transcripts, and extraction.
7. **Pathway development revision.** Separate wear, familiarity,
   wayfinding, construction, maintenance, and capacity evidence under an
   explicit replay-compatible migration.

## Acceptance criteria

The shared-party target is not complete until all of these hold:

- two actors can explicitly form a Company and start a Venture, reconnect, and
  recover the same identities after replay and snapshot restoration;
- a third actor can share their room or vehicle as a guest without becoming a
  party member or receiving Company decision authority;
- one proposal displays the exact leg, known risk, Formation, vehicle set, and
  participant set before anyone authorizes departure;
- the ready subset moves atomically while a declining or absent member remains
  at the prior location, with no duplicated actor, vehicle, item, or event;
- a Company can change from walking to one vehicle, several vehicles, and a
  Delve Formation without losing its Venture or chronicle;
- separating a detachment creates truthful site occupancy, local action and
  transcript scopes, communication limits, and a replayable rejoin or rescue;
- known roads, uncertain routes, voyages, and Delves project different honest
  progress shapes, and hidden topology never appears as a fabricated total;
- ordinary local actions remain eligible during travel situations rather than
  collapsing the two-card hand into compulsory Scout/Travel repetition; and
- historical actor journeys, rendezvous parties, Follow events, and route
  traffic replay with their original meaning.

## Non-goals

- Automatically turning co-present actors, friends, passengers, or crew into a
  party.
- Requiring permanent leadership or letting one member command another.
- Making every Company conversation audible across arbitrary distance.
- Treating every Venture as linear, exposing hidden topology, or assigning a
  false completion percentage.
- Replacing ordinary room actions with a travel-only hand.
- Reinterpreting historical actor-scoped journey or traffic events.
- Making AI choose membership, consent, route resolution, or consequences.

## Consequences

- The existing travelling-party presentation is explicitly provisional rather
  than mistaken for authoritative multiplayer state.
- Vehicles can become rich physical and social places without owning party
  identity.
- Walking groups, fleets, ships, and dungeon delves use one composition model.
- Party splitting becomes explicit detachment state rather than accidental
  desynchronization.
- Venture progress can remain honest when distance or topology is unknown.
- Implementation requires new durable state and versioned actions rather than
  a client-only extension of the journey strip.

## References

- [CosyWorld Product Requirements](../../PRD.md)
- [The CosyWorld Pact](../cosyworld-pact.md)
- [A Traveler's Guide To CosyWorld](../travelers-guide.md)
- [CosyWorld:Dungeons](../cosyworld-dungeons.md)
- [ADR 0003: one canonical world](0003-one-canonical-world.md)
- [ADR 0004: rest grades and expedition depth](0004-rest-grades-and-expedition-depth.md)
- [ADR 0005: thresholds, trails, and the strict referee](0005-thresholds-trails-and-strict-referee.md)
