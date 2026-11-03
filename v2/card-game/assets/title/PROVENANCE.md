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
the title, toolbar logo and public asset list. At toolbar height the whole
wide artwork is too small to read, so each names its lettering instead.
Hearth and Oak shows the transparent teal `toolbar/lonely-forest-teal-lantern-left.webp`
(its lantern, moth and acorns), and The Listening Wood shows
`toolbar/lonely-forest-teal-bell-and-lantern.webp` (its tied bell); both are
supplied 288 x 96 files with no `crop` (see `toolbar/TEAL-REVISIONS.md`).
The Black Pond keeps a `crop` of its artwork, which the image build writes
to `toolbar/` at 160 px tall. The earlier Hearth and Oak and Listening Wood
crops stay in `toolbar/`, published but unused. Existing music, Wake,
skip, reduced-motion and new-world behavior are unchanged.

## Transparent toolbar copies

Every intro painting is opaque on black; the intro's own black ground hides
that. The toolbar is not black, so an opaque toolbar image shows as a dark box.

| Logo (index) | Toolbar image | Transparent |
| --- | --- | --- |
| Lonely Forest (0) | `transparent/lonely-forest-1-toolbar.webp`, 320 x 125 | yes |
| Pip and the lantern (1) | the whole `lonely-forest-2.webp` | no |
| Hearth and Oak (2) | `toolbar/lonely-forest-teal-lantern-left.webp` | yes |
| The Listening Wood (3) | `toolbar/lonely-forest-teal-bell-and-lantern.webp` | yes |
| The Black Pond (4) | `toolbar/lonely-forest-black-pond.webp`, a crop | no |

`transparent/lonely-forest-1-toolbar.webp` comes from #2119: a 320 px wide
export of the owner's recovered RGBA original of the first wordmark, whose
decoded alpha matched the resized original's alpha. Its Git blob ID is
`312b8a116d17a15244bc8e5e700286c6b3842409`. The enclosed navy panel is part
of the art; only the surroundings are clear.

Still missing, to be supplied by the owner rather than cut out of the black
(an automatic cut-out leaks into the night-sky vignette and dark panel and
leaves a halo):

- A transparent Pip-and-lantern wordmark (RGBA source of `lonely-forest-2.webp`,
  or a toolbar copy at least 92 px tall).
- A transparent Black Pond lettering file.
- The native transparent PNGs behind the toolbar copies: the first
  wordmark's RGBA original, and the 2172 x 724 teal PNGs in the owner's
  `lonely-forest-teal-pr-bundle.zip`. The intro needs none: it is black.

After adding source artwork, run `npm run v2:card:images:build`, then
`npm run v2:card:assets:build`, and commit the resulting card/phone variants,
`image-variants.json` and `media-manifest.json`. Do not hand-edit those outputs.
