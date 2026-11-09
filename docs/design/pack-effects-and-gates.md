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
- `actor_at` — the current player (or a named `actor`) stands at the place.

## Done (draft PR #2561)

1. `held`, `grounded`, `actor_at` conditions (with tests).
2. `light` redefined to "the player holds the oil and the lamp is held or
   grounded" (`c.fuel` defaults to `oil`); the `uncovered` field dropped from
   the schema and data.
3. `covered` (black-cloth covering) removed from rules and presentation.
4. Five reflection/secret-path rules as data:
   - pond mirror → attic: `held(lamp) + light(lamp @ pond)`;
   - attic mirror → pond: `not(light(lamp @ attic))`;
   - cottage stairs: `light(lamp @ attic) + held(cloth) + actor_at(attic)`;
   - steam-clock path: `held(bell) + actor_at(pond)`;
   - Charybdis: `light(lamp @ pond) + grounded(lamp) + held(cloth)`.
5. Save migration `upgradeReflectionGatesSave` drops the orphaned signal
   `phase`/`until` for the two crossings that became static gates.
6. `baseSoundAt` generalised from "the bell" to "any ringing hub object".

## Remaining

- Home rescue: `insideLampRemedy`, `pondRescueExit`, `homeGateRecoverable`,
  `homeRescueExit` still read `lamp.fuel`/`lit` and hardcode the attic/pond.
- Station hub: `stationCandidates` / `stationTargets`.
- Interior traversal: `atticInterior` (BFS of the isolated home interior).
- Remove the now-unread `lit`/`fuel` fields from save state (replay-sensitive).
- Test sweep: ~239 old-puzzle tests still assert the previous lamp/reflection
  behaviour and need rewriting to the new rules.
