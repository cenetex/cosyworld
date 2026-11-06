# Polynices' funeral

Owner design, 2026-11-04. Status: decided, not built
([#2301](https://github.com/cenetex/cosyworld/issues/2301)). The owner
settled the open questions on 2026-11-04 (see [Decisions](#decisions)). Art is in
[the Polynices assets](assets/polynices/README.md) (#2291, #2296) and the brief
is [#2290](https://github.com/cenetex/cosyworld/issues/2290). The song is "The
Hillside Sanctuary" ([#2300](https://github.com/cenetex/cosyworld/pull/2300)).
The item model is in [items and crafting](items-and-crafting.md) and
[rules 102](rules-102-eat-and-the-theban-decree.md).

## The story

Antigone's brother lies unburied in **Polynices' Hollow**, a single new place
off the Exposed Battlefield. Antigone waits at the Theban City Gate, trying to
reach him. She wants him buried, and Talk with her gives the player that
quest: this is the main clue. At midnight his shade stands on the
battlefield. He cannot move or act. Talk with him and he says what he wants,
the same burial, as a bonus clue. Once the guard stands aside, Antigone walks
to the Hollow. Bring the Funeral Oil,
the Funeral Cloth and the Burial Shovel to the Hollow and put them down there.
With all three lying there, Antigone asks for them one at a time: she
anoints him (the oil is used up), shrouds him (the cloth is used up), and
buries him (the shovel is kept). After that she sleeps beside the grave and
the song fades in. The shade no longer comes.

This chain is an explicit owner exception to "no quest chains". The owner
dropped the darkening on 2026-11-04. The rites use no special light and do
not jump the clock to midnight. Each rite is one play, like any other play.

## States

The owner's chain is dead → veiled → in the grave. Three rites give four
visible states, matching the art:

| State    | Set by | Hollow shows                          | Flag                       |
| -------- | ------ | ------------------------------------- | -------------------------- |
| Fallen   | start  | the fallen body                       | none                       |
| Anointed | Anoint | clean linen, oil jug empty            | `greek-polynices-anointed` |
| Veiled   | Shroud | the full shroud and the raven feather | `greek-polynices-veiled`   |
| Buried   | Bury   | the mound, helmet marker and feather  | `greek-burial-performed`   |

The Hollow backdrop and Polynices' hand card show the same burial state.
The hand card shows the care given and offers no Talk action. The shade is
the only voice of the dead.

## Time

Every play is one turn, which is half an hour on the rules clock (48 turns a
day; turn 0 is 06:00; night is 18:00 to 06:00). The three rites take three
plays. Fetching the last thing and walking in from the battlefield adds a
few more. So the funeral takes a few hours, and nothing new is needed for
time.

## The shade

`greek-polynices-shade` is a pack resident on the battlefield:
`travels: false`, `standoffs: false`, and in `world-life.json` range 0 with
`sleep: null`. It holds nothing. It is present only while both of these
hold (avatar `requires`):

- the clock is between midnight and dawn: `{ kind: "clock", from: 36, to: 0 }`
  in day turns, read the same way as the sleep schedules (new, E1);
- the flag `greek-burial-performed` is false.

The owner settled this: midnight, on the normal clock, until the body is
buried, and he stays until dawn (06:00). A one-turn window would make him
almost impossible to meet. He is the bonus clue; Antigone is the main one.

The shade can only Talk. The current rules already refuse what he is not
built for: he cannot follow (Accompany fails for a resident that stays
put), he holds nothing to Ask for, a Give he does not want is refused, and
he cannot be drawn into a standoff. No silent-avatar rule is needed.

His want is the burial quest (E2), and Talk gives it to the player, as with
any want ("Talk is the path to desires").

## Antigone

She starts at the Theban City Gate (`place` and `home` stay `greek-gate`),
trying to reach her brother. She does not keep vigil in the Hollow from the
start. Her home changes on a condition (E3, `homeWhen`):

```json
"home": "greek-gate",
"homeWhen": {
  "place": "greek-polynices-hollow",
  "requires": [
    {
      "kind": "any",
      "conditions": [
        { "kind": "holding", "item": "greek-creon-writ", "actor": "greek-guard" },
        { "kind": "flag", "key": "greek-burial-performed", "value": true }
      ]
    }
  ]
}
```

Once the guard stops guarding, because he holds Creon's Writ (the existing
gate chain, rules 102), her home is the Hollow. She is then away from home,
so she walks there with the existing resident walking (rules 100), through
the open gate. After the burial her home stays the Hollow even if the writ
leaves the guard, and she sleeps there every night. Her sleep pose
(resident sleep art, #2294) lies beside the mound.

Her want is the same burial quest as the shade's (E2). Talk with her at the
gate gives the player that quest: she is the main clue. Her `desire` and her
cloth want go. Talk topics carry her asking at the Hollow, one at a time,
read by flag (data): "Give me the oil first", then the cloth, then the
shovel.

## The quest: laying things down at a place

**E2, a `lay` step on a place want.** Its target is the place, and its step
lists one to three things:

```json
"want": {
  "kind": "place",
  "target": "greek-polynices-hollow",
  "step": {
    "verb": "lay",
    "items": ["greek-oil-flask", "greek-funeral-cloth", "greek-shovel"]
  }
}
```

The quest is met after any play when every listed thing lies directly at
the target (`item_at`). Things carried there do not count. Drop is the
existing verb, so no verb is new. The quest card's next step shows the
nearest missing thing, then the Hollow while the player carries it, then
Drop there. The caption reads "Lay the Funeral Oil, the Funeral Cloth and the
Burial Shovel in Polynices' Hollow". The shade and Antigone say "I want the
Funeral Oil, the Funeral Cloth and the Burial Shovel laid in Polynices'
Hollow." Talk with either gives the player the same `lay` quest, not a
"bring them there" quest. The kind stays `place`, so the Rust narrative
check on a met want (`place` with a location target) is unchanged.

## Playing the rites

Bring the three supplies to Antigone in the Hollow. Give her the oil, the
cloth and the shovel in that order. Take any supplies already laid out on
the ground before handing them over. Each gift takes one turn, and the
quest card shows the next rite.

## Original rite design

These are three context-button choices whose subject is Antigone, at the
Hollow. Each one is a single play of normal time: the rites do not darken
the light and do not force midnight. The burial simply takes a few hours of
normal turns.

| Choice                   | Label                    | Requires                                                           | Effects                                         |
| ------------------------ | ------------------------ | ------------------------------------------------------------------ | ----------------------------------------------- |
| `greek-anoint-polynices` | Hand Antigone the oil    | oil, cloth and shovel `item_at` the Hollow; not anointed           | `retire_item` oil (home: Colonus); set anointed |
| `greek-shroud-polynices` | Hand Antigone the cloth  | anointed; cloth and shovel at the Hollow; not veiled               | `retire_item` cloth (home: Eleusis); set veiled |
| `greek-bury-polynices`   | Hand Antigone the shovel | veiled; shovel at the Hollow; `choice_unset greek-theban-response` | choose `burial`; set `greek-burial-performed`   |

`retire_item` already accepts a thing lying at the choice's place, and since
rules 102 it sends a homed thing straight home. The shovel stays lying in the
Hollow. It gains `home: greek-gate`, where it starts, so a later use can
send it back. The Burial Account still appears on `greek-burial-performed`,
and the Cithaeron road reads the same flag.

## Retired choices: one path only

This is the only path to the burial. The pack-data PR (Greek revision 21)
deletes these choices. Rules 103 does not touch them.

| Choice                             | Label                            | Why                      |
| ---------------------------------- | -------------------------------- | ------------------------ |
| `greek-report-plan`                | Report the intended burial       | the exposure path goes   |
| `greek-prepare-burial-ground`      | Prepare the burial ground        | replaced by the rites    |
| `greek-perform-burial`             | Perform the burial               | replaced by the rites    |
| `greek-petition-burial`            | Receive Creon's writ             | the concession path goes |
| `greek-perform-permitted-burial`   | Complete the permitted burial    | replaced by the rites    |
| `greek-courtyard-burial`           | Tell the courtyard what happened | custom report goes       |
| `greek-courtyard-permitted-burial` | Tell Dione about the grave       | custom report goes       |

`greek-petition-burial` is not needed by the gate chain. The gate is the
live route `greek-gate` > `greek-battlefield`, open while the guard holds
Creon's Writ (`holding`). The player gets the writ by trading the decree to
Creon (his want and `values`), not through this choice. The choice only
chose `concession` and set `greek-burial-permitted`, which nothing else
reads.

With the exposure and concession paths gone, these become unreachable and
go with them: `greek-courtyard-concession` and `greek-courtyard-exposure`
(no one can choose `concession` or `exposure`), the Guard's Tablet and its
Cithaeron route (the tablet appears only on `greek-guard-warned`), and the
permitted Bury variant. The Cithaeron road still opens on the Burial Account
or on Creon's Writ lying at the battlefield or the courtyard.

## Map

The battlefield gains a third exit, the Hollow (gate, Cithaeron road, Hollow).
The Hollow has one exit, back to the battlefield. It joins `release.places`.
It is not a new region (breadth freeze): it is the battlefield's own hollow,
past the same guard.

## Items and Ajax

The oil starts at the courtyard and goes home to Colonus. The cloth starts at
the sanctuary and goes home to Eleusis. The shovel starts at the gate and
stays in the Hollow. After this funeral the oil and cloth wait behind the
Open Door in Attica. That is the second gathering, when the same set later
buries Ajax. Merging the duplicate cloths and tools (`greek-return-cloths`,
`greek-ajax-cloth`, `greek-ajax-tools`) into this one set belongs to the Ajax
build. The Ajax data is dark today.

## Art mapping

| Use                                                                    | Source                                                                           | Production                                                                                                                                                                    |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hollow backdrops, 4 states × day/night (8 entries, the schema's limit) | `hollow-empty-{day,night}-study.png` + the eight `polynices-*-cutout.png` layers | flatten each layer onto its empty Hollow at the README placement (anointed/shrouded 83%, +40, +70) into 1672 × 941 WebPs; `backdrops` keyed by `daylight` and the state flags |
| Buried backdrop                                                        | the grave cutout on the empty Hollow                                             | owner decision: composite like the other three states, so all four match                                                                                                      |
| Buried reference                                                       | `hollow-buried-{day,night}-study.png`                                            | reference only; not shipped                                                                                                                                                   |
| Shade portrait                                                         | `shade-study.png`                                                                | 1024 × 1536 RGBA with its translucency baked in (README: body near opaque now); register its facing in `portrait-facing.mjs`                                                  |
| Antigone asleep                                                        | resident sleep art (#2294)                                                       | her existing sleep pose                                                                                                                                                       |
| Body hand cards | Four selected card studies | Use the fallen, anointed, veiled and grave exports listed in the [art guide](assets/polynices/README.md) for the corresponding burial state. |

The night Hollow already has its own paintings, so the place needs no entry
in `daylight.mjs`. The authored `daylight` backdrops are enough.

## Music

The song is `assets/music/hillside-sanctuary.mp3` (#2300). It is presentation,
so it is not a rules change. Add a `funeral` cue to `music-cues.mjs`, due
while the player stands in the Hollow after the burial (as `battleMusicDue`
is for a fight), and give it a slow fade in. The track shares its title with
the Theban place "The Hillside Sanctuary". The player sees the title only in
the music status line.

## Data and engine

| #   | Piece                                                                                     | Kind                                       |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------------------ |
| D1  | Hollow place, exits, release list                                                         | data                                       |
| D2  | Eight state backdrops                                                                     | data and art                               |
| D3  | Shade resident with `requires` and world-life entry                                       | data (needs E1)                            |
| D4  | Antigone's `homeWhen`, burial want and topics                                             | data (needs E2, E3)                        |
| D5  | Three rite choices; seven old choices retired; shovel home                                | data                                       |
| D6  | Funeral music cue                                                                         | client only                                |
| E1  | `clock` condition: `{from, to}` day turns, wrapping                                       | rules                                      |
| E2  | `lay` step on a place want: met, quest card next step, Talk caption, authored-want schema | rules (plus client quest card and caption) |
| E3  | `homeWhen` on a pack avatar: a home that changes on a condition                           | rules                                      |

E1, E2 and E3 are one rules bump, **rules 103**. They touch `pack-rules.mjs`,
`pack-schema.mjs`, `want.mjs`, `talk-quest.mjs`, `want-talk.mjs`,
`resident-home.mjs` and `world.mjs` in the shared bundle, and the client's
`quest-step.mjs` and `quest-card.mjs`. Rules 102 and earlier stay
byte-identical for replay. The Greek pack goes to revision 21. Alpha local
saves may be dropped. Shared worlds need the revision upgrade to retire the
old battlefield receipts' choices.

### Rules 103 shapes

- **E1 `clock`.** `{ "kind": "clock", "from": 36, "to": 0 }`. `from` and
  `to` are whole day turns from 0 to 47 (turn 0 is 06:00), and differ. The
  condition holds while `turn mod 48` is at or after `from` and before `to`,
  wrapping past the day's end when `from` is greater than `to`. It is saved
  state, so `requires` may use it.
- **E2 `lay`.** A place want whose step is `{ "verb": "lay", "items": [...] }`,
  one to three distinct things. It is met after any play when every listed
  thing lies directly at the want's target place (`item_at`), wherever the
  wanting avatar stands. Talk with an avatar holding it gives the player the
  same want as a quest. A pack resident may start with it.
- **E3 `homeWhen`.** On a pack avatar with a `home` (or `place`):
  `{ "place": Q, "requires": [one to four saved conditions] }`. While the
  conditions hold (read in the avatar's pack), its home is Q: it walks
  there, keeps its range from there, sleeps there and is sent home there.
  Otherwise its home is `home`.

## Tests

`test/card-polynices-funeral.test.mjs` (pack-data PR): the shade appears
only from midnight to dawn and never after the burial; Talk with Antigone
at the gate, or with him, gives the quest; Antigone walks to the Hollow
once the guard holds the writ and sleeps there after the burial; carrying
the things into the Hollow does not meet it, and laying all three down does.
Then the rites run in order: each needs the one before, the oil goes home to
Colonus, the cloth goes home to Eleusis, and the shovel stays. The burial is
the one Bury choice. Rules 103 tests: `clock` wrapping past
midnight, the `lay` quest met only by things lying there, a home that moves
on a condition, and replay of rules 102 journals unchanged. Shared play
needs client/server agreement on the Rust card_shared suite.

## Decisions

The owner settled the open questions on 2026-11-04:

1. **Antigone** starts at the Theban City Gate, trying to reach the Hollow.
   Once the guard holds Creon's Writ her home becomes the Hollow and she
   walks there. After the burial she sleeps in the Hollow (E3).
2. **Clues.** Antigone wanting the burial is the main clue. The shade is a
   bonus clue, on the battlefield from midnight to dawn on the normal clock
   while the body is unburied. He is talk-only.
3. **Rites** do not darken the light or force midnight. They take a few
   hours of normal turns.
4. **Old choices.** The new path is the only one. The seven choices in
   [Retired choices](#retired-choices-one-path-only) go in the pack-data PR,
   so there is no exposure or permitted variant of Bury.
5. **Art.** The buried backdrop is the grave cutout on the empty Hollow, so
   all four states match.

## Open questions for the pack-data PR

1. **What opens the Open Door?** Today only the four courtyard reports set
   `greek-open-door-open` (burial, concession, permitted burial, exposure).
   With all four gone or unreachable, nothing opens it. Recommended: the
   Bury rite also sets `greek-open-door-open`, and Dione's invitation reads
   the burial.
2. **The defiant path.** Beating the guard gets the player past him without
   the writ, but then Antigone's home stays the gate and the rites need her
   in the Hollow. Recommended: the player brings her (Accompany), and the
   burial flag keeps her home in the Hollow afterwards. The pack-data PR
   tests that she can follow; if not, the owner decides.

## Quest card and saved progress

The existing Talk quest uses the four hand paintings as its stage art. It
keeps the quest active through Bury, when the grave painting appears. Bury
opens the Open Door. The pack keeps the old choice records so existing saves
can keep their prior outcomes and recitals.

## Build notes, 2026-11-05

PR #2321 uses rules 104 and Greek revision 21. Rules 103 remains unchanged.
The burial flag finishes the quest and opens the Open Door. Existing saves
keep their earlier choice receipts. Antigone sleeps at her usual bedtime.

The two funeral `retire_item` effects set `waitAtHome: true`. This sends the
oil to Colonus and the cloth to Eleusis while those places await the Open
Door. The Bury rite opens those places. The field is allowed for homed
items that return after use. Existing retirement keeps its ordinary return
rule, and each rite still checks the item's custody before using it.

The four earlier courtyard reports remain available to saves that already
recorded an earlier Theban response. New play records the funeral flags.
An older completed burial can finish its report and open the road.
