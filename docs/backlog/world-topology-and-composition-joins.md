# World Topology And Composition Joins — Backlog

**Epic**: Give composition data a way to attach one pack's geography to
another's, so every mounted room belongs to one walkable world and a campaign
ending can open a road instead of terminating.

**Status**: Groomed 2026-07-26 and 2026-07-27. This document was cited as
`docs/backlog/world-topology-and-composition-joins.md` by the WT tickets from
the day they were filed but was never actually written; it is reconstructed
here from those issues and their playtest evidence, 2026-07-30. Direction, not
committed scope.

**Prior execution backlog**: epics
[#371](https://github.com/cenetex/cosyworld/issues/371),
[#289](https://github.com/cenetex/cosyworld/issues/289),
[#339](https://github.com/cenetex/cosyworld/issues/339) and children
[#372](https://github.com/cenetex/cosyworld/issues/372)–[#379](https://github.com/cenetex/cosyworld/issues/379),
[#336](https://github.com/cenetex/cosyworld/issues/336), closed into this
document.

| Ticket | Prior issue | Priority |
| --- | --- | --- |
| WT-0 — `routes` in `world.json`, compiled to `exits.json` | [#372](https://github.com/cenetex/cosyworld/issues/372) | P1, foundation |
| WT-1 — pack gateways; routes restricted to them | [#373](https://github.com/cenetex/cosyworld/issues/373) | P1 |
| WT-2 — `open` / `gated` / `earned` access | [#374](https://github.com/cenetex/cosyworld/issues/374) | P1 |
| WT-3 — reachability, sink, and seam-target gates | [#377](https://github.com/cenetex/cosyworld/issues/377) | P1, lands last |
| WT-4 — join the Lantern Keeper; pay the win with a road | [#376](https://github.com/cenetex/cosyworld/issues/376) | P1 |
| WT-5 — give Dark Abyss a way out | [#375](https://github.com/cenetex/cosyworld/issues/375) | P1 |
| WT-6 — know your own doorstep at spawn | [#378](https://github.com/cenetex/cosyworld/issues/378) | P2, independent |
| WT-7 — weight Scout by distance and open seams | [#379](https://github.com/cenetex/cosyworld/issues/379) | P2, independent |
| WT-8 — pack-native generated descendants | [#339](https://github.com/cenetex/cosyworld/issues/339) | P2 |
| WT-9 — Holy Land as a regional pilgrimage mesh | [#336](https://github.com/cenetex/cosyworld/issues/336) | P2, reference fixture |

**Still an open issue**: [#337](https://github.com/cenetex/cosyworld/issues/337)
— declare generation and topology policy in worldpack manifests. It is
`state:ready` and stays in the live queue; WT-8 and WT-9 consume it.

**Related architecture**:

- [The CosyWorld Pact](../cosyworld-pact.md) — "One World, One Truth" and
  "Home Holds" constrain what a join may do.
- [How to Design a Worldpack](../worldpacks/how-to-design-a-worldpack.md)
- [Thresholds, Trails, And The Strict Referee](thresholds-trails-and-strict-referee.md)
  — owns Leads, Gates, Anchors, and Scout forays over this topology.
- `CLAUDE.md`: *"Cross-pack topology belongs in composition data rather than
  either reusable pack."*

---

## Why now

### The missing primitive

`worlds/official/world.json` selects packs and names one `entry_location`. It
**cannot express an edge between two packs**. Intra-pack exits are authored by
the pack owning both endpoints, which is correct — and it means a campaign pack
can only ever be an island unless some pack reaches into another's interior,
which the contributor guide forbids.

The seam is named in `CLAUDE.md` and absent from the schema.

### Measured state

Against `v2/content/official/` at `0.0.196` — 48 locations across 4 packs, 110
authored exits:

| | |
| --- | --- |
| Reachable from `entry_location` | 42 of 48 |
| Unreachable | `800`–`804` (all of `cosyworld.campaign.the-lantern-keeper`), `65` Dark Abyss |
| Sinks | `65` Dark Abyss |

`ruby-high.first-bell` and `cosyworld.the-holy-land` are correctly wired. The
Lantern Keeper is the only disconnected component. Both defects shipped to
production and were found by walking the world by hand.

The live `/world` projection is knowledge-filtered — an actor sees 15 of the 42
reachable rooms — so **undiscovered is not unreachable**, and topology must
never be diagnosed from that projection.

### Not the Cottage

Rejected: The Cosy Cottage as the nexus every region hangs off.

Sanctuary law says home never takes danger or offscreen pressure, and "your
home is exactly as you left it" is a weaker promise when home is also the
transit hall. A star graph is also a level-select screen wearing a room —
distance stops meaning anything and every new pack edits the same room.

Core already has a real map. Regions attach at different nodes of the existing
ring.

---

## The four-layer model

Topology, legibility, and knowledge are separate state. Keep four independent
layers; this is the contract the shipped route work (#316, #317, #318) already
established and everything below preserves.

1. **Authored anchor graph** — locations, cards, ecology, entry points, and
   editorially reviewed places.
2. **Canonical weighted routes** — stable directional edge records, distances,
   ownership, lifecycle, traffic, and ecology transition. Durable shared state.
3. **Generated descendants** — waypoint chains and place prose/media that
   subdivide an authorized route edge, inheriting explicit pack provenance and
   policy. They never invent graph authority.
4. **Actor knowledge** — fog, Leads, and memory. **Never topology authority.**

Corollaries:

- Journeys progress against canonical route IDs and versions.
- Kernel exits are projections of canonical route records.
- Unknown meaningful stretches offer Scout; known open stretches offer Travel.
- Forgetting cannot close or recreate a route.
- Traffic and descriptive evolution never reallocate route identity.

---

## Principles (acceptance gate for every ticket)

1. Cross-pack topology lives in composition data. A reusable pack never reaches
   into another pack's interior.
2. A composition route may attach only at a **declared gateway**.
3. Access kinds come from a closed vocabulary: `open`, `gated`, `earned`.
4. An opened `earned` seam is **world state, not per-actor state**. Once opened
   it is open for everyone, consistent with Scout revealing shared geography.
5. Seam openings are journaled and replayable. A replayed journal reopens the
   seam at the same point in history. No snapshot is required to know a road is
   open, and no client-supplied claim can open one.
6. Generated entities always retain owning pack/composition, parent route,
   prompt version, ecology provenance, and migration version.
7. LLMs propose names, prose, and media prompts only. They cannot create
   topology, access, rewards, economy mutations, or rules.
8. Generated pathways are excluded from reachability checks, so an undiscovered
   authored room is never mistaken for an unreachable one.
9. Packs stay independently mountable. `core-only` and `ruby-high-only` must
   keep booting and must pass every new gate.
10. Bundle identity changes go through the documented persistence path, never by
    erasing a mismatched hash.
11. Legacy packs preserve behaviour until they opt into a versioned policy.

---

## Delivery order

1. WT-0 — the `routes` primitive.
2. WT-1 — gateways.
3. WT-2 — access kinds; `earned` shares the `unlock_exit` seam.
4. WT-5 — give Dark Abyss a way out.
5. WT-4 — join the Lantern Keeper.
6. WT-3 — turn on the gates.

**WT-3 lands last on purpose.** Its rules fail against the world as it stands,
so WT-5 and WT-4 must merge first or the build goes red on arrival.

WT-6 and WT-7 are independent playtest findings from the same session and block
nothing.

---

## WT-0 — Add a routes array to world.json and compile cross-pack edges

**Priority**: P1 — foundation for every ticket below
**Scope**: world schema + `scripts/compile-worldpack.mjs`

### What to do

- Add a `routes` array to the world schema. Endpoints use the canonical
  `pack:location/N` refs that `entry_location` already uses.
- Fields: `id`, `from`, `to`, `direction` (`one_way` | `two_way`), `distance`,
  `access`.
- `compile-worldpack.mjs` resolves refs and emits composition routes into the
  existing `exits.json`, tagged with the composition as `pack_id`.
- Fail closed on an unresolvable endpoint, a duplicate route id, or a route
  whose endpoints are in the same pack — that belongs in the pack, not the
  composition.
- **No runtime change.** The host keeps reading one `exits.json` and learns no
  second edge concept.

### Acceptance

- [ ] A composition route between two packs compiles into `exits.json` and is
      walkable at runtime with no orchestrator change.
- [ ] An unresolvable ref, duplicate id, or same-pack route fails the compile
      with an actionable message.
- [ ] Bundle identity changes are handled through the documented persistence
      path.

---

## WT-1 — Declare pack gateways and restrict routes to them

**Priority**: P1
**Depends on**: WT-0

### What to do

Give every pack a declared front door, and stop compositions wiring themselves
into a pack's interior.

- A pack contributing locations declares one or more `gateways` in `pack.json`.
- A composition route may attach only at a declared gateway; attaching
  elsewhere fails the compile.
- The declaration survives a pack moving to its own repository, per the
  documented pack-extraction path.
- Declare gateways for the four current world/campaign packs.
  `ruby-high.first-bell` should gate at Courtyard (`15`) rather than an
  interior classroom; `cosyworld.campaign.the-lantern-keeper` at Wayside
  Lantern Inn (`800`) and Lantern Tower (`804`).

### Acceptance

- [ ] Every pack contributing locations declares at least one gateway, or
      composition fails closed.
- [ ] A route targeting a non-gateway location is rejected, with the gateway
      list in the message.
- [ ] `core-only` and `ruby-high-only` still boot.

---

## WT-2 — Implement open, gated, and earned route access

**Priority**: P1
**Depends on**: WT-0, WT-1

### What to do

Three ways a route can be closed, drawn from a closed vocabulary.

| Kind | Opens when | Reuses |
| --- | --- | --- |
| `open` | always | — |
| `gated` | the actor holds a named grant or card | existing `required_grant_id` / `required_card_id` on exits |
| `earned` | a named clock fills, or a journaled world event fires | the clock on-fill effect seam |

- `open` and `gated` are presentation and access checks over machinery that
  already exists on exits.
- `earned` needs the authoritative `unlock_exit` op fired from a clock fill.
  This is the **same seam** the clock on-fill work defines — coordinate rather
  than building a parallel path.
- Reject a route naming a clock or grant that does not exist in the
  composition.

### Acceptance

- [ ] A `gated` route is impassable without the grant and passable with it,
      with an actionable reason when refused.
- [ ] Filling the named clock opens an `earned` route as a public, journaled
      world event.
- [ ] Replay reconstructs seam state exactly.
- [ ] No client-supplied claim can open a seam.

---

## WT-3 — Gate composition on reachability, sinks, and seam targets

**Priority**: P1 — **lands last**
**Depends on**: WT-5, WT-4

### What to do

Make an unreachable room a compile error instead of a production discovery.

Four rules in `v2/scripts/check-worldpack.mjs`, run **per composition** so
`core-only` and `ruby-high-only` are covered:

1. **No unreachable component** from `entry_location` across authored plus
   composition edges, ignoring generated pathways.
2. **No sink** — every location can reach the entry component.
3. **Gateway required** for any pack contributing locations.
4. **Seam targets resolve** — a `gated` route names a real grant, an `earned`
   route names a real clock.

Report failures as a room list with pack ids, not a count.

### Ordering

Rules 1 and 2 fail against the world as it stands today. This ticket cannot
land before the defects it catches are fixed.

### Acceptance

- [ ] `npm run v2:worldpack` fails closed on an unreachable component, a sink,
      a missing gateway, or an unresolvable seam target.
- [ ] Each failure names the offending rooms and packs.
- [ ] Generated pathways are excluded from reachability.
- [ ] `core-only` and `ruby-high-only` pass the new gates.

---

## WT-4 — Join the Lantern Keeper and pay the win with a road

**Priority**: P1 — first consumer of the routes primitive
**Depends on**: WT-0, WT-1, WT-2

### The two routes

| | From | To | Access |
| --- | --- | --- | --- |
| in | `cosyworld.core:location/3` Moonlit Trail | `…the-lantern-keeper:location/800` Wayside Lantern Inn | `open`, two-way |
| out | `…the-lantern-keeper:location/804` Lantern Tower | `cosyworld.core:location/35` Circle of the Moon | `earned` on `lantern-keeper.light`, one-way |

A wayside inn belongs on a road, and Moonlit Trail is the road one step past
the garden.

The outbound seam deliberately does **not** return to Moonlit Trail. You arrive
at the Inn from home, finish the campaign, and the relit lantern shows you a
road further out that you could not see before. **The reward for winning is a
new road.**

### Why this shape

It makes the campaign a *region with two entrances* rather than a mode you
leave. Spawning at the Inn stays a fast start; finding it by road is the
open-world path. Same rooms, no mode concept, and the "which game am I in"
question stops needing an answer.

### Scope

- Land both routes in `world.json`.
- Define the `lantern-keeper.light` on-fill effect as the `unlock_exit` that
  opens the outbound road, coordinating with the clock on-fill seam rather than
  adding a second effect path.
- Confirm campaign archetypes survive outside the campaign before the outbound
  seam opens — `mothwood-guide` and `lantern-warden` are level-one archetypes
  balanced against five authored rooms.
- Regenerate the worldpack and commit the bundle with the lock.

### Acceptance

- [ ] A player can walk from The Cosy Cottage to the Wayside Lantern Inn
      without a campaign spawn.
- [ ] Filling `lantern-keeper.light` opens the Lantern Tower road as a public,
      journaled, replayable event.
- [ ] A campaign-born avatar can walk out into core and keep its archetype,
      Calling, and practice.
- [ ] The composition passes the reachability gate with no remaining
      unreachable component.

---

## WT-5 — Give Dark Abyss a way out

**Priority**: P1 — blocks WT-3
**Depends on**: WT-0, WT-1

Dark Abyss (`65`, `cosyworld.core`) is the world's only sink. It has no
outgoing exit: a player who enters cannot leave by travel.

Pick one and record which:

- Give it an exit, or
- Declare it a deliberate one-way place with a documented escape — Flee, rescue
  by another player, or a claimed return — so it is a designed trap rather than
  an accident.

Whichever is chosen must satisfy the no-sink rule in WT-3.

### Acceptance

- [ ] Dark Abyss either reaches the entry component by travel, or its escape is
      authored, journaled, and documented.
- [ ] The no-sink check passes with no exemption list.

---

## WT-6 — Know your own doorstep at spawn

**Priority**: P2 — independent, blocks nothing

A new player should not have to Scout to find the road out of their own house.

### The problem

Found by playing the live world. At The Cosy Cottage — the world's declared
`entry_location` — a fresh avatar's only visible exit is `Homeroom`,
`accessible: false`, needing a Ruby High pass. The authored road east to
Rain-Soft Garden exists in `exits.json` but is hidden behind Scout, so the
entry room reads as a dead end with one locked door.

**The topology is correct. The discovery filter is what makes it look broken.**

### Scope

- The entry location's authored exits are known at spawn.
- Everything past the first ring stays earned through Scout — this is a
  doorstep exemption, not a change to the discovery model.
- Check the same first impression on any composition's entry location, not just
  Core's.

### Acceptance

- [ ] A newly created avatar at the entry location sees at least one accessible
      authored exit before taking any action.
- [ ] Scout still governs discovery everywhere beyond the entry location's own
      exits.
- [ ] The first-session arc no longer opens on a locked expansion door.

---

## WT-7 — Weight Scout proposals by distance and open seams

**Priority**: P2 — independent, blocks nothing

### The problem

Found by playing the live world. Standing in The Cosy Cottage, the offered
pathway action was **"Scout toward Bethlehem"** — a `cosyworld.the-holy-land`
room, across the map, from a cottage garden. The generator is reaching without
regard to graph distance.

### Scope

- Weight scout proposals by graph distance from the actor.
- Never propose a destination across a composition seam that has not opened for
  that actor.
- Keep proposals deterministic and server-owned; this changes ranking, not
  legality.

### Acceptance

- [ ] Scout proposals are drawn from the actor's neighbourhood, and distance is
      inspectable in the offer trace.
- [ ] No proposal crosses an unopened `gated` or `earned` seam.
- [ ] Two clients with the same authoritative state receive the same proposals.

---

## WT-8 — Make generated descendants native to their worldpack

**Priority**: P2
**Depends on**: [#337](https://github.com/cenetex/cosyworld/issues/337)

A worldpack owns not only its authored locations and cards, but also the
routes, waypoints, places, ecology, prompts, and media generated from them.
Generated content remains deterministic, replayable, pack-styled, and
mechanically bounded. The worldpack declares bounded policy; the host owns
credentials, execution, persistence, safety, economy, and authoritative
mechanics.

### Scope

- Consume the versioned generation, media, topology, and cross-pack policy
  declared in manifests (#337).
- Add a generic graph report to worldpack validation: components, degree
  distribution, cycle rank, bridges, articulation impact, weighted diameter,
  ingress/egress, and evacuation.
- Provide a legacy compatibility profile and an explicit pack-policy migration.

### Acceptance

- [ ] Two worldpacks with different topology and media profiles mount together
      safely.
- [ ] Each pack's generated descendants inherit the correct identity, ecology,
      route, placeholder, and media profile.
- [ ] A cross-pack journey cannot silently default generated content to Core.
- [ ] Discovery, funding, generation, failure, restart, ready, pack upgrade,
      and pack removal are covered by replay fixtures.
- [ ] Topology validation applies profile-appropriate constraints rather than
      imposing one map shape on every pack.
- [ ] Provider credentials and arbitrary external requests never come from
      untrusted pack data.
- [ ] Cross-pack routes explicitly resolve ownership, ecology, style, unmount,
      and evacuation.
- [ ] Full replay and mount-order fixtures produce identical IDs, ownership,
      route state, and media state.

---

## WT-9 — Expand Holy Land as a resilient regional pilgrimage mesh

**Priority**: P2 — the end-to-end reference fixture
**Depends on**: WT-8, #337

### Current graph

The Holy Land pack authors 15 internal location vertices and 15 undirected
route edges (32 directed exit records including the two-way Cosy Cottage ↔
Bethlehem gateway). As an undirected weighted graph:

| Measure | Value |
| --- | --- |
| Connected components | 1 |
| Average degree | 2.0 |
| Independent cycle rank `E − V + 1` | 1 |
| Bridges | 11 of 15 edges |
| Articulation vertices | 8 |
| Weighted diameter | 27 stretches, Caesarea Philippi ↔ Road to Emmaus |

The only substantial loop is Nazareth → Jordan River Crossing → Jericho →
Sychar Well → Nazareth. This is mostly a tree with one four-cycle. Jerusalem is
a useful degree-4 hub, but pure hub-and-spoke expansion would produce
repetitive backtracking and make too much of the map depend on a few
articulation points.

### Target topology constraints

- 24–30 authored anchors in the first expansion.
- Typical anchor degree 2–4; curated hubs may reach 5.
- Major regional hubs have at least two edge-disjoint routes to the backbone.
- Add 6–10 independent cycles rather than one giant ring.
- Bridges reserved for intentional destinations, retreats, and dramatic
  terminal spurs; target no more than 25% of internal edges.
- Removing one ordinary hub must not orphan a large region.
- Weighted shortest paths stay geographically plausible — no teleport-like
  cross-region shortcuts.
- Every loop offers a meaningful distinction (biome, traffic class, story
  function, safety, season, resource), not merely duplicate distance.
- Every new anchor participates in at least two systems or story loops. Density
  matters more than raw map size.

### Regional clusters

Galilee lake mesh · Lower Galilee / Nazareth · Samaria and Jordan corridor ·
Jericho / Judean wilderness · Jerusalem / Mount of Olives local mesh · optional
northern/coastal or Decapolis expansions.

### Suggested motifs

- **Lake ring:** Capernaum ↔ Chorazin ↔ Bethsaida ↔ eastern shore/Decapolis ↔
  Magdala/Sea Shore ↔ Capernaum.
- **Lower Galilee loop:** Nazareth ↔ Cana ↔ Capernaum/Magdala ↔ Nain ↔
  Nazareth.
- **Jordan–Judea loop:** Jordan Crossing ↔ Jericho ↔ Judean Wilderness ↔
  Jerusalem/Bethany ↔ Sychar/Samaria ↔ Jordan Crossing.
- **Jerusalem local ring:** Jerusalem ↔ Mount of Olives ↔ Bethany ↔ Gethsemane
  ↔ Jerusalem.
- Keep Caesarea Philippi, Emmaus, Tyre/Sidon, and selected retreat places as
  purposeful spurs only where the story benefits from a terminus.

### Candidate additions for editorial review

Graph-role candidates, not final historical claims: Magdala, Chorazin, Nain, an
eastern-shore/Decapolis place; Tyre and Sidon as a later optional corridor; a
Samaritan village or road anchor and a Judean-wilderness anchor; Mount of
Olives connecting Jerusalem, Bethany, and Gethsemane; the Emmaus destination
settlement so the existing Road to Emmaus becomes an edge/waypoint identity
rather than a terminal road-shaped location. Traditional or uncertain sites
such as Mount Tabor only with explicit provenance and confidence metadata.

### Acceptance

- [ ] Extend the worldpack schema/content with reviewed locations, ecology,
      route distances, and direction pairs.
- [ ] Preserve the Cosy Cottage ↔ Bethlehem gateway and deterministic replay.
- [ ] Add a topology report to worldpack validation.
- [ ] Meet agreed degree, cycle, bridge, and resilience budgets, or declare
      reviewed exceptions.
- [ ] Generated waypoint chains inherit the owning route's pack, ecology
      transition, art profile, and canonical identity.
- [ ] Browser/journey fixtures prove two genuinely different loop choices and
      successful return travel.
- [ ] Editorial metadata distinguishes textual association, later tradition,
      and geographic uncertainty without presenting disputed identifications as
      certainty.

---

## Appendix: playtest evidence

Recorded from live sessions on lonelyforest.com, 2026-07-25 and 2026-07-26,
against `origin/main` @ `5c9b637` (v0.0.180). These findings motivated the
tickets above and are preserved because they describe *why* route work matters.

### The world is broad and thin

| Measure | Value |
| --- | ---: |
| Locations | 48 |
| Exit records | 110 (~2.3 per room, mostly one-way pairs) |
| Items placed in the world | 17 → 0.35 per room |
| Actors | 56 → ~1.2 per room |

Reachability from The Cosy Cottage:

```
hop 1:  3    hop 5:  5    hop  9: 2
hop 2:  7    hop 6:  3    hop 10: 1
hop 3:  9    hop 7:  1    hop 11: 1
hop 4:  8    hop 8:  1
```

A bulge of 27 rooms in the first four hops, then a corridor one to three rooms
wide for the remaining seven. Almost no loops anywhere.

That shape matters directly: **you cannot get lost in a tree, but you also
cannot learn your way around one.** Familiarity needs redundant paths. Every
journey is currently out-and-back along the same line, which is why the far
half reads as a corridor rather than a place. If route discovery is going to
carry the exploration feel, the near graph probably needs loops before it needs
more destinations.

### Three doors, three tonal worlds, one hop out

From the cottage the immediate choices are Rain-Soft Garden, Homeroom (a high
school), and Bethlehem. No gradient, no sense that the trail gets wilder —
three unrelated registers hanging off one hallway.

### A correction on the job count

An earlier pass reported "six jobs for forty-eight rooms." That counted
**authored** jobs in `v2/content/official/jobs.json` only; the live world also
creates jobs at runtime that appear in no content file. Standing in Rain-Soft
Garden, `/state` returns two live generated jobs and four clocks. The
generative machinery is working and the world is less content-starved than that
figure implied.

What survives the correction: **the Cosy Cottage itself returns `jobs: none`.**
The starting room, the best-authored room in the world, has nothing to work on
— only Take, Search, Notice, and Ask.

### The shared-question structure is very good

The strongest content shape observed in the codebase, worth preserving as a
model:

```
"Can we make the washed garden path trustworthy before the next visitor?"
  situation  Rain has hidden the first stepping stones and left the drain
             carrying water across the path.
  stakes     Someone following the blurred edge could lose the safe way toward
             the river.
  outcome    The first stones show clearly again and leave a trustworthy lead
             toward the riverside.
  next       "The first stone shows through the wash, giving the next visitor
             one honest footing."
  strategies inspect the stones (check) · clear the drain (work) ·
             lift the stones together (help)
```

The third strategy is correctly marked unavailable — *"Its target is not
reachable from here yet"* — because it needs another traveller. That is the
co-presence design working, stated in fiction, with an honest reason. Note that
the outcome text already promises a **lead** as its payoff.

### `Ask for a local lead` resolves and produces no lead

The offer is fully authored: contextual offer
`cosyworld.core:cottage-ask-local-lead`, resolver `influence_v1`, target Rati,
claim key `influence:{actor}:1001:local-lead`, with a declared effect — *"asks
Rati to share one useful local lead; allowed outcomes are cooperates or
declines."*

Invoking it succeeds:

```
POST /actions/influence {target_actor_id: 1001}  → ok
event: "Rati cooperates: the authored request was to share one useful local lead."
```

And then nothing. No exit revealed, no offer added, no room memory, no route
knowledge. Offers before and after are byte-identical. **Rati cooperates and
tells you nothing.**

Treat the lead verb as *existing and empty* rather than as something to design
from scratch.

### Clocks that fill to an invisible tag

```json
{ "id": "lantern-keeper.light", "scope": "room", "scope_id": 804,
  "zone": "frontier", "label": "Rekindle the Beacon", "segments": 6 }
```

Six segments of contribution, and its only effect in `lifecycle_hooks.json` is
`set_tag → room:804:beacon_rekindled`. An invisible tag. This is not specific to
the beacon: **all 12 clocks in the official world set tags and do nothing
else**, while `UnlockExit` and `RevealItem` landed as authoritative on-fill ops
with no content consumer.

Room 804 sits inside the unreachable Lantern Keeper component, which is what
makes the beacon the natural first vertical slice for WT-4: the beacon is the
lead, lighting it is the reach, and `unlock_exit` is the arrival.

A competing `lantern-keeper.darkness` clock on the same room fills to
`set_tag → room:804:black_beacon`. Light versus dark is already contested on
room 804 — it simply has no stakes on either side. **Constraint on that half:**
decay must advance on played ticks, never wall clock. A beacon that dims while
nobody is playing would be offline pressure, which sanctuary law forbids.

### The command parser does not reach advertised commands

`ask for a local lead` via `/commands` returns **404**, even though the offer
advertises `"command": "ask for a local lead"`. The direct `/actions/influence`
route works. Worth checking whether other advertised command strings are
similarly unroutable.
