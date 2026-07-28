# Project 89 location and item art test 001

Date: 2026-07-28

Status: the second Threshold Interface candidate and first Agent Memory Seed
candidate pass initial visual review. They remain test artifacts until they
are copied into content-addressed pack storage and receive explicit approval.

## Shared recipe

All jobs used Project 89 revision
`95f3d0eb7bdceb1262a2824c1a623e01b1902b71420013e6bc7b760e9f9255d6`,
the `P89` trigger, FLUX `dev`, LoRA scale `1.0`, 28 steps, guidance `3`, one
WebP output, quality `80`, and the enabled safety checker.

## Threshold Interface

Intent: `location_card_art`

Expected shape: `16:9`

Publication policy: an empty architectural environment with no people,
characters, creatures, readable text, logos, or watermarks.

| Attempt |        Seed | Prediction                   | Output                                                                                 | Decision                                                                                |
| ------- | ----------: | ---------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1       | `852318911` | `gtp1bqn081rmy0cznb08jjez7r` | `1344x768`; SHA-256 `795bcdb9c263b9a8c9ea825bdd4df7a5187ef03790a4eda8217aab44bfbee455` | Reject: two small scale figures and glyph-like orange panels.                           |
| 2       | `336436226` | `c386g4zagnrmr0cznb0t9zq92w` | `1344x768`; SHA-256 `df1bf3764c9cd2198ca993b571acbd10fe48b5175b94c704dbcd0516fa36a8f9` | Pass initial visual review: empty architecture, intended palette, clean landscape crop. |

The second prompt explicitly excluded scale figures, humanoid shapes,
statues, mannequins, robots, signs, terminals, screens, panels, labels, and
glyphs. This was more reliable than the shorter generic `no people` suffix.

The location has one canonical art identity:

```text
project89.operation-liberation/location/threshold-interface/project89-location/1
```

A rejected attempt does not create another location, alter routes, or consume
a new world-state identity. It only advances the bounded media attempt count.

## Agent Memory Seed

Intent: `item_card_art`

Expected shape: `1:1`

| Attempt |         Seed | Prediction                   | Output                                                                                  | Decision                                                                                                   |
| ------- | -----------: | ---------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1       | `1049133321` | `sek3a3z1r9rmt0cznb0bzt8de8` | `1024x1024`; SHA-256 `8a5996889627684a4f265c458e299a542e45717e791abe281b0c0ca8868d473d` | Pass initial visual review: isolated object, clear silhouette, no people, hands, text, logo, or watermark. |

The item type has one canonical art identity:

```text
project89.operation-liberation/item/agent-memory-seed/project89-item/1
```

Every dynamic Agent Memory Seed instance references that approved item-type
art. Per-actor identity lives in the typed materialization receipt, item
instance id, owner history, and actor binding. It does not require another
billable image.

## Resulting defaults

- Locations start at `16:9`; items start at `1:1`.
- Authored pack art is generated and reviewed before release.
- Runtime wallet connection never generates location or item-definition art.
- Failed media review leaves the deterministic placeholder visible and does
  not mutate world state.
- New art is generated only for a new explicit art revision, not for every
  visit, owner, or item instance.
