# Title art provenance

`lonely-forest-1.webp` (1312×512) and `lonely-forest-2.webp` (2000×800) are
the "LONELY FOREST" title wordmarks: gold ornate lettering on a starry navy
panel with oak leaves, acorns and a moth on black. The second adds a
cottage-by-the-lake vignette and Pip holding a lantern.

Supplied by the project owner on 2026-11-02 for the first-arrival title
(`title-intro.mjs`). The files are committed as supplied; the image compiler
writes their phone and card copies under `assets/optimized/`.

## Hand-lettered alternatives

The owner asked for three generated treatments of their teal, hand-lettered
Lonely Forest sketch, then requested their inclusion as alternate intros.
All three preserve the full 1672 × 941 composition on an opaque black ground:

| File | Treatment |
| --- | --- |
| `lonely-forest-hearth-and-oak.webp` | Honey-edged teal lettering, oak leaves, lantern, moth and warm window |
| `lonely-forest-listening-wood.webp` | Weathered verdigris, roots, moss and a cloth-tied bell |
| `lonely-forest-black-pond.webp` | Silver and cold teal, extinguished lamp, dark glass and broken reflection |

`alternate-intros.provenance.json` records the source PNG names and SHA-256s,
encoded WebP SHA-256s, dimensions, byte counts, and encoding settings. The
sources were converted with Pillow/libwebp, quality 88, method 6, without
cropping or resizing. No generation IDs were available for these images.

The alternatives append to `title-logos.json`; the original entries stay at
indices 0 and 1 so saved logo choices remain stable. The catalogue supplies
the title, matching toolbar logo and public asset list. Existing music, Wake,
skip, reduced-motion and new-world behavior are unchanged.

After adding source artwork, run `npm run v2:card:images:build`, then
`npm run v2:card:assets:build`, and commit the resulting card/phone variants,
`image-variants.json` and `media-manifest.json`. Do not hand-edit those outputs.
