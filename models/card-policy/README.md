# Production card-policy artifact

`incumbent.cwrank` is the deterministic integer ranker deployed in production
shadow mode for CosyWorld `0.0.318`.

- artifact format: `CWRANK2`, version 2
- artifact size: 516 bytes
- feature-schema hash: `13240306902827014407`
- model hash: `2166234326586644210` (`1e1002a4907456f2`)
- SHA-256: `c670bf6efac8e95f9bed910955aded920d3570c8c483d0533ea980c9f53e2962`
- training seed: 1
- selected epoch: 41 of 49 completed

The model was trained from 1,000 synthetic train worlds with 200 calibration
and 200 held-out evaluation worlds, four trajectories per world and a 48-turn
budget. Its fixed-seed 10,000-avatar top-3 regression found treasure in every
episode. See `v2/docs/card-policy-ranker.md` for the full contract and metrics.

Rebuild with the documented `card-policy-lab pipeline` command and verify that
the model hash, schema hash, SHA-256, held-out metrics, and population regression
all match before replacing the incumbent.
