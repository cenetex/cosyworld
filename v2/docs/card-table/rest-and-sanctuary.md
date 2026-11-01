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
- **Long rest.** Wait at a sanctuary puts the avatar to sleep until the next
  light change (the next multiple of `DAYLIGHT_TURNS` on the world clock).
  While it sleeps, Wait is its only play. When it wakes, every loss is
  cleared and a dream comes.
- **No short rest.** Wait anywhere else changes no loss. The owner dropped
  #1648's short rest on 2026-11-01, so players and residents share one rule.
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
starts, so most hub play would sleep on every Wait. The opening starts in the
attic, so a first Wait there sleeps the night, and the lamp burns down
while Vale sleeps. Badger's glade, by the old Steam Clock, is a hidden part
of the Lonely Forest, so it shares the Cosy Cottage. Moving or adding a
sanctuary is a one-line pack change.

A sanctuary is not marked on any map. A player finds out when a Wait there
sleeps until the light changes. Some sanctuaries sit behind gates or sea lanes
nobody has found yet; that is fine (mystery over reachability).

## Sleep

Sleep is the player's own play, in solo and shared play alike. Residents idle
with Wait all the time, so their Waits put nobody to sleep. A resident still
rests where it meets a want, holding the next one (#1824). Nobody rests in the
middle of a standoff.

1. The player's Wait at a sanctuary sets `actor.sleepUntil` to the next light
   change.
2. While `sleepUntil` is set, the avatar's only legal play is Wait. A Wait
   before the light changes does nothing else.
3. The first Wait at or after `sleepUntil` wakes the avatar: `sleepUntil` is
   removed, the avatar's losses are cleared, and the committed wait event
   carries `rest: "long"`.

In **solo** play the clock moves only on the player's plays, so the rules run
the sleeper's Waits in the same play until it wakes. The player sees the world
after the night: other avatars have moved, the lamp has burned, ships have
sailed. In **shared** play the clock moves on every accepted play, so a sleeper
keeps a hand of one card, Wait, until the light has changed; nobody
fast-forwards anyone else. Noise and Talk do not wake a sleeper early.

Old journals replay unchanged: an avatar without `sleepUntil` and an event
without `rest` mean what they always meant.

## Losses

Three straight losses still send an avatar home with nothing in hand, and a
win still clears the count (#1505). Players and residents share one rule
(owner, 2026-11-01): any Wait at a sanctuary clears the count, at any time,
whether or not a want was just met. A resident's rest where it met a want
clears nothing unless that place is a sanctuary. Only a rest at a sanctuary
changes the count. A player's Wait there is a long rest, which clears the count
as the avatar falls asleep. A Wait anywhere else leaves the count as it is.

## Dreams

Thoughts and dreams still come only to the avatar who waited
(`reflections.mjs`, mirrored by `reflection_due` in `card_narrative.rs`).
Waking from a long rest (`rest: "long"` in the scene context) makes a thought
and a dream due at once, without the usual gaps. The model writes the dream
from the scene's facts. There are no authored dream lines. A failed dream call
shows "…", like any failed voice.

## Level quest

When an avatar has enough XP for its next level and wakes from a long rest,
the rules draw its level quest (#1583: F(n) steps, reaching further from home
as n rises). It replaces the want on the quest card. After its last step
comes the way back: a rest step at the last sanctuary the avatar stood in
(`actor.sanctuary`, set whenever it is at one). The level rises when it wakes
from a long rest there, not on arrival. An avatar always wakes into its level
quest at a sanctuary, so the fallback to its home for one that never stood in
a sanctuary only covers states from before #1824. Ordinary quests never send
anyone home. The dream that comes with
the waking gets the quest as facts, so the model voices it; no line is
authored. Dropping a level quest costs half the avatar's XP.

## Prior art

| Source | Kept |
| --- | --- |
| ADR 0004, #348, #356, #603, #604, #784 (classic rest grades and fatigue) | Sanctuary is safe and costs no money. Grades, counters and fatigue are dropped. |
| #313 (classic soft-lock) | Rest never waits on a counter the player cannot see. |
| #492 (classic sanctuary) | Nothing harmful starts in a sanctuary: no attacks there. |
| #1505, #1540 | Three losses send you home; a win clears the count. |
| #1630 | The Wait card read Observe; #1718 restored Wait. The verb stays `wait`. |
| #1467 | Dreams come from Wait; the long rest makes one due. |
