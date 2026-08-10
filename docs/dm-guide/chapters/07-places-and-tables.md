::: {.chapter}

# Part VII: Places, Dungeons, and Tables {#part-places-tables}

## 27. Places That Remember {#places-that-remember}

A place is not primarily a scenery paragraph. It is a stable situation players
can understand, revisit, and change.

Prepare:

- a memorable sensory identity;
- sanctuary or frontier status;
- visible residents, objects, and exits;
- Leads, Gates, Hazards, and Pressure;
- what committed play can change;
- what persists after departure;
- why returning matters.

Draw places as nodes and routes as edges. Mark existence, discovery, access,
and safety separately.

```text
[Cottage - sanctuary]
          |
[Alder Gate - Anchor] ---> [Known Ridge]
          |
      hidden Lead
          |
[Washout - provisional] --> [Tollhouse - hidden]
          |
      [Old Mill - return route]
```

The engine owns which nodes and edges exist. Discovery changes who can
perceive or use them. Narration cannot add a secret tunnel because it would
improve the story.

A useful adventure graph usually has one clear entrance from safety, one
Anchor, two meaningful choices, a loop or alternate return, a landmark, a
recovery route, and a reason to revisit. Dead ends are useful when they hold
information, a resource, a viewpoint, shelter, or a decision. A paid dead end
containing only "nothing" wastes a turn.

### Bounded hidden topology {#bounded-topology}

::: {.target}
**ACCEPTED TARGET - Location Discovery Slots.** Existing generated routes
already freeze deterministic waypoints. General bounded location-slot
materialization and incremental hidden-graph revelation are not fully shipped.
:::

A location Discovery Slot may fill an authorized part of the graph. It may not
grow the map without limit. Declare:

- permitted parent route or region;
- allowed place types;
- maximum rooms and exits;
- directionality, biome, terrain, and danger range;
- entrance and return requirements;
- required or optional status;
- finite Sign budget;
- referenced encounter and stocking tables.

When first claimed, establish the hidden graph once. Reveal its edges
incrementally. Repeated Scout actions uncover more of that fixed graph; they
never reroll it.

### What makes a dungeon {#what-is-a-dungeon}

A CosyWorld dungeon is a compact frontier place where access, information,
resources, residents, and return routes interact under pressure. It need not
be underground, hostile, or centered on combat. A flooded tollhouse,
abandoned glasshouse, night market, tangled archive, or storm-locked
observatory can be a dungeon.

A strong small dungeon has:

- a purpose connected to someone at Home;
- three to seven significant areas;
- a loop or shortcut;
- a resident, faction, creature, or active force;
- a Gate with more than one method;
- a telegraphed Hazard;
- an optional discovery;
- a safe or stabilizable pause point;
- a consequence carried home.

Every room should ask at least one useful question: What do we risk? What can
we learn? Whom can we help? What can we change? Which route opens? What can we
carry home? What will later visitors find different?

### The Dungeons situation-board motif {#cosyworld-dungeons-motif}

::: {.target}
**PROPOSED MOTIF - Situation boards.** A future spatial projection may make a
dungeon legible as a card-driven board game without adding a second action
system. Until a versioned scene-board schema ships, use this as an authoring
and presentation target rather than runtime law.
:::

The board shows what is currently true. The two-card hand asks what the active
traveler will do about it. The kernel resolves one exact offer, and the Journal
keeps the durable difference.

Draw the board from semantic facts:

- **sites** are significant positions, not arbitrary floor squares;
- **links** connect sites and name whether they are known and accessible;
- **tokens** show visible actors, items, features, and Signs;
- **constraints** explain why a link or relation is blocked;
- **clocks** apply visible changes when their thresholds fill; and
- **memory marks** show public consequences that later visitors can observe.

Isometric coordinates, textures, lighting, and decorative props are
presentation. They do not create position, range, exits, cover, or collision
rules. If the art fails, the same scene remains playable through its semantic
board and exact action offers.

Treat the two dealt cards as one authored fork. Prefer pairs that point toward
different situational futures: route against route, force against
reconciliation, speed against preparation, knowledge against risk, pursuit
against care, or spending against preservation. Two differently worded cards
that leave the board in the same meaningful state are not a useful fork.

Before presenting a pair, make its divergence readable. Highlight the exact
target or relation for each card. Name cost, known risk, expected effect, and
any urgency. Keep discoveries and motives hidden when appropriate, but never
hide a known irreversible commitment.

Do not author free grid movement around the hand. Travel, Scout, Use, Help,
Attack, Defend, Flee, and every other state-changing intention remain exact
server offers. The board gives those cards visible context; it never becomes a
client-side action catalogue.

On return, preserve opened and broken Gates, spent Hazards, removed items,
claims, reactions, cairns, public discoveries, clocks, and Journaled
consequences. Restocking is an authored world event, never a fresh description.

## 28. Tables Without Amnesia {#table-law}

Tables create surprise by selecting among authored possibilities. They do not
license a referee or AI to rewrite reality.

![Stocking tables freeze hidden truth, event tables apply pressure after commitment, and presentation tables vary only expression](assets/diagrams/table-classes.svg)

### Three table classes {#table-classes}

::: {.target}
**ACCEPTED TARGET - Unified procedural tables.** The three classes below are
the authoring model for generalized hidden selection. Current runtime support
is narrower: versioned weighted quest-loot rows provide the established
deterministic substrate.
:::

**Stocking tables** answer: What was already here? They select hidden truth
once, such as optional cache contents, a buried resource, a permitted ruin, a
resident at a station, or a cabinet Hazard.

**Event tables** answer: What changes now because committed play created
pressure? They can introduce an authorized encounter, weaken a Lead, change
weather, damage gear, add tired or strain, or expose a compatible Sign.

**Presentation tables** answer: How can fixed truth be described? They may
vary rain sounds, sentence cadence, or approved wording for an empty cache.
They cannot change quantity, access, position, danger, or reward.

::: {.target}
**ACCEPTED TARGET - One selection, one meaning.** Existing deterministic
quest-loot selections already freeze their version, inputs, result, and
receipt. Discovery Slots extend this contract to each supported hidden
subject: confirm an eligible unclaimed Slot, select once, store the receipt,
materialize bounded hidden state, reveal only what the action permits, and
reject reselection. Media or narration failure never causes a reroll.
:::

An authoritative roll receipt preserves table ID and version, owning pack and
version, authoritative inputs, deterministic seed, selected row, claim or
allocation ID, materialized entity IDs, and any fallback used. It is audit
data, not player prose.

Use stable authoritative inputs. Never seed from wall-clock time, AI output,
player wording, client state, or the order of unrelated requests.

### Choose a useful table shape {#dice-shapes}

::: {.referee}
**REFEREE PRACTICE - Table shapes.** Dice notation is one authoring
convenience. Current runtime supports versioned weighted quest-loot rows.
Generalized table schemas may later encode d6, d12, 2d6, or d66 distributions
as explicit weighted rows. Depletion and countdown patterns require versioned
stateful extensions. Do not invent a second algorithm in narration or client
code.
:::

| Shape           | Use                                                        |
| --------------- | ---------------------------------------------------------- |
| d6 or d12       | A short list where every eligible result is equally likely |
| 2d6             | Common middle results and rare extremes                    |
| d66             | Thirty-six flat keyed entries without a huge die           |
| Weighted rows   | Explicit probabilities or content rarity                   |
| Depletion deck  | Results that should not repeat until a cycle resets        |
| Countdown table | A required result guaranteed within a finite Sign budget   |

Eligibility decides what may appear. Weight decides relative chance among
eligible rows. A winter herb is ineligible in summer, not merely less likely.
A unique item already present is unavailable, not accidentally weight zero.

Every table needs at least one eligible row for every valid input, a
deterministic fallback, quantity bound, already-present policy, unavailable
policy, and version migration rule.

## 29. Location and Event Tables {#location-event-tables}

::: {.target}
**ACCEPTED TARGET - Generalized location and event tables.** The examples in
this chapter specify future table behavior. Until their versioned schemas
ship, use them as bounded authoring models rather than runtime promises.
:::

### River-route location slot {#river-location-table}

This stocking table fills one optional structure beside a river route.

|  d6 | Fixed result                   | Room budget | Required return      |
| --: | ------------------------------ | ----------: | -------------------- |
|   1 | Abandoned ferry shelter        |           1 | Same bank            |
|   2 | Flooded tollhouse              |           3 | Rear embankment      |
|   3 | Reed-cutters' platform         |           2 | Marked boardwalk     |
|   4 | Collapsed glasshouse           |           3 | Broken garden wall   |
|   5 | Old pump station               |           2 | Service ladder       |
|   6 | Exposed ford with no structure |           1 | Ford remains visible |

The slot authorizes no more than three rooms. A generated description cannot
add a fourth by mentioning another doorway. The "no structure" result still
creates a stable, useful crossing.

After choosing a row, use bounded subtype tables only for fields the row
authorizes. For example, a three-room tollhouse may select one layout from a
small list:

|  d6 | Layout                                                          |
| --: | --------------------------------------------------------------- |
| 1-2 | Office loops to a sluice cellar; both return to the arch        |
| 3-4 | Flooded hall connects office and raised store; rear bank exits  |
|   5 | Split stair reaches office and sluice; crawl gap joins them     |
|   6 | Courtyard links office and pump room; roof walk returns to bank |

The subtable cannot change place type, exceed the room budget, remove the
return, or introduce another location slot.

### Contextual frontier event {#contextual-event-table}

Roll only when an authored trigger occurs.

|  d6 | Result family | Required follow-up                                                                                                                                      |
| --: | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Encounter     | Select from actors or forces legal in this region                                                                                                       |
|   2 | Sign          | Expose one unused Sign from an existing Lead                                                                                                            |
|   3 | Environment   | Change terrain, light, weather, access, or position                                                                                                     |
|   4 | Loss          | An eligible expendable resource is spent, or an eligible carried item is dropped, damaged, or separated; required items follow their recovery contracts |
|   5 | Exhaustion    | Tired, strain, delay, or recovery demand; Fatigue applies only during its playtest                                                                      |
|   6 | Discovery     | Advance an eligible existing Discovery Slot                                                                                                             |

The category is not final fiction. "Encounter" points to a bounded local
table. "Discovery" points to an unclaimed compatible slot. If none exists,
use the declared fallback, such as a quiet interval that improves position.

### A 2d6 lead-pressure table {#lead-pressure-table}

This table is for a fading trail after a Scout commitment. The middle is
ordinary; extremes are rare.

|   2d6 | Result                                                                        |
| ----: | ----------------------------------------------------------------------------- |
|     2 | The Lead closes, but a hard Sign points to a recoverable alternate route      |
|   3-4 | Environment worsens; preserve the Lead by spending gear or retreating one leg |
|   5-6 | The next Scout has Limited effect unless the party slows down                 |
|     7 | Quiet interval; the Lead and return chain remain clear                        |
|   8-9 | A fresh Sign strengthens the next Scout                                       |
| 10-11 | Useful ground allows a temporary mark without extra material                  |
|    12 | Landmark revealed; promote the next position if its Gate is satisfied         |

Even the low result does not erase required topology or strand the expedition.

## 30. Loot and Meaningful Rewards {#loot-rewards}

Treasure is anything players bring home because it changes future play or
remembers what happened. It can be an item, recovered community object,
shortcut, permission, Bond, resident aid, room improvement, resource site,
public memory, evidence, or cosmetic object with provenance.

Required objects are fixed. If the adventure concerns a missing bell, the
bell is not one row in a loot table. Optional finds may be random.

### Civic-building cache {#cache-table}

This stocking table fills one optional small cache.

|  d6 | Fixed result                              |
| --: | ----------------------------------------- |
|   1 | Waxed cord and a dry tinder roll          |
|   2 | Repair needle and two brass clasps        |
|   3 | Small flask with one restorative use      |
|   4 | Alder-wood compass charm                  |
|   5 | Folded local map with one additional Sign |
|   6 | Empty, marked with a former keeper's name |

"Empty" is still a result. It gives stable history rather than another roll.
The first resolution freezes the stocking result. Later Search returns known
state; exhaustion or claim timing follows the source's authored reveal,
allocation, or custody policy.

### Required discoveries {#required-discoveries}

Never place required progress behind unrestricted randomness. Use one of:

- fix the required result and randomize optional rewards;
- guarantee it after a bounded number of Signs;
- deplete alternatives until it must appear;
- provide a deterministic fallback when the Sign budget ends.

A finite Sign budget answers how long uncertainty may last. If a required site
has three Signs, the third locates or reveals it. Failure may add danger, cost,
or a worse approach. It cannot erase the required fact.

### Item lifecycle and provenance {#item-lifecycle}

For an important item, write placement, Sign, reveal moment, Gate or Hazard,
Take method, size, capacity cost, capability, charges, claim scope, and loss
recovery. Finding, opening, taking, equipping, and using remain separate.

Capacity makes treasure an expedition choice. A party might leave rope, break
down a bulky object, share the load, return with a container, or mark it for
later. State size before Take. Required bulky objects need telegraphed carrying
methods.

Provenance is a deterministic event record: "Alder Hollow Bell, recovered from
the flooded tollhouse by Mira and Orin after the midsummer storm." AI may
paraphrase that record for presentation but cannot alter it.
:::
