# CosyWorld Rules: SRD 5.2.1

This pack adapts the same deliberately small reference surface as the SRD 5.1
pack into the `cosyworld.rules/1` contract.

- `conditions.json` contains the fifteen revised conditions. Only
  `condition/unconscious` names an existing C-kernel primitive; the other
  conditions remain `reference_only`.
- `monster_seeds.json` contains revised Dryad, Sprite, and Unicorn conversion
  seeds. No source statistic or feature is automatically applied to an actor.
- `ATTRIBUTION.md` contains the required CC-BY-4.0 attribution.

The selected source data lives in
`reference-library/rpg-systems/raw/srd-5.2.1-cosyworld.json` and was transcribed
from the official SRD 5.2.1 release. Regenerate the pack with:

```sh
npm run v2:srd:import
npm run v2:srd:check
```

This pack has its own `srd5.2.1` namespace. It never overlays or silently
upgrades the separately licensed `srd5.1` bundle.
