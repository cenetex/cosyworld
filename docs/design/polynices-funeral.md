# Polynices' funeral

Owner design, 2026-11-04. Status: proposed, not built
([#2301](https://github.com/cenetex/cosyworld/issues/2301)). Art is in
[the Polynices assets](assets/polynices/README.md) (#2291, #2296) and the brief
is [#2290](https://github.com/cenetex/cosyworld/issues/2290). The song is "The
Hillside Sanctuary" ([#2300](https://github.com/cenetex/cosyworld/pull/2300)).
The item model is in [items and crafting](items-and-crafting.md) and
[rules 102](rules-102-eat-and-the-theban-decree.md).

## The story

Antigone's brother lies unburied in **Polynices' Hollow**, a single new place
off the Exposed Battlefield. At midnight his shade stands on the battlefield.
He cannot move or act. Talk with him and he says what he wants: his body
buried in the Hollow. That becomes the player's quest. Bring the Funeral Oil,
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

| State | Set by | Hollow shows | Flag |
| --- | --- | --- | --- |
| Fallen | start | the fallen body | none |
| Anointed | Anoint | clean linen, oil jug empty | `greek-polynices-anointed` |
| Veiled | Shroud | the full shroud and the raven feather | `greek-polynices-veiled` |
| Buried | Bury | the mound, helmet marker and feather | `greek-burial-performed` |

The body is not a card. It is painted into the Hollow's backdrop, so it
never offers Talk. The shade is the only voice of the dead.

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
buried. Assumption: he stays until dawn (06:00). A one-turn window would
make him almost impossible to meet.

The shade can only Talk. The current rules already refuse what he is not
built for: he cannot follow (Accompany fails for a resident that stays
put), he holds nothing to Ask for, a Give he does not want is refused, and
he cannot be drawn into a standoff. No silent-avatar rule is needed.

His want is the burial quest (E2), and Talk gives it to the player, as with
any want ("Talk is the path to desires").

## Antigone

She keeps vigil in the Hollow (recommended, data only). Her `place` and
`home` become `greek-polynices-hollow` and her range becomes 0. She is
found beyond the guard, beside her brother, and she sleeps there every
night. After the burial her sleep pose (resident sleep art, #2294) lies
beside the mound. Her want is the same burial quest as the shade's, which
gives the player a second clue. Her `desire` and her cloth want go.

Talk topics carry her asking, one at a time, read by flag (data): "Give me
the oil first", then the cloth, then the shovel.

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
Drop there. The Talk caption reads "Lay the oil, the cloth and the shovel in
Polynices' Hollow". The kind stays `place`, so the Rust narrative check on a
met want (`place` with a location target) is unchanged.

## The rites (pack choices, data only)

These are three context-button choices whose subject is Antigone, at the
Hollow. Each one is a single play.

| Choice | Label | Requires | Effects |
| --- | --- | --- | --- |
| `greek-anoint-polynices` | Hand Antigone the oil | oil, cloth and shovel `item_at` the Hollow; not anointed | `retire_item` oil (home: Colonus); set anointed |
| `greek-shroud-polynices` | Hand Antigone the cloth | anointed; cloth and shovel at the Hollow; not veiled | `retire_item` cloth (home: Eleusis); set veiled |
| `greek-bury-polynices` | Hand Antigone the shovel | veiled; shovel at the Hollow; `choice_unset greek-theban-response` | choose `burial`; set `greek-burial-performed` |
| `greek-bury-polynices-permitted` | Hand Antigone the shovel | as above, but `choice` concession | set `greek-burial-performed` |

`retire_item` already accepts a thing lying at the choice's place, and since
rules 102 it sends a homed thing straight home. The shovel stays lying in the
Hollow. It gains `home: greek-gate`, where it starts, so a later use can
send it back.

They replace `greek-prepare-burial-ground`, `greek-perform-burial` and
`greek-perform-permitted-burial` on the battlefield. The Burial Account still
appears on `greek-burial-performed`, and the Cithaeron road and Dione's
reports read the same flag, so they are unchanged.

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

| Use | Source | Production |
| --- | --- | --- |
| Hollow backdrops, 4 states × day/night (8 entries, the schema's limit) | `hollow-empty-{day,night}-study.png` + the eight `polynices-*-cutout.png` layers | flatten each layer onto its empty Hollow at the README placement (anointed/shrouded 83%, +40, +70) into 1672 × 941 WebPs; `backdrops` keyed by `daylight` and the state flags |
| Buried reference | `hollow-buried-{day,night}-study.png` | reference for the composite; use it directly if the owner prefers it |
| Shade portrait | `shade-study.png` | 1024 × 1536 RGBA with its translucency baked in (README: body near opaque now); register its facing in `portrait-facing.mjs` |
| Antigone asleep | resident sleep art (#2294) | her existing sleep pose |
| Body card studies | `*-card-study.png` | not used (the body has no card) |

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

| # | Piece | Kind |
| --- | --- | --- |
| D1 | Hollow place, exits, release list | data |
| D2 | Eight state backdrops | data and art |
| D3 | Shade resident with `requires` and world-life entry | data (needs E1) |
| D4 | Antigone moved to the Hollow, range 0, burial want, topics | data (needs E2) |
| D5 | Four rite choices; three battlefield choices retired; shovel home | data |
| D6 | Funeral music cue | client only |
| E1 | `clock` condition: `{from, to}` day turns, wrapping | rules |
| E2 | `lay` step on a place want: met, quest card next step, Talk caption, authored-want schema | rules (plus client quest card and caption) |

E1 and E2 are one rules bump, **rules 103**. They touch `pack-rules.mjs`,
`pack-schema.mjs` and `want.mjs` in the shared bundle. Rules 102 and earlier
stay byte-identical for replay. The Greek pack goes to revision 21. Alpha
local saves may be dropped. Shared worlds need the revision upgrade to move
Antigone and retire the old battlefield receipts' choices.

## Tests

`test/card-polynices-funeral.test.mjs`: the shade appears only from midnight
to dawn and never after the burial; Talk with him gives the quest; carrying
the things into the Hollow does not meet it, and laying all three down does.
Then the rites run in order: each needs the one before, the oil goes home to
Colonus, the cloth goes home to Eleusis, and the shovel stays. The burial
fork works both defiant and permitted. Antigone sleeps in the Hollow. Also:
`clock` wrapping past midnight, and replay of rules 102 journals unchanged.
Shared play needs client/server agreement on the Rust card_shared suite.

## Open questions for the owner

1. **Where is Antigone before the burial?** Recommended: she keeps vigil in
   the Hollow from the start (data only). The alternative keeps her at the
   gate and moves her home to the Hollow at the burial. That needs a
   conditional-home rule and a walk there (engine).
2. **Can the burial still happen after the plan is reported to the guard
   (exposure)?** Recommended: yes. Add a third Bury variant for that
   response, so a reported plan delays the burial but does not forbid it.
3. **Antigone's want.** Recommended: the same burial quest as the shade's, as
   a second clue. The alternative leaves the shade as the only source.
4. **Buried backdrop.** Recommended: composite the grave cutout onto the
   empty Hollow, so all four states match. The alternative uses the two
   finished buried paintings.
