# Resident sleeping art

Sleeping art for the remaining mounted residents, requested on 2026-11-04.
The roster comes from `pack-registry.mjs` at commit `f6f738464`.
It has 49 portrait identities covering 55 actor IDs. The eight shared travelers,
Pip, the keeper and Badger already have sleeping art. Patroclus is in PR #2289.

Each new pose keeps the resident's face, age, clothes and paint style. Eyes are
closed and hands rest empty. Worn costume details remain part of the figure.
People sit at rest; Skull and Whiskerwind curl up. Glim's bowl rests on folded
legs. Oak keeps his wooden face. Each transparent canvas has room above the pose.

Status: all 49 portraits are saved and checked, covering all 55 roster actor IDs.
Dione and Antigone now use their registered sleeping portraits in the hand and
scene while their committed state is asleep. Waking restores their ordinary
portraits. The remaining source PNGs are an art handoff for later registration
and final WebP exports.

The [roster](roster.json) records shared identities and actor aliases.
[Prompts](prompts.json) record each source reference and generated PNG path.
[File checks](validation.json) record dimensions, hashes and transparency.
All generation uses the built-in image tool. Generated source bytes are preserved.

The five contact sheets show every figure over light or dark backgrounds:
[Greek cast 1](review-01.png), [Greek cast 2](review-02.png),
[Greek and archive cast](review-03.png), [Archive and forest cast](review-04.png),
and [BoardyAI](review-05.png).
Checks cover 1024 by 1536 RGBA files, clear alpha, source hashes, complete poses,
closed eyes and coverage of every roster entry.
