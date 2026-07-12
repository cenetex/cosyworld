# CosyWorld Rules: SRD 5.1

This pack adapts a deliberately small part of SRD 5.1 into the
`cosyworld.rules/1` contract. It is reference data, not a second rules engine.

- `conditions.json` contains the fifteen SRD 5.1 conditions. Only
  `condition/unconscious` maps to a current C-kernel flag. Every other condition
  is explicitly `reference_only`.
- `monster_seeds.json` contains three nature/fey conversion seeds. Their source
  statistics and features are available to authors, but no value is applied to
  a runtime actor automatically.
- `ATTRIBUTION.md` is compiled into the official bundle and must travel with any
  redistributed derivative.

Regenerate the data from the pinned local CC-SRD checkout with:

```sh
npm run v2:srd:import
npm run v2:srd:check
```

Do not copy the source JSON's `License: CC-BY-SA-4.0` field. That field conflicts
with the source README and the official SRD release. This pack uses the official
CC-BY-4.0 license and required attribution statement.
