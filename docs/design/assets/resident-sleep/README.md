# Resident sleeping art

Sleeping art for the remaining mounted residents, requested on 2026-11-04.
The roster comes from `pack-registry.mjs` at commit `f6f738464`.
It has 49 portrait identities covering 55 actor IDs. The eight shared travelers,
Pip, the keeper and Badger already have sleeping art. Patroclus is in PR #2289.

Each new pose keeps the resident's face, age, clothes and paint style. Eyes are
closed and hands rest empty. Worn costume details remain part of the figure.
The full transparent canvas preserves room above a compact seated pose.

Status: 30 portraits are saved. The remaining 19 portraits are in progress.
These source PNGs are an art handoff. Game selection and final WebP exports are
future work.

The [roster](roster.json) records shared identities and actor aliases.
[Prompts](prompts.json) record each source reference and generated PNG path.
[File checks](validation.json) record dimensions, hashes and transparency.
All generation uses the built-in image tool. Generated source bytes are preserved.
