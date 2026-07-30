::: {.chapter}

# Part V: Frontier Expeditions {#part-frontier}

## 18. Scout Today and Scout v2 {#scout-versions}

The shipped Scout action reveals the next adjacent route segment toward a
named destination without moving the avatar. Generated long routes already
have deterministic hidden waypoints. Scout exposes an existing segment;
Travel then crosses it.

```text
known room -- hidden edge -- hidden waypoint
     |
     | current Scout
     v
known room -- revealed edge -- revealed waypoint

The avatar has not moved.
```

Generated routes may also have a familiarity project. Revealing an edge,
making a route familiar, and settling a place are different achievements.

::: {.target}
**ACCEPTED TARGET - Scout v2.** The future procedure begins with an exact Lead
and eligible Anchor. Each committed Scout changes Lead legibility, progress,
an authorized revealed segment or target, a Sign, pressure, or return-chain
evidence. Scout never moves the avatar; Travel remains a separate commit. It
never says "nothing found, Scout again."
:::

Historical Scout records retain their old meaning. Scout v2 requires a
versioned action and receipt that names the Lead, Anchor, return chain, result,
event receipt, and any revealed topology. A worldpack may reskin it as
"Trace the signal," but the underlying authority remains the same.

Use shipped Scout for current content. Do not narrate physical advance, fading
trails, or cairn requirements unless the certified action includes them.

## 19. Anchors, Forays, and Cairns {#anchors-forays}

![A frontier foray follows one Lead through provisional steps to a durable cairn while preserving a return chain](assets/diagrams/foray-map.svg)

::: {.target}
**ACCEPTED TARGET - Scout v2 traversal.** Anchors, provisional nodes, Marks,
return chains, and navigation cairns are accepted design but not the shipped
Scout v1 traversal law.
:::

A foray begins somewhere the expedition can name and reliably return to: an
**Anchor**. Eligible Anchors may include sanctuary, satisfied lodging, an
authored trailhead, a durable cairn, a setting-equivalent Signal Anchor, or a
camp explicitly permitted to launch a foray.

An Anchor is a navigation fact. It is not automatically shelter, safety,
settlement, or sanctuary.

From an Anchor, choose one exact Lead. The expedition can follow that same
Lead through provisional steps without building a cairn at each step. Scout
reveals the authorized next leg without movement. Travel crosses that leg and
extends the traversed return chain. Temporary marks can preserve the current
leg well enough to continue or retreat, but a provisional node cannot launch
an unrelated branch.

To begin another Lead, promote the position into an Anchor through an authored
action or return to an earlier Anchor.

::: {.referee}
**REFEREE PRACTICE - Cairns mark decisions, not every footstep.** Requiring a
cairn at every move turns discovery into maintenance. Let one active Lead
carry a short foray. Ask for a durable cairn where the party wants reliable
return and future branching.
:::

Build a cairn only after traversing the leg it marks. The action pays authored
time, material, and pressure costs. A successful cairn makes the route behind
the expedition shared and recoverable, and may authorize later branching.

A cairn does not reveal the next route, create topology, move the expedition,
open a lock, provide shelter, grant Camp recovery, make a route familiar,
settle a place, or create sanctuary.

If a Lead is lost, its destination and hidden route do not reroll. Offer
concrete recovery: retreat on the return chain, spend a resource to reacquire
the trail, Study a known Sign, wait out an Environment result, accept aid,
reach the last cairn, or take an authored redirection. If no recovery is
possible, the content was invalid before play.

## 20. Rest by Place and Gear {#rest}

Rest is a place-and-gear procedure. The server derives the grade. A client
cannot request a better one.

| Grade  | Eligibility                                              | Recovery                                                                                                       |
| ------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Hearth | Sanctuary                                                | Clear tired, training strain, and expedition depth; refresh the full spell hand and eligible charms and relics |
| Lodged | Authored lodging feature whose current gate is satisfied | Clear tired and training strain; refresh the full spell hand; expedition depth remains                         |
| Camp   | Frontier plus valid equipped shelter                     | Clear tired and refresh one exhausted spell; training strain and expedition depth remain                       |
| None   | Frontier without valid equipped shelter                  | Do not offer Rest; spend nothing                                                                               |

A tent at the bottom of a pack is not enough. Shelter must be validly equipped.
A cairn or Signal Anchor is never shelter.

Camp is the only current grade that advances an active frontier danger clock.
When one is active, the Rest applies that authored tick exactly once; with no
active clock, no tick occurs. The pressure is shown before commitment. Hearth
is always safe and complete. Lodged Rest never costs Orbs. The current lodging
schema supports an open gate; future Bond, Job, and room-resource gates must
extend that closed schema rather than create another economy.

If Rest is unavailable, explain the missing condition: "There is nowhere dry
enough to settle here without shelter." Do not offer a disabled action that
appears to accept commitment.

Expedition depth fills from qualifying frontier movement. Camp and Lodged rest
do not clear it; Hearth does. The portrait may show this journey depth without
turning it into a named stamina currency.

## 21. Frontier Events {#frontier-events}

::: {.rule}
**CORE RULE - Living frontier pulse.** Ambient frontier change comes from
committed play, never real-world waiting. Every sixth committed player tick can
drive deterministic weather, opportunity-level trade along authored routes,
faction movement, or conflict pressure. It cannot create or alter topology.
Only a recorded action at the affected frontier may advance its danger clock.
:::

::: {.target}
**ACCEPTED TARGET - Contextual events.** Scout v2 adds smaller event rolls to
individual forays. They select from closed, versioned worldpack results; they
do not ask AI to invent events.
:::

|  d6 | Category    | Changes                                                                                                                                                 |
| --: | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Encounter   | An authorized creature, resident, faction, or obstacle enters                                                                                           |
|   2 | Sign        | An existing Lead advances or becomes complicated                                                                                                        |
|   3 | Environment | Terrain, weather, light, access, or position changes                                                                                                    |
|   4 | Loss        | An eligible expendable resource is spent, or an eligible carried item is dropped, damaged, or separated; required items follow their recovery contracts |
|   5 | Exhaustion  | Tired, strain, delay, or recovery demand; Fatigue applies only during its playtest                                                                      |
|   6 | Discovery   | A compatible bounded Discovery Slot is exposed                                                                                                          |

Trigger a roll only after a named commitment: substantial played time, entry
into a frontier zone, unusual noise, haste, unsafe rest, forced passage, or an
authored threshold. Record the table version and result in the action receipt.
Retries never reroll it.

A quiet result must still matter. It can grant safe passage for one leg,
preserve a Lead, create a rest opportunity, establish no immediate pursuit,
or improve position. Required destinations retain a finite Sign budget and
fallback.

## 22. Playtest: Three Short Rests {#short-rest-playtest}

::: {.playtest}
**PLAYTEST - This section is not current product law.**

Start each long-rest epoch with three short-rest uses. Track four internal
Fatigue states: Fresh, Winded, Weary, and Spent. A short rest costs one turn
and one use, reduces Fatigue one step, clears transient tired, and refreshes
only a resource whose own profile permits short-rest recovery.
:::

| State  | Player-facing meaning              | Legal action effect                    |
| ------ | ---------------------------------- | -------------------------------------- |
| Fresh  | Ready for sustained work           | Full legal set                         |
| Winded | The journey is beginning to tell   | Full set; gentle warning               |
| Weary  | Another exertion may force retreat | Full set; promote return and recovery  |
| Spent  | Cannot safely begin outward work   | Survival hand replaces outward actions |

At Spent, remove outward Scout, new branches, exhaustive Search, analytical
Study, strenuous Work, forcing, optional conflict, and Travel away from the
secure return chain. Keep retreat, Travel toward Home or an Anchor, a legal
short rest, Camp with shelter, aid, recovery items, Defend, Flee, rescue,
speech, inspection, coordination, Pass, and Need Time.

This restriction applies to the complete legal set, not only the two
suggestions.

### The no-stranding invariant {#no-stranding}

Do not apply Spent unless the committed result leaves at least one legal
recovery route: retreat, valid Camp, aid, a recovery item, authored rescue, or
an intentional destination that itself provides recovery.

For the playtest, a successful Camp, Lodged, or Hearth Rest begins a new epoch,
restores all three short-rest uses, and clears Fatigue to Fresh. Existing
grade-specific card recovery stays unchanged. Adoption would require a
versioned rest contract so historical Rest events keep their meaning.

Measure turns between long rests, short rests actually used, Spent frequency,
whether Spent creates a good retreat, shelter decisions, unsafe-rest events,
recovery-item dependence, and whether one satisfying discovery normally fits
inside a foray. Three uses is a test value, not sacred arithmetic.
:::
