# Short Rest and Long Rest paintings

Two finished paintings for the art briefs in [issue #1849](https://github.com/cenetex/cosyworld/issues/1849).

| Card | Painting | Scene |
| --- | --- | --- |
| Short Rest | [short-rest.webp](short-rest.webp) | An empty travel cloak on a mossy roadside stone at dusk, steaming tin cup, bread, satchel and fireflies. |
| Long Rest | [long-rest.webp](long-rest.webp) | An empty sanctuary bedroll in a stone alcove, wool blanket, one candle, moonlit arched window, lavender and star motes. |

Both are opaque, full-bleed 1024 × 1536 WebP paintings. Their lower quarter stays dark and quiet for UI text. No lettering, people, border or card controls are painted into the images.

## Short Rest

![Short Rest: a moment by the road](short-rest.webp)

## Long Rest

![Long Rest: the sanctuary bed](long-rest.webp)

## Art handoff

These paintings supply the art portion of #1849. The earning rules, sanctuary restriction, haiku flip, card borders and rest actions belong to its gameplay implementation. Current main still uses the older Wait-based rest system.

The artwork is shared across world packs. Keep the future card title, amber or silver edge, disabled state and haiku in the presentation layer. Use the full 2:3 composition without cropping; the cup, bread, lavender and pillow remain above the dark caption area.

Generation used the built-in image tool. [prompts.json](prompts.json) preserves the full prompts. [provenance.json](provenance.json) records original and encoded hashes, dimensions and encoding settings. Original PNGs are represented by their hashes; the committed WebPs preserve the complete composition without resizing or creative changes.

## Delivery and validation

Both sources are registered in `public-assets.mjs`, with the following generated versions:

| Painting | Full source | Card | Phone |
| --- | --- | --- | --- |
| Short Rest | 1024 × 1536; 285,814 bytes | 512 × 768; 110,084 bytes | 640 × 960; 142,828 bytes |
| Long Rest | 1024 × 1536; 277,582 bytes | 512 × 768; 103,818 bytes | 640 × 960; 131,192 bytes |

The card and phone versions use the official image builder's quality-88 settings. `image-variants.json` and `media-manifest.json` include all six new files. Every pre-existing record and asset remains unchanged.

Local validation ran the unmodified official image and asset builders, including both `--check` modes, in an isolated fixture containing the two new sources. The actual public registry was evaluated to preserve its complete ordering. Existing manifest entries were retained byte-for-byte. The full paintings and card derivatives were visually reviewed.

A full repository checkout and local browser run were unavailable in this environment (the shell network proxy and Chromium installation were unavailable). The fixture checks do not stand in for the complete repository test suite; the PR's GitHub checks provide that evidence. This is an art handoff, not a test of the pending rest-card gameplay.
