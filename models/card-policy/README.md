# Production card-policy artifact

`incumbent.cwrank` is the deterministic integer ranker deployed in production
shadow mode for CosyWorld `1.0.115`.

- artifact format: `CWRANK2`, version 2
- artifact size: 516 bytes
- feature-schema hash: `13240306902827014407`
- model hash: `9410714248180230142` (`829992bfa57d67fe`)
- SHA-256: `778558accea1d57cc7fbb1a169cbc2c29d37672971141e2800421c9131775cf4`
- training seed: 22
- selected epoch: 7 of 15 completed

The model was trained from 2,000 synthetic train worlds with 400 calibration
worlds, four trajectories per world and a 48-turn budget. Against the frozen
400-world evaluation set it lowered mean regret from 572 to 566 milli-steps,
raised zero-regret choices from 468 to 478 per thousand, and raised adapter
agreement from 527 to 535 per thousand. Its fixed-seed 10,000-avatar top-3
regression found treasure in every episode and improved mean turns from 8.190
to 8.174, with p50/p90/p99 of 8/12/15 turns.

The current real-objective audit produced valid replay rows but no strict
preference signal, so it was not used to authorize live rollout. The artifact
remains in shadow mode while the supervised collector gathers more varied
held-out objectives. See `v2/docs/card-policy-ranker.md` for the full contract.

Rebuild with the documented `card-policy-lab pipeline` command and verify that
the model hash, schema hash, SHA-256, held-out metrics, and population regression
all match before replacing the incumbent.
