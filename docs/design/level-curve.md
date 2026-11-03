# Level curve

Status: Decided by the owner (2026-11-02) and built in rules 90
([#2020](https://github.com/cenetex/cosyworld/issues/2020) review batch).

## Problem

The level quest for level n had F(n) steps (Fibonacci). Level 20 alone was
6,765 steps and reaching Legendary (level 50) took about 3.3 × 10^10, so the
upper tiers in `level-tiers.mjs` could never be reached. Threaten and Attack
also joined drawn person steps from level 20, with targets picked by hash
and no check that the fight was possible.

## Rule

- The quest for level n has `questSteps(n) = ceil(n / 5)` steps
  (`QUEST_STEP_LEVELS` in `want.mjs`), then the rest step that raises the
  level. That is one step through level 5, two through level 10, ten at
  Legendary and twenty at Mythic.
- A player's next level quest comes on a long rest once its experience
  reaches `questXp(n)`: the one quest met before the first level quest, plus
  one point for each step and rest of its earlier level quests. The level
  quests feed themselves, so ordinary wants are surplus and never the gate.
  With the old F(n) curve this sum was the triangular curve `levelFor`;
  residents still level on `levelFor` alone.
- No step is violent. A person step is Talk (the person want itself) or
  Meet, at every level. Threaten and Attack steps saved before rules 90 stay
  valid and are met as before; none is drawn.
- A saved level quest keeps at most the steps its level now has (load
  migration in `legacy-saves.mjs`).
- The quest card's tier colour is the tier of the level the quest leads to,
  and its verb is the step's own (Find, Give, Bring, Meet; a rest step shows
  the way there).

## Table

Steps are the level's own quest; cumulative columns count every level quest
from level 2. The test in `test/card-level-quest.test.mjs` reads these rows.

| Level (tier) | Steps | Cumulative steps | With rests |
| --- | --- | --- | --- |
| 10 (Uncommon) | 2 | 14 | 23 |
| 20 (Rare) | 4 | 49 | 68 |
| 30 (Epic) | 6 | 104 | 133 |
| 50 (Legendary) | 10 | 274 | 323 |
| 100 (Mythic) | 20 | 1049 | 1148 |

## Estimate

Assumptions: a step takes about 8 plays (moves toward a target drawn from
the far half of the known world, then the act), a rest step about 10 (the
way back and a Sleep), and a play about 15 seconds, so a 30-minute session
is about 120 plays. A Sleep runs many turns in one play, so plays, not
turns, measure time.

- Legendary: 274 × 8 + 49 × 10 ≈ 2,700 plays, about 11 hours or 22 sessions.
- Mythic: 1,049 × 8 + 99 × 10 ≈ 9,400 plays, about 39 hours.

Contentment ("enough for now", [quest stack](quest-stack.md)) does not slow
this: a finished level quest draws the next want at once, and every rest
step ends in a Sleep.

## Tiers and level-gated rules

Strikes compare tiers, not levels ([combat by tier](combat-by-tier.md)), so a
faster climb only changes how soon a player reaches the next band. Residents'
levels are unchanged. Nothing else is gated on quest level now that
`HOSTILE_LEVEL` is gone.

Replay: journals before rules 90 replay on their own bundles.
