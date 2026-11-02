# Rest and sanctuary

Status: decided by the owner on #1648 (2026-11-01). It ships with level quests
(#1583) and the quest card (#1689) in one batch of rules.

## The rules

- **One sanctuary per world.** A sanctuary is a place property in pack data,
  `"sanctuary": true`. Each world has exactly one. The Willows has none,
  because its camp is not safe at night ([Willows horror](willows-horror.md)).
  The ship is not a sanctuary. The engine never names a place.
- **Wait is the only rest.** There is no Rest card. The Wait card keeps its one
  verb, `wait`, everywhere.
- **Long rest.** Wait is always one turn. A Wait right after a Wait can be
  Sleep (rules 89, [#2028](https://github.com/cenetex/cosyworld/issues/2028)).
  Sleep at a sanctuary that lasts at least half a light period
  (`LONG_SLEEP_TURNS`, 12 turns) is a long rest: when the avatar wakes, every
  loss is cleared and a dream comes. A shorter Sleep there only clears losses.
- **No short rest elsewhere.** Wait anywhere else changes no loss. The owner
  dropped #1648's short rest on 2026-11-01, so players and residents share one
  rule.
- **No fighting in a sanctuary.** Threaten is allowed there; Attack is not. A
  standoff in a sanctuary ends by guarding, yielding or waiting it out.
- **No XP for resting.** Experience still comes only from wants met, so
  nobody can earn levels by sleeping. (Default; the owner may revisit.)
- **The level quest arrives in the dream.** See [Level quest](#level-quest).

## Sanctuaries

| World | Sanctuary |
| --- | --- |
| Reflected shore (hub) | Mirror attic (Vale's home) |
| Greece | The Hillside Sanctuary |
| Hoppycat | Halfway Tea Garden |
| Lonely Forest | Cosy Cottage |
| Badger's glade | part of the Lonely Forest: the Cosy Cottage |
| Willows | none |

The hub picks the Mirror attic, Vale's warm home, over the Empty station. The
station is where the keeper lives and where a table without the opening
starts. The opening starts in the attic: Sleep there wakes Vale as the lamp
gutters at its last oil (nine turns, a short rest). Sleep is not offered beside
a lit lamp with one oil left, so the next play is a plain Wait, which burns it
out and opens the mirror. Badger's glade, by the old Steam Clock, is a hidden part
of the Lonely Forest, so it shares the Cosy Cottage. Moving or adding a
sanctuary is a one-line pack change.

A sanctuary is not marked on any map. A player finds out when a Sleep there
brings a dream. Some sanctuaries sit behind gates or sea lanes
nobody has found yet; that is fine (mystery over reachability).

## Sleep

Sleep is the player's own play, in solo and shared play alike. There is no new
verb: it is `wait` with `sleep: true`, labelled "Sleep" (key
`sleep:<actor>::`). `legalActions` offers it after the plain Wait only when the
actor's last committed play was a Wait (a waking counts), and never aboard a
ship, during a standoff, or where a lit lamp has one oil or less left: that
Sleep would sleep through the burnout, so the player gets a plain Wait, which
burns the last oil and opens the mirror. Residents never sleep. The client
keeps the card selection unchanged to show it.

1. Sleep sets `actor.sleeping = {since, place, present}`, where `present` is
   the sorted set of avatars physically in the place (a seat counts while its
   human is present). Being discovered or met is not arriving.
2. While `sleeping` is set, the sleeper's plays are Sleep (sleep on), first,
   plus its normal plays. Choosing any other play wakes it first (`woke:
   "chose"`, "Vale wakes."), then performs that play. Picking a quest card
   (`focus`) passes no time and does not wake it. So a shared seat is never
   stranded asleep.
3. Each round, after the lamp burns, every sleeper wakes at the first of:
   being moved from where it fell asleep (`moved`, "Vale wakes in Black
   pond."), the lit lamp where it sleeps at 1 oil (`lamp`), the lamp running
   dry there (`dry`), someone arriving (`arrival`) or leaving (`departure`), a
   way out of the place opening or closing (`crossing`), a standoff holding it
   (`threat`), a ship docking there (`dock`), dawn or dusk after it fell asleep,
   when `turn % DAYLIGHT_TURNS` is 0 (`dawn`, `dusk`), or 24 turns asleep
   (`rested`). No Sleep sleeps past the mirror opening. All are deterministic.
4. Waking removes `sleeping` and logs a wait event with the reason in `woke`
   and a caption: "Vale wakes as the lamp gutters.", "Vale wakes as Pip
   arrives.", "Vale wakes at dawn." A travelling human is named before a
   resident; the sleeper is never named as arriving or leaving itself.
5. A Sleep in the sanctuary where it fell asleep that lasted `LONG_SLEEP_TURNS`
   (12, half of `DAYLIGHT_TURNS`) or more is a long rest: the wake event
   carries `rest: "long"`, losses clear and `wake` (`want.mjs`) completes a rest
   step or brings the level quest. A shorter one is a short rest: losses clear,
   with no forced thought or dream. Because every Sleep ends by the next light
   change, two long rests cannot both begin and end within one light period,
   so a sanctuary gives at most one dream per period.
6. Waking from any Sleep ends contentment (rules 90): an avatar whose last
   ordinary want was met with nothing beneath has no want until then, and
   `renewWant` draws its next one as it wakes.
7. Sleeping on at a dock calls no ship. Only the plain Wait before the Sleep
   calls it one lane closer, so a long sleep does not haul the ship across the
   sea; a ship that docks there still wakes the sleeper.

In **solo** play the clock moves only on the player's plays, so the rules run
the sleeper's turns in the same play until it wakes. The run stops at the
first refused play and is bounded by the 24-turn cap; residents act meanwhile.
In **shared** play the clock moves on every accepted play, so each round
checks every seat's sleeper and others' plays wake it; nobody fast-forwards
anyone else. A long rest woken by another seat's play is that sleeper's
waking scene at its own next play (`restingWake` in `scene-cast.mjs`), so its
thought and dream are due then and the `reflect` op accepts them.

Old journals replay unchanged on their own bundles. A save from before rules
89 loses `sleepUntil` when it loads, so its sleeper is simply awake.

## Losses

Three straight losses still send an avatar home with nothing in hand, and a
win still clears the count (#1505). Players and residents share one rule
(owner, 2026-11-01): any Wait at a sanctuary clears the count, at any time,
whether or not a want was just met. A resident's rest where it met a want
clears nothing unless that place is a sanctuary. Only a rest at a sanctuary
changes the count. A Wait anywhere else leaves the count as it is.

## Dreams

Thoughts and dreams still come only to the avatar who waited
(`reflections.mjs`, mirrored by `reflection_due` in `card_narrative.rs`).
Waking from a long rest (`rest: "long"` in the scene context) makes a thought
and a dream due at once, without the usual gaps. The model writes the dream
from the scene's facts. There are no authored dream lines. A failed dream call
shows "…", like any failed voice.

## Level quest

When an avatar has enough XP for its next level and wakes from a long rest,
the rules draw its level quest (#1583: ceil(n / 5) steps, reaching further from home
as n rises). It goes on top of the quest stack, above the ordinary quests,
which wait beneath it (#1831). After its last step
comes the way back: a rest step at the last sanctuary the avatar stood in
(`actor.sanctuary`, set whenever it is at one). The level rises when it wakes
from a Sleep there, not on arrival. An avatar always wakes into its level
quest at a sanctuary, so the fallback to its home for one that never stood in
a sanctuary only covers states from before #1824. Ordinary quests never send
anyone home. The dream that comes with
the waking gets the quest as facts, so the model voices it; no line is
authored. Dropping a level quest costs half the avatar's XP; dropping an
ordinary quest costs nothing.

## Later: a visit's length

Planning, not built (pack data and quest tuning, no new rule). A visit should
meet one want in 10 to 20 minutes and then point home: the want met leaves the
avatar near enough to its last sanctuary that a long rest is the natural next
play. Tune want reach and level quest length in pack data so a session has a
clear stopping point. Nothing punishes stopping or rewards staying longer.

## Prior art

| Source | Kept |
| --- | --- |
| ADR 0004, #348, #356, #603, #604, #784 (classic rest grades and fatigue) | Sanctuary is safe and costs no money. Grades, counters and fatigue are dropped. |
| #313 (classic soft-lock) | Rest never waits on a counter the player cannot see. |
| #492 (classic sanctuary) | Nothing harmful starts in a sanctuary: no attacks there. |
| #1505, #1540 | Three losses send you home; a win clears the count. |
| #1630 | The Wait card read Observe; #1718 restored Wait. The verb stays `wait`. |
| #1467 | Dreams come from Wait; the long rest makes one due. |
