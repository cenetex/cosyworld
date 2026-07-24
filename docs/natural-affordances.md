# Natural Affordances

Natural affordances are durable truths about what a location can support. They
are separate from room-sheet capacities such as warmth, quiet, shelter, and
distance, and they never mint an item or create a harvest action by themselves.

## Authority boundary

Each eligible authored location declares:

- a versioned, typed `environment` profile;
- `natural_potentials` using the closed `guaranteed`, `impossible`, or
  `weighted` policies; and
- for every possible result, a typed richness, character, presentation key,
  and subset of the approved building archetypes for that resource kind.

Generated locations interpolate typed environment fields from their anchors.
They use deterministic engine rules to derive potential rows; biome prose and
AI output are not mechanical inputs.

The runtime freezes one latent result with:

```text
official world id
+ location id
+ environment profile version
+ natural-affordance algorithm version
```

Selection is order-independent and stored in `natural_affordances`. Provider
and model are recorded as `none`: inference may decorate later prose but cannot
choose presence, richness, character, or buildings.

Compiler and checker both call
`v2/scripts/natural-affordance-schema.mjs`. The shared validator rejects
unknown environment tags, resource kinds, building references, duplicate
rules, and impossible/possible contradictions.

## Investigation

An eligible location receives one shared four-segment survey clock and two
ordinary action strategies:

- `check` / Wisdom reads visible signs;
- `study` / Intelligence compares patterns.

Each successful strategy contributes two segments and is once-per-actor. A
failure contributes nothing and consumes that scoped attempt; neither failure
nor repetition can reroll the frozen result. Calling, title, practice, actor
kind, and controller mode do not enter selection, eligibility, or strategy
requirements.

Three narrated thresholds precede completion:

1. useful signs become distinguishable;
2. the resource family becomes known;
3. the exact site is narrowed.

Future-threshold previews remain generic so they do not leak latent state.
Filling the clock emits `natural_feature.revealed` with the environment
version, generation provenance, and durable contribution-event sequence list.

## Public projection

Before reveal, obvious location description, biome, terrain, and environment
remain visible, while `natural_features` and
`eligible_building_archetypes` are empty.

After reveal, the room sheet and inspector expose the typed feature and the
approved building IDs. The latent potential table remains private. This gives
#154 and #160 a bounded eligibility input without mixing natural resources into
aggregate room capacities or creating physical stock.

Natural state, clocks, causal evidence, and revealed features are included in
snapshots and regenerated deterministically during journal replay. Pack
unmount migration removes location-scoped natural state, clocks, and jobs
together.
