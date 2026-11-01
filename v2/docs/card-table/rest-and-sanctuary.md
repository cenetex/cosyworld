# Rest and sanctuary (design note)

Status: proposal for owner review. Nothing here is built yet. The issue that
tracks the open questions links back to this note.

Owner direction (2026-10-31):

- "Return home" becomes "return to a sanctuary and rest". At a sanctuary, Rest
  takes the place of Wait when it is needed, and it is a **long rest**.
- Wait is a **short rest**.
- The next level's quest comes in a dream during a long rest, when the avatar
  has enough XP for that level.

This note fits those ideas to the fixed-verb card model. It uses the classic
D&D-style research already in the repository and the current card rules.

## Prior art

| Source | What it says | What we keep |
| --- | --- | --- |
| [ADR 0004](../../../docs/decisions/0004-rest-grades-and-expedition-depth.md), [rest backlog](../../../docs/backlog/rest-travel-and-weariness.md), #348, #356, #603, #604, #784 (classic, closed) | Hearth/Lodged/Camp rest grades, three short rests per long rest, four Fatigue states, an expedition ring. | Sanctuary is safe and complete. Lodging never costs money. We drop the grades, counters and ring. |
| #313 (classic, closed) | Fatigue that only rest cleared, and rest that needed travel first, locked players out. | Rest must never be gated by a counter the player cannot see. |
| #492 (classic, closed) | Sanctuary pauses loss; it never heals, strips or kills. | Nothing harmful starts in a sanctuary. |
| [Quest design research](../../../docs/design/quest-design-research.md) P16, P21 | Clocks; a cosy storyteller paces beats and rest. | Rest is a pacing beat, not a chore. |
| #1505, #1540 | Three straight losses send you home and you drop everything. A win or a rest at home clears the count. A home is always leavable. | Kept. A long rest is the rest that clears it. |
| #1630 (open PR) | The Wait card reads **Observe**. The verb id stays `wait`; only the words change. | Rest is a second label for the same card. |
| #1583 | Level quests: the quest is the threshold, one per level, F(n) steps plus distance, it replaces wants, dropping it costs half your XP. | The long rest is the moment the quest is offered. |
| #1467, `reflections.mjs` | Thoughts and dreams come only from Wait. | The dream already exists; the long rest makes it due. |

## The game today

Line numbers are from `origin/main` at 8ef5d8ee.

**Wait.** Every avatar always has a Wait card
(`v2/card-game/world.mjs:1078`). A committed Wait ends a standoff guard, calms
the residents in the room (`world.mjs:1462-1475`, `calm` in
`pack-rules.mjs:425-435`), and calls an empty ship to the dock
(`world.mjs:2140`, `pack-transport.mjs:318-320`). Residents fall back to Wait
when they have nothing better (`world.mjs:1909`, `:1938`).

**Wait is already a short rest for the mind.** The scene marks the player as
`resting` only when they played Wait (`scene-cast.mjs:81-89`, `:178-183`).
Then a reflection is due: a thought after something new has happened, at most
every 6 turns, and a dream after two thoughts and 24 turns
(`reflections.mjs:26-55`). The model writes the thought and dream from game
facts.

**Return home.** When an avatar meets a want away from home, its next want is
a place want for its home (`want.mjs:200-232`). It gets +1 XP when it arrives.
If the want was met at home or at a sanctuary, the next real want is drawn at
once (`want.mjs:224-229`).

**Rest.** "Resting" means being at home within `REST_TURNS = 3` turns of
meeting a want (`want.mjs:23`, `:188-196`). It is not a play. A resting
resident idles (`world.mjs:1938`). Resting clears the run of losses
(`world.mjs:2137-2139`). So the loss reset only happens just after a want is
met at home. Going home and waiting does not clear it.

**Sanctuary.** A place is a sanctuary when its data says `"sanctuary": true`
(`world.mjs:153-155`). Only the forest station and attic say so
(`forest.json:23`, `:31`). The flag does one thing: it ends the way-home want
early (`want.mjs:226`). Pack places cannot carry the flag, because the pack
schema rejects unknown place fields (`pack-schema.mjs:420-436`). Threats,
sleep and losses ignore it.

**Losses.** `defeatInStandoff` (`world.mjs:933-997`) counts losses in
`s.defeats`. Three in a row (`DEFEATS_TO_SEND_HOME`, `:935`) send the loser
home with nothing in hand. Being sent home is not a crossing (`:977`).
Without a reachable home, the loser retreats instead. A win clears the
winner's count (`:941`).

**Hit points.** None. Resolve exists only inside a standoff. It starts at 4
for both sides (`world.mjs:1532`) and is gone when the standoff ends. Both
sides then get three turns of peace (`world.mjs:931`). The card game has no
fatigue, conditions or spell charges. Those were classic-only.

**Sleep.** Only pack residents with a `temperament` sleep. Talk wakes them
(`pack-rules.mjs:403-411`) and noise wakes them (`disturb`, `:413-420`). The
woken line (`t.woken`) is authored text.

**Time.** Day and night alternate every `DAYLIGHT_TURNS = 24` accepted plays
(`pack-rules.mjs:43`, `daylight.mjs:7-8`). Dark mist is night plus mist on the
ship (`daylight.mjs:10-11`). In shared worlds, every accepted play from any
player moves the one world clock ([shared worlds](shared-worlds.md#one-world-model)).
A lit lamp burns one fuel each round (`world.mjs:2083`).

**Levels.** XP comes only from wants met. Level is triangular: 0, 1, 3, 6, 10 XP
(`want.mjs:49-50`). Level quests (#1583) are designed, not built.

## Design

### What counts as a sanctuary

A sanctuary is a **place property in pack data**. The forest already uses it.
Allow `sanctuary: true` on pack places, and treat each avatar's own home as a
sanctuary **for that avatar only**. The engine never names a place.

Candidates are the forest station and attic (already marked), the Lonely
Forest's Cosy Cottage, Greece's Hillside Sanctuary and Eleusinian Sanctuary,
and the Hoppycat Tea Garden. The Willows River Camp should **not** be a
sanctuary. Its horror is that the camp is not safe at night
([Willows horror](willows-horror.md)). If the owner wants rest there, it
should be a short rest with risk.

The game does not mark sanctuaries on any map. A player learns a place is a
sanctuary when the card reads Rest there. Some sanctuaries can sit behind
gates or sea lanes nobody has found yet. That is fine (mystery over
reachability). The rule that every home is leavable stays.

### The card: one verb, two labels

The rules verb stays `wait`. Like Observe (#1630), the label comes from where
the avatar stands:

- away from a sanctuary, the card reads **Observe** (short rest);
- at a sanctuary, when a rest is **needed**, the card reads **Rest** (long rest);
- at a sanctuary with nothing to restore, it reads **Observe**.

"Needed" means the rules can see something for the rest to do: an open rest
want, a loss count above zero, or enough XP for the next level quest. The
player never sees a counter, only the label. The committed event keeps
`verb: "wait"` and adds `rest: "long"`. Old journals replay unchanged, because
events without the field mean exactly what they mean today.

### Short rest (Observe, Wait)

Keep it as it is. It takes one turn. It calms residents, may bring a thought
and an occasional dream, and calls the ship. There is no HP to restore, and
inventing HP would add a counter for no gain. **Recommendation:** a short rest
does **not** clear losses. Otherwise, two quiet turns would wipe out the
three-loss rule.

### Long rest (Rest at a sanctuary)

It restores or resets:

1. **Losses.** The loss count goes to 0. This replaces the narrow
   `resting` window in `world.mjs:2137-2139`.
2. **The rest want.** "Return home" becomes "rest at a sanctuary". It is met by
   a long rest at any sanctuary the avatar may use. It still gives +1 XP, so
   the XP curve does not change.
3. **The mind.** A thought and a dream are due, without waiting for the usual
   gaps.
4. **The next level.** If the avatar has enough XP for the next level, its
   level quest is drawn now and the dream voices it (see below).
5. **Calm.** Residents in the room calm down, as on any Wait.

It does not restore items. The rest does not bring dropped things back. It
does not refill the lamp, and it does not heal anything else.

It costs:

- **Time.** The world moves on. Lamp fuel burns, ships sail, other wants come
  closer to stalling, and residents act. The costs come from the clock and the
  rules already there, not from a new penalty.
- **Exposure.** A sleeping avatar is a sleeper like any resident: noise or
  Talk wakes it, using the existing rules. Waking early keeps whatever has
  already happened.
- **Nothing else.** It costs no money, and the game picks no encounter roll.

### Option A: an instant rest

A long rest is one play, like Wait, with the effects above. No extra time
passes.

- Smallest change. The same in solo and shared play.
- Rest can be taken again right away, but "needed" removes the label once
  nothing is left to restore.
- No real cost, so it reads like a menu button.

### Option B: sleep until the light changes (recommended)

The Rest play puts the avatar to sleep until the next daylight boundary (at
most 24 world turns). The avatar wakes when the light changes or when the
existing noise and Talk rules wake it. Then it takes the effects above, and the
dream plays as it wakes.

- **Solo:** the play runs the world rounds up to the boundary in one go, so
  the player sees the world change around them: "The light has changed."
- **Shared:** the clock moves only on accepted plays, so the sleeper's hand
  shows one card, Wake (the same Wait card), while other players move the
  world. No one can fast-forward anyone else.
- It reuses resident sleep. A human just gains the same sleep state.
- The cost comes out of the world itself (lamp, ship, other avatars' moves),
  and night has a reason to exist.
- The engine change is moderate: a fast-forward loop in solo and sleep for
  humans. One rules version.

### Option C: graded rests and fatigue (not recommended)

Bring back ADR 0004's Hearth/Lodged/Camp grades with a fatigue counter and a
short-rest allowance. This is closest to D&D. It adds hidden state, a new
gauge and pack fields, and the classic game already had the soft-lock in #313.
It goes against short prompts, fixed verbs, and cheap pack data.

### Shared worlds

- Rest is a rules change, so it needs a new shared rules version, with released
  bundles pinned for replay. Batch it with the level-quest engine change
  (#1583) so there is one rules version instead of two.
- Sanctuary is pack data. Marking a new sanctuary is a pack revision, not an
  engine change.
- Humans can threaten humans (#1511). **Recommendation:** nobody may threaten
  a sleeper in a sanctuary. Today the sanctuary flag does not stop threats at
  all. This is the one safety rule sanctuary should own (#492's contract).
  Threats against people who are awake there stay as they are.

### Level quest in a dream

The owner asked whether this is too complex. **Honest take:** it is not, if
the dream is only *the moment the quest is offered*, and not a new system.

The simplest data-driven form:

1. XP still rises from ordinary wants. Reaching the threshold changes nothing
   by itself.
2. On a long rest, if XP has reached the next level's threshold and no level
   quest is open, the rules draw the level quest with the #1583 generator
   (F(n) steps, places further from home). It becomes the avatar's single
   want, as #1583 says. This is a rules event, `level_quest_offered`.
3. The reflection that is already due on the rest gets the quest's first
   target as facts in its dream brief. The model writes the dream. There are
   no authored dream lines. If the dream call fails, the quest still exists
   and the dream shows "…".
4. Dropping the quest still costs half your XP. You fall back under the
   threshold, so the next long rest offers nothing until you earn it again.

Risks to accept or avoid:

- **Items and places do not rest.** #1583 gives them levels too. They should
  get their level quest when they reach the threshold, or when their holder
  takes a long rest. Making them dream would be extra machinery.
- **Levelling now needs a sanctuary.** That gives a reason to come home, and
  it fits mystery over reachability. A player far from any sanctuary waits
  longer.
- **Residents** take the rest want and play Rest like players do, so the same
  rule covers them. In solo they sleep in place and do not fast-forward the
  world.

## Recommendation

- Sanctuary is a pack flag, plus your own home.
- A **Rest** label replaces Observe at a sanctuary when a rest is needed.
- **Option B:** sleep until the light changes, wakeable. Instant in solo,
  slept through in shared.
- The long rest clears losses, meets the rest want, makes a dream due and
  offers the level quest.
- Short rest stays as today, with no loss reset.
- Ship it in the same rules version as level quests.

## Owner decisions needed

1. Sanctuary set: is your own home plus pack `sanctuary: true` right? Which
   places get the flag, and is the Willows camp excluded?
2. Long-rest cost: Option A (instant) or Option B (sleep until the light
   changes)?
3. Does a short rest clear any losses? The recommendation is no.
4. Does Rest show only "when needed", or at every sanctuary?
5. Does the rest want stay worth +1 XP, and can any sanctuary meet it, or only
   home?
6. Is a sleeper in a sanctuary safe from Threaten?
7. Level quest in a dream: avatars only, with items and places offered at the
   threshold? Is it bundled into the #1583 rules version?
