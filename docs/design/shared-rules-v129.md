# Restore generated outputs after the merged extraction

The world-module extraction (#1390) and the held/grounded conditions (#1550)
merged into `main` without rebuilding the generated outputs they feed, so the
`build-card-shared-engine.mjs --check`, `build-card-shared-narrator.mjs
--check`, and `build-card-authored-text.mjs --check` checks diverged, `npm test`
went red, and the `.dev` train's production Node gate failed on the next real
rollout.

## What changed

- `engine-v128.js` stays live and is now pinned for journal replay. The branch
  mints `engine-v129.js` from the current source and updates the released-rules
  wiring (`engine.rs`, `full_world.rs`, `build-card-shared-engine.mjs`,
  `card-released-rules.test.mjs`) so `SOURCE`/`VERSION` point at v129 and v128
  remains an exact historical interpreter.
- `narrator.js` (unversioned, rebuilt whenever its sources change) and
  `authored-text.json` (the authored scene-text catalog) are rebuilt from the
  same source.

## Behaviour

No rules behaviour changes. The shared-rules bytes differ from v128 because the
extracted modules and the new pack conditions reorder the bundle, and journals
replay against exact bytes, so the new content gets the next version rather than
overwriting the released one. The narrator and authored-text catalogs only pick
up the new condition vocabulary (`held`, `grounded`) and the extraction's
reordering.
