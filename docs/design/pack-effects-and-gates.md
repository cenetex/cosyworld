# Pack effects and gates instead of special cases (#1550)

Replaces the item/place-specific branches in the rules engine with generic
pack vocabulary, so forest.json and the compiled packs express behaviour as
data. Tracked in `docs/design/pack-content-outside-the-engine.md` ("Later:
pack effects and gates").

## Condition vocabulary

`pack-schema.mjs` `CONDITION_KINDS` and `pack-rules.mjs` `conditionMet` own the
conditions a crossing, route, topic, or reflection can require. Added kinds:

- `held` — the current player (or a named `actor`) carries the thing.
- `grounded` — the thing rests on a place, not in a hand or inside another
  thing.

## Plan

1. Add `held` and `grounded` (done).
2. Redefine `light` to "the player holds the oil and the lamp is held or
   grounded" (replaces the `lit`/`fuel`/`uncovered` bookkeeping), and drop
   `covered`.
3. Express the five reflection/secret-path rules in `forest.json`:
   - attic mirror ← lit lamp held at the pond;
   - pond mirror ← dark attic;
   - cosy cottage ← black cloth in the lit attic;
   - old steam-clock path ← bell held at the pond;
   - Charybdis ← wait + cloth held at the pond + lit lamp on the ground.
4. Delete the bespoke functions (`covered`, `shining`'s fuel check,
   `insideLampRemedy`, `pondRescueExit`, `homeGateRecoverable`, `atticInterior`).

Each step is a behaviour change and is guarded by the #1387 equivalence harness.
