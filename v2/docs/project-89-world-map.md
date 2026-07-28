# Project 89 three-ring world map

Status: proposed topology and progression contract.

## Shape

Project 89 expands through three concentric rings. Authorship decreases as the
player moves outward, but deterministic world authority does not:

| Ring | Name                 | Stable authored content                                                                   | Generated content                                                             |
| ---- | -------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1    | Operation Loop       | Nine locations, every route, resident, mission, lock, consequence, and reward             | None                                                                          |
| 2    | Perimeter Relay      | Eight anchor locations, four boundary beacons, encounter and ecology tables               | The pathway and its persisted waypoints between each adjacent pair of anchors |
| 3    | Open Signal Frontier | Four sanctuary hubs, services, faction rules, biome palettes, encounter and reward tables | Every route, waypoint, and non-hub place beyond the hubs                      |

The rings are shared world topology, not private wallet instances. The first
valid exploration may discover a place for the active world shard; later
travelers encounter the same journaled place.

```text
                         RING 3 — OPEN SIGNAL FRONTIER

              Archive Meridian             Chimera Reach
                       \                     /
                generated places, routes, and junctions
                       /                     \
          Rabbit Signal Freeport       Green Loom Expanse

                         RING 2 — PERIMETER RELAY

              Loomwatch — Echo — Glass Static — Spillway
                 |       generated pathways       |
          Signal Orchard — Rabbit — Memory Delta — Boneyard

                         RING 1 — OPERATION LOOP

       Threshold — Safehouse — Archives — Meme Farm — Tower
           |                                          |
       Market — Chimera Lab — Green Loom — Engine ———
```

Every apparent edge in Ring 1 is authored. Every edge between adjacent Ring 2
anchors is a generated pathway whose endpoints and constraints are authored.
The four Ring 3 hubs are authored; topology beyond their gates is generated.

## Ring 1: Operation Loop

Ring 1 uses the existing Operation Liberation locations as one complete cycle:

```text
Threshold Interface
  -> Sector 89 Safehouse
  -> 89 Archives
  -> Meme Farm 17
  -> Oneirocom Tower
  -> Convergence Engine
  -> Green Loom Assembly
  -> Project Chimera Lab
  -> Interference Market
  -> Threshold Interface
```

The topology is a loop even while story locks temporarily close individual
edges. Authored mission chords preserve alternate approaches:

- Safehouse to Interference Market opens the equipment route;
- Interference Market to Meme Farm 17 opens after the archive lead; and
- Project Chimera Lab to Oneirocom Tower opens with the access spine.

These chords are never the only safe return route. Completing the engine
resolution and recording its consequence at Green Loom Assembly sets the
journaled `project89.inner_loop_liberated` world flag.

That flag unlocks the first route to Ring 2. It is never derived from NFT
rarity, a generated description, an AI decision, or an Orb payment.

## Ring 2: Perimeter Relay

Ring 2 has eight authored anchors:

| Position  | Anchor               | Authored identity                          | Adjacent path character               |
| --------- | -------------------- | ------------------------------------------ | ------------------------------------- |
| North     | Echo Observatory     | Long-range listening and old transmissions | Cold antenna ridges and aurora static |
| Northeast | Glass Static Gardens | Crystalline signal ecology                 | Reflective terraces and broken light  |
| East      | Oneirocom Spillway   | Escaped convergence infrastructure         | Flooded conduits and dream residue    |
| Southeast | Chimera Boneyard     | Dormant construct remains                  | Ferric flats and machine skeletons    |
| South     | Memory Delta         | Recovered memories becoming shared history | Braided luminous channels             |
| Southwest | White Rabbit Commons | Messengers, camps, and mutual aid          | Improvised relays and footpaths       |
| West      | Signal Orchard       | Living transmitters and repair practice    | Teal groves and resonant fruit        |
| Northwest | Loomwatch Causeway   | Boundary maintenance and weather watch     | Woven bridges and high mist           |

The anchors never move and their rules are fully authored. Each connection
between adjacent anchors uses the Holy Land pathway pattern:

- endpoint ecology and authored descriptions constrain generation;
- a deterministic route seed fixes segment count and content;
- generated waypoints are validated and committed atomically;
- retrying the same route returns the same descendants;
- descendants are owned by the source route and freeze safely if the pack is
  unavailable; and
- prose, art, and scenery cannot introduce mechanics, unlocks, rewards, or
  canon facts.

The first Ring 2 entry is Green Loom Assembly to Memory Delta. Completing each
quarter of the relay stabilizes one authored boundary beacon:

| Beacon | Ring 2 requirement                     | Ring 3 hub opened      |
| ------ | -------------------------------------- | ---------------------- |
| North  | Reach and stabilize Echo Observatory   | Archive Meridian       |
| East   | Reach and stabilize Oneirocom Spillway | Chimera Reach          |
| South  | Reach and stabilize Memory Delta       | Green Loom Expanse     |
| West   | Reach and stabilize Signal Orchard     | Rabbit Signal Freeport |

A player can enter Ring 3 after stabilizing any one beacon. Closing the entire
Ring 2 circuit sets `project89.perimeter_complete`, opens safe authored
backlinks from all four cardinal anchors to Ring 1, and permits generated
frontiers from different hubs to meet. It is not required before initial
outer exploration.

## Ring 3: Open Signal Frontier

The four hubs are permanent sanctuary roots:

| Hub                    | Function                                                  | Frontier palette                                                |
| ---------------------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| Archive Meridian       | Research, recovered history, map index, north return gate | Ruined observatories, cold signal weather, buried archives      |
| Chimera Reach          | Construct repair, salvage, east return gate               | Industrial remains, machine ecologies, unstable fabrication     |
| Green Loom Expanse     | Healing, cultivation, south return gate                   | Restored wetlands, living circuits, cooperative settlements     |
| Rabbit Signal Freeport | Trade, rumors, dispatch, west return gate                 | Relay towns, moving caravans, improvised communication networks |

Everything outside those hubs is generated lazily by an explicit
`survey_frontier` action. One action proposes one bounded expansion from a
declared route slot. The seed includes:

```text
world_shard
generation_policy_version
source_hub_or_place
route_slot
direction
frontier_epoch
```

The validator must prove that the expansion:

- remains in the Project 89 collision namespace;
- has exactly one durable parent route and at least one return path;
- obeys the source biome, terrain, resource, and faction tables;
- stays within degree, distance, cycle, bridge, and active-place budgets;
- uses only authored affordances, encounter templates, items, and rewards;
- cannot create a sanctuary, unique mission key, NFT effect, Orb spend, or
  cross-pack exit; and
- commits its route, places, prose, and placeholder media as one journaled
  result.

The initial engineering budget is 89 active generated frontier places per
world shard and frontier epoch. Reaching the cap stops expansion cleanly; it
does not delete discovered places. A declared migration or authored world
event may open a new epoch while preserving the old frontier.

When expansion fronts from two unlocked hubs meet, the topology validator may
accept one persisted junction. The junction blends the two endpoint ecology
profiles but does not merge faction rules or invent a new authority.

## Discovery and safety

- Unexplored exits show the common unexplored placeholder and never block
  movement on image generation.
- P89/FLUX.1 creates a discovered place's base landscape. FLUX.2 may clean,
  refine, or compose it from approved references. Failed media leaves the
  placeholder and never rolls back topology.
- Every generated branch retains a route to its authored hub. Evacuation
  returns actors to that hub at the next safe boundary.
- Generated danger may use authored encounter tables. Generated prose cannot
  decide that an encounter exists or select its reward.
- Discovering a place costs an authored in-world survey action or resource,
  not Orbs. Orbs remain cosmetic redraw currency.
- Proxim8 agents may independently volunteer to scout a legal frontier route,
  but the holder or another authorized actor must accept the authored survey
  action before new topology is committed.
- Project 89 never builds a cairn. Its generated-place anchor action is
  **Scan the sector**, and the durable result is a teal-and-coral **Signal
  Anchor** calibrated beside one locally significant landmark.
- A Signal Anchor is shared world infrastructure, not inventory. It registers
  the place for return navigation and future authored services but cannot
  create a route, reward, faction, sanctuary, or unlock.
- Faction modules may extend an online Signal Anchor only through authored
  projects with typed effects and visible provenance. Oneirocom telemetry must
  be disclosed rather than hidden in a cosmetic description.

## Art coverage

Ring 1 locations, all eight Ring 2 anchors, and all four Ring 3 hubs receive
reviewed permanent art during pack authoring. Ring 2 pathways and Ring 3
frontier places use the same registered two-stage visual pipeline:

1. P89/FLUX.1 with the exact `P89, anime style,` prefix and LoRA scale `1.0`
   creates the basic environment.
2. FLUX.2 performs artifact cleanup, refinement, or approved-reference
   composition.

Location art is shared by the world place. It is never regenerated per wallet,
visitor, or Proxim8.

Signal Anchor presentation uses the same frozen Project 89 palette and may be
composed into a generated place only after the anchor action commits. Media
failure leaves the common fixture placeholder online and never blocks travel,
mapping, or later service attachment.

The first cross-system study of how this topology supports characters,
factions, economics, special items, and dynamic evolution lives in
[`../../docs/worldpacks/project-89-systems-study.md`](../../docs/worldpacks/project-89-systems-study.md).
That study is tentative and keeps proposed faction structures separate from
approved canon.
