::: {.chapter}

# Part IX: Preparing and Proving Adventures {#part-preparation}

## 36. Prepare in Ten Passes {#ten-passes}

Begin with a need, not a dungeon map. Something is missing, a route has failed,
a promise needs help, a resource is uncertain, a place is changing, or two
groups need incompatible things.

::: {.rule}
**CORE RULE - Current authoring surface.** Versioned Discovery Slots, typed
obstacles, Gate-bound Hazards, and Scout v2 are available when a mounted pack
authors their validated descriptors and procedures.
:::

::: {.target}
**ACCEPTED TARGET - Forward-compatible traversal.** Provisional forays,
temporary Marks, traversed return chains, durable cairns, generalized
Pressure scenes, and complete recovery proof remain accepted authoring
targets. Describing them here does not make those missing transitions
available in the current runtime.
:::

### 1. State the promise {#prep-promise}

Write one sentence about what players get to care about and do.

> Follow the storm's traces from Alder Hollow, recover its return bell, and
> decide what to preserve in the flooded tollhouse.

If that requires improvising authority, narrow it.

### 2. Define Home and return {#prep-home}

Name the sanctuary where the need is heard, its resident or relationship, the
available preparation, the change on return, and what remains unresolved
after success. Return completes the loop; it is not an epilogue.

### 3. Draw the graph {#prep-graph}

Include safe origin, frontier entrance, Anchor, known routes, hidden or
provisional routes, required destination, alternate return, and optional
branch. Mark existence, legibility, access, and safety separately.

### 4. List discoveries {#prep-discoveries}

For each item, route, fact, resident, resource, or location, decide:

- required or optional;
- fixed or table-stocked;
- first Sign and advancing action;
- finite Sign budget;
- reveal scope;
- access method;
- secured condition.

Keep required truth outside optional tables.

### 5. Build obstacles {#prep-obstacles}

Use the smallest composition that works: Lead for a clue, Gate for a locked
door, Hazard for an unstable bridge, Lead plus Pressure for a fading trail,
Gate plus Hazard for a trapped coffer. Use all four parts only for a central
set piece.

### 6. Add pressure {#prep-pressure}

Write the trigger, clock or immediate consequence, what advances it, how it
can be delayed or redirected, its terminal result, and the withdrawal route.
Never attach automatic frontier danger to sanctuary.

### 7. Stock once {#prep-stock}

Give optional slots an eligible bounded table, stable inputs, a fallback,
quantity, and version. Establish required objects directly.

### 8. Prove recovery {#prep-recovery}

Ask whether a return Gate can close, a key can leave, the Fatigue playtest can
remove the required method, a reward can exceed capacity, a Hazard can destroy
the only route, a failed check can consume the only solution, absent AI can
block progress, or concurrent players can race for one claim. Repair the
graph, not the narration.

### 9. Prepare public copy {#prep-copy}

Write the opening need, obvious facts, every Hazard Tell, action requirements,
consequence warnings, deterministic fallback lines, and return memories.
Keep IDs, seeds, tags, and payloads out of player language.

### 10. Define lasting change {#prep-change}

Success should change a shared fact: a bell rings, shortcut opens, resident
moves, room becomes safe, cache empties, Hazard remains broken, Job appears,
or community remembers. Failure should also create a playable future.

## 37. Prove Before Publication {#proof-pass}

Run these cases against the compiled worldpack.

| Case               | Expected result                                                   |
| ------------------ | ----------------------------------------------------------------- |
| Safe competence    | Exact method succeeds without a roll                              |
| Pressured success  | Method remains valid; time or consequence is contested            |
| Forced failure     | The world changes and no unchanged retry loop appears             |
| Missing key        | Alternate method, recovery, rescue, or irrelevant Gate remains    |
| Maximum burden     | Retreat, aid, Camp, or rescue remains reachable                   |
| Required discovery | Least favorable legal sequence reveals it within budget           |
| Revisit            | Shared changes persist and remain intelligible                    |
| Concurrent claim   | One winner, one clean loser, no duplicate                         |
| Replay             | Same topology, identities, custody, clocks, and public facts      |
| No AI              | Rules remain playable; fallback copy works; dialogue fails openly |
| Seventh visit      | Memory, relationships, routes, resources, or honest quiet remain  |

For a production worldpack deployment, also run the pre-deploy bundle gate.
The candidate must either match the live bundle hash or declare that exact
live hash in `replay_compatible_bundle_hashes`. An unreadable live identity or
undeclared mismatch fails closed; never hand-edit a recorded hash to force a
deployment.

At the table or in production, follow one invariant sequence:

1. describe obvious facts;
2. present the complete legal action set;
3. receive intent, target, and method;
4. clarify material cost and consequence;
5. commit;
6. resolve through authoritative rules;
7. apply state;
8. narrate certified facts;
9. update public memory and Journal;
10. present the changed scene.

After playtesting, revise the smallest responsible layer. Confusing copy needs
better presentation. A missing choice needs another method. Surprise needs a
Tell. A null result needs a consequence or exhausted target. Stranding needs a
recovery graph. AI contradiction needs a smaller packet or stricter
validation. Do not solve a rules defect with more persuasive narration.

## 38. Worked Adventure: The Missing Bell {#missing-bell}

This authoring example combines Core shared discovery, typed obstacles, and
Scout v2 with Accepted Target procedures for anchored traversal, cairns, and
paired-clock chases, plus the optional short-rest Playtest.

### Premise and graph {#bell-premise}

At dusk, Alder Hollow rings a brass bell so travelers can find the lane home
through river mist. After a storm, the bell is gone. Keeper Fen asks the
players to recover it before the next heavy fog.

The need begins at a sanctuary. The bell is fixed required truth. Optional
tollhouse loot is stocked once.

```text
[Hearth Room]
     |
[Alder Gate - Anchor] ---> [Known Orchard Path]
     |
  snapped-cord Lead
     |
[Washout - provisional] ---> [Sunken Tollhouse]
                                  |        \
                            [Sluice] ---> [Old Mill Return]
```

Hidden truth: floodwater carried the bell into the tollhouse sluice, where it
rests behind a warped grate. No roll decides whether it exists. The tollhouse
occupies one bounded three-room location slot. Its optional cache has already
selected an alder-wood compass charm.

### Scene 1: the need {#bell-need}

Fen says, "The fog comes early after hard rain. Without the bell, the north
lane disappears before supper."

Obvious facts:

- the hook is empty;
- the upper cord snapped;
- wet fibers stretch downhill;
- the room is safe;
- Fen can lend a bulky canvas shelter.

Focused Notice finds a brass scrape and alder leaves pasted toward the lower
gate. The bell moves from latent to signed; it is not revealed.

### Scene 2: leave the Anchor {#bell-anchor}

At Alder Gate the legal set includes Scout the cord trace, Travel the orchard
path, Search the ditch, and return Home.

::: {.rule}
**CORE RULE - Scout v2 use.** The authored Slot binds the cord-trace Lead, the
Washout result, and the approaching-rain consequence before commitment.
Success reveals the Washout and its edge. Under Pressure, failure also reveals
it while applying the frozen rain consequence. Neither result moves the party,
and repeating the claim cannot reroll it.
:::

The provisional foray and durable return-leg treatment below illustrate the
Accepted Target anchored traversal. If the pack instead exposes legacy
`scout_v1`, this scene reveals one prepared adjacent path edge without
movement. The party then Travels to the Washout.

### Scene 3: the Washout {#bell-washout}

The water-cut lane contains blue cord around an alder root, dressed stone
beneath mud, and water entering a dark gap downstream.

Search safely reveals that water dragged the cord. Study identifies an old
toll road. Together these facts create a Lead to the prepared location.

The party spends one turn and a length of recovered blue cord to build a
cairn. It makes the return leg durable and permits later branching. It does
not reveal the tollhouse, provide shelter, or create sanctuary. The extra
frontier commitment triggers a fixed Environment result: rain advances and
the low channel becomes dangerous.

### Scene 4: reveal the tollhouse {#bell-tollhouse}

Scout along the flood-course Lead reveals the fixed Sunken Tollhouse and its
edge without movement.

> Beyond the alder screen, a roofline leans out of the riverbank. One stone
> arch remains above water. Each pulse of the current knocks something hollow
> against the grate.

The hollow knock is a Sign, not proof. Players may Search the bank, Study the
current, prepare equipment, or return to the cairn. The party Travels along the
revealed accessible route to the tollhouse arch. Through the arch, an open
office door shows a black iron sluice key hanging on a peg.

### Scene 5: the sluice Gate {#bell-sluice}

The arch shows a swollen hatch, pulsing water, rusted key plate, narrow service
gap, and cracked hinge. Methods are:

1. use the sluice key hanging in the open office;
2. fit a lever beneath the hatch;
3. turn the upstream wheel to lower the water;
4. send one small actor through the gap.

The cracked hinge and rhythmic shudder are the Hazard Tell. Forcing without
bracing may release the hatch and bell into the race.

The party uses a valid lever, so the hatch will rise. A pressure check decides
whether they control the hinge. They fail. The hatch opens, hinge breaks, bell
enters fast water, Gate becomes broken, and a chase begins. The attempt
changed access and created a problem rather than leaving the hatch shut.

### Scene 6: catch the bell {#bell-chase}

```text
Progress: Catch the Bell          [ ][ ][ ][ ]
Danger: Bell reaches the weir     [ ][ ][ ][ ]
```

First beat: sprint the slippery ledge, enter with a safety line, throw a net,
intercept from the mill path, or abandon and mark its course.

Mira uses a net while Orin braces the line. Progress advances two; Danger
advances one when the platform shifts.

Second beat: the bell catches beneath a root. The party may grab it at risk,
secure the platform, or approach from the bank. Mira grabs while Orin holds.
Progress fills first.

If Danger filled first, the bell would continue to the prepared Old Mill
Return shown on the graph. It could become costlier, never nonexistent.

The bell is visibly bulky. The party caches the canvas shelter above the flood
line and records its position so they can carry the bell together.

### Scene 7: the optional cache {#bell-cache}

Search of the office reveals a loose panel. Open removes the panel but does not
reveal hidden contents. Search of the recess resolves its fixed slot and
reveals the compass charm. Mira Takes it after capacity succeeds. The source is
resolved; later visitors find an open empty recess and the keeper's initials.

### Scene 8: return or rest {#bell-return}

Without equipped shelter, Camp is not offered. The cairn does not qualify.
Retreat on the durable return chain remains legal.

If the short-rest playtest is active and the cairn area is safe enough, a
remaining short-rest use could recover one Fatigue step while risking a
frontier event. Record whether that choice improves play or only delays
return.

The group retreats, recovers the cached shelter, and reaches Hearth.

### Scene 9: homecoming {#bell-homecoming}

![Travelers return the recovered brass bell to a warm cottage gathering](assets/illustrations/return-home.jpg){.homecoming}

At Home, the bell is installed and rung. Its fixture gains custody, Fen's Job
completes, contributors receive credit, Hearth recovery clears expedition
depth, and a room memory is committed. The tollhouse remains discovered, its
sluice remains broken, the cairn remains, and a prepared follow-up repair Job
becomes available.

Homecoming does not erase frontier consequences. It turns them into future
community play.

**ACCEPTED TARGET - Semantic Journal rendering.** The grouped Journal entry
says:

> The Alder Hollow bell rang again. Mira and Orin recovered it beyond the
> tollhouse sluice. The broken gate still troubles the river.

:::
