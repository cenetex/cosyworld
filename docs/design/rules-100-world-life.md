# Rules 100: world life

Owner (2026-11-04): "all avatars should wander and want but have them return
to their starting location and only travel one or two hops from it", "avatars
should also sleep", and the gate guard who "got pushed back and never moves
back to his spot". Specs: home and range (#2197), guard (#2202) and resident
sleep (sleep spec §4). The speed check (`codex/v100-speed-probe`) measured the
off-stage step inside the shared engine's 2 s QuickJS deadline.

The modules are `resident-home.mjs`, `resident-sleep.mjs` and
`resident-guard.mjs`; `residentRound` in `world.mjs` runs them after the cast
has acted. There is no clock and no random: bedtimes scatter by the run seed
(`runHash`), and every walk is in sorted id order.

## Data

`v2/card-game/world-life.json` holds `defaults` (`range` 2, `sails` false,
`sleep` 22:00–06:00), per-pack defaults (`packs`), per-resident overrides
(`residents`: `range`, `sails`, `sleep`, `guards`) and the `guardable` ways.
`sleep` is `{from, to}` in clock turns (`turn mod 48`, turn 0 is 06:00) and
wraps past the day's end; `null` never sleeps.

The data sits beside the packs, not in them, because the released rules (v93
to v99) validate pack fields closely and must still read the current content
in tests and tools; v98's pack entries live in the hub for the same reason.
The only pack edit is the gate's latch (below). `travels: false` in a pack
still keeps a resident home, as range 0 does.

| Who                                | Data                                  |
| ---------------------------------- | ------------------------------------- |
| Pip (`moth`)                       | asleep 06:00–16:00 (0–20), nocturnal  |
| Nix                                | asleep 05:00–17:00 (46–22), nocturnal |
| The keeper                         | asleep 23:30–07:00 (35–2)             |
| Badger                             | asleep 20:00–05:00 (28–46)            |
| The Greek cast                     | asleep 21:00–05:30 (30–47)            |
| Myrto                              | asleep 21:00–04:30 (30–45), sails     |
| The Bard, BoardyAI, the Gate Guard | never sleep                           |
| Oak, Skull, Antigone, the Gate Guard | range 0                             |
| RATi, the Open Door and Ajax cast  | range 1 (home and its neighbours)     |
| Whiskerwind and the other residents | range 2 (the default)                 |

## Home and range

- **Home** is the pack's `home` (or the starting place); the hub's residents
  use their authored home.
- **Range** limits only leaving home for wants. Wants are drawn within range
  (`api.inRange`), and out of range only when nothing in range is left.
- **With a player**, a resident acts as before: it pursues wants where it
  stands, and walks for them only if it travels (the hub's residents,
  roamers, freed residents).
- **Walking home**, one step a turn along open routes with `stepToward`:
  after being pushed back by a lost fight (`homeward: true`), when displaced
  beyond its range (scattered, knocked through), at bedtime, and when a
  ranged resident has nothing in range to pursue. Range 0 never leaves home
  except by being pushed, and still walks back.
- **Off-stage**, where no player is present, only walkers tick, at most
  `OFFSTAGE_STEPS` (24) steps a play, starting further on each turn. Ships
  are never boarded off-stage.
- **Dawn and dusk** (`turn % 24 === 0`): each ranged resident away from
  players takes one step, home if it is away, else toward a want in range.
  Two who end in one place meet a want to talk as a rules fact, with no
  speech (`want_met`).
- Players, their away avatars, roamers, journeys and freed residents keep no
  home life (`rangeOf` is null).

## Who stays put

Every resident roams, can be invited along (Invite) and can be threatened,
except those below, each for a reason in data or in the rules. Freeing a
resident is a data edit: drop `travels: false` and `standoffs: false` in the
pack and give a range here. `test/card-residents-roam.test.mjs` holds the
allow-list and the reason for each.

- Oak (a backdrop tree) and the Badger (asleep until greeted; a sleeper cannot
  be threatened) stay in one place by design. Oak still stands his ground.
- Skull stays: his home, the Moonlit Trail, is shut until the garden drain is
  cleared, so a Skull who stepped out could not walk home and would sleep
  away. Freeing him needs a rule that a resident only leaves by ways it can
  return through.
- Antigone (the Hollow rites), the Gate Guard (a lock), the Shade (night),
  Myrine and the Hoppy Cat journey residents (authored journeys), the Swede
  (`stayUntil`), the recital actor (`standoffs: false` is a schema rule) and
  Boardy keep their switches. Hoppy Cat is paused as a pack.

## Sleep

- A resident falls asleep in its scattered window if idle: not in a fight
  and not aboard. Away from home, it walks home first if it can, and sleeps
  where it stands if it cannot. A busy one tries again each turn.
- **No resident sleeps on a world's first day** (turns 0–47), so the opening
  and a new world's first meetings keep their cast awake.
- `sleeping: {since, place, until}` (a player's sleep has `present`
  instead), and `slept` names the window it took, so one woken early stays
  awake until its next bedtime.
- It wakes at `until`, for a Talk, a threat, a ring where it sleeps, a fight
  or being moved. While asleep it makes no play; Ask, Trade and Invite are not
  offered and the context button says "Pip is asleep"; a Give is kept.
- Away avatars sleep on the default schedule where they stand; the player's
  next play turns that sleep into the player's own.

## Guard

- **A standing Wait**, not a verb. The Gate Guard guards
  `greek-gate → greek-battlefield` by default; `guarding` is set whenever he
  stands at his post, the way is not lifted and he is not fighting.
- **Barred**: the way drops out of everyone's exits but the guard's. The far
  card is the locked box (`sealedWays`, with `guardedBy`), and the button
  reads "The Gate Guard bars the way". Seeking the way still gives the
  decree's quest.
- **Talk** keeps a resident's guard.
- **The order lifts it for good**: the latch reads "the guard holds the decree
  or writ", wherever he stands (the `item_near` halves are gone).
- **Defeat knocks him through** onto the battlefield, even a third time. The
  strike that beats him records or strengthens the existing threat grievance.
  After the three moments of peace he walks home and guards again. This
  re-lock is the one exception to flip-once (#2186): the client draws the box
  from the rules' gate state, so a re-locked way covers again.
- **Both sides** (owner, #2233): the guard bars his way in both directions.
  The battlefield's exits are the gate and the Cithaeron Road; from the
  battlefield the guarded gate is the locked box with the same reason, and
  only the guard may pass, so a guard knocked through always walks home. The
  decree or writ opens it both ways for good; while the guard is away from
  his post it is open both ways. Travellers from Cithaeron enter Thebes only
  then. The road shows as a locked box ("The road over Cithaeron opens once a
  Theban account of the burial is here or on Dione's table") until its own
  latch opens it, as before, and appears with its section of the release.
  The battlefield's old `live` `gate_open` route is gone: the gate is its
  plain exit.
- **A player's guard** is offered as "Guard" for yourself and an open
  guardable way. It lasts until the player's next other play, bars residents
  only (never another player), and lapses when the player leaves.
- In battle the old "Guard" is "Cover": its log line reads "X covers Y.", and
  a Brace "softens the blow".

## Upgrade, replay and tests

A rules 99 save loads with every new field absent: guards take their posts,
nobody is asleep or walking home. Opening, packs, glimpse and halfway state
are kept. Rules 93 to 99 are byte-identical and pinned.

Story suites written for a still cast hold world life off
(`test/helpers/still-cast.mjs`); the world life suites test it:
`card-world-life`, `card-resident-sleep`, `card-gate-guard`, the browser and
QuickJS agreement (`card-world-life-agreement`), and the C host's replay and
upgrade (`world_life_tests.rs`).
