# Combat by tier

Owner rules, 2026-11-01: "avatars in the same level tier should be equal; it
is only when they hit the next tier (a different colour) that they get
stronger. A I and a II are equally matched." Strike damage is also random
instead of fixed.

## Tiers

The tiers are the card border bands in `v2/card-game/level-tiers.mjs`
(Common 0–9 up to Mythic 100+). The browser's colours (`rarity.mjs`) and the
rules (`world.mjs`) import that one table and compare each tier's `rank`.

## Strikes

`strikePower` is the most a strike can land, by the attacker's tier against
the target's: 3 when higher, 2 when the same, 1 when lower. A gap of several
tiers is still one step. `strikeDamage` rolls 1 to that most: 1–3, 1–2 or 1.

Brace still takes one off, with a minimum of one. Four resolve lasts two to
four strikes between equals.

The roll is `runHash(world, "strike:<revision>:<attacker>:<target>")`, the
FNV-1a hash of the run seed and a key that the seeded `chance` condition
(#1694) already used; `pack-rules.mjs` now exports it for both. The revision
is the play's, so the browser, the C-hosted server rules and a journal replay
all roll the same number. The attack event's `damage` and text record the
roll, so combat beats show the real "−1/−2/−3 resolve".

## Other level comparisons

Changed to tiers (relative strength between two actors), via `outranks`:

- A threatened resident answers with Talk only when it outranks the
  challenger; otherwise it braces.
- A resident is bold enough to threaten an owner it outranks (resentment and
  repeated refusals still count as before).

Kept on levels (progression and gating, not a contest):

- Experience to level (`levelFor`) and the level quest (`want.mjs`).
- Quest steps: Threaten and Attack join drawn steps from quest level 20
  (`HOSTILE_LEVEL`), which is the Rare threshold written as a level.
- `startLevel` and saved `level` validation; rarity portraits by level.

## Replay

This is rules 83. Rules 82 and every earlier bundle stay pinned, so a world
journaled under them replays its strikes with their fixed level damage; the
one recorded upgrade moves it onto rules 83. `combat_tests.rs` checks that a
rules 82 journal keeps its strikes through the upgrade and a replay without
checkpoints, and that strikes after it match the seeded roll in the C host.
