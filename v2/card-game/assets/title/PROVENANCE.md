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
The Black Pond's opaque crop and the earlier Hearth and Oak and Listening
Wood crops stay in `toolbar/`, published but unused. Existing music, Wake,
skip, reduced-motion and new-world behavior are unchanged.

## Transparent toolbar copies

Every intro painting is opaque on black; the intro's own black ground hides
that. The toolbar is not black, so an opaque toolbar image shows as a dark
box. The toolbar therefore shows only transparent images: a logo without
its own transparent lettering borrows the nearest one until the owner
supplies it, and `test/card-title-alternates.test.mjs` fails on any toolbar
image without clear corners.

| Logo (index) | Toolbar image | Transparent |
| --- | --- | --- |
| Lonely Forest (0) | `toolbar/lonely-forest-1-transparent.webp`, 417 x 160 | yes |
| Pip and the lantern (1) | `toolbar/lonely-forest-2-transparent.webp`, 407 x 160 | yes |
| Hearth and Oak (2) | `toolbar/lonely-forest-teal-lantern-left.webp` | yes |
| The Listening Wood (3) | `toolbar/lonely-forest-teal-bell-and-lantern.webp` | yes |
| The Black Pond (4) | borrows `toolbar/lonely-forest-teal-bell-and-lantern.webp` (cold teal) | borrowed |

The two gold wordmarks' toolbar exports and their native transparent
sources (`lonely-forest-1-transparent.webp`, 2007 x 783, and
`lonely-forest-2-transparent.webp`, 1983 x 793) were supplied by the owner;
`TRANSPARENT-LOGOS.md` and `transparent-logos.provenance.json` record their
origin and hashes. The natives are source art and are not served. The
enclosed navy panels are part of the art; only the surroundings are clear.
The earlier 320 x 125 copy from #2119,
`transparent/lonely-forest-1-toolbar.webp`, stays published but unused.

Still missing, to be supplied by the owner rather than cut out of the black
(an automatic cut-out leaks into the night-sky vignette and dark panel and
leaves a halo):

- A transparent Black Pond lettering file (at least 92 px tall).
- The 2172 x 724 native teal PNGs behind the two teal toolbar files, in the
  owner's `lonely-forest-teal-pr-bundle.zip`. The intro needs none: it is
  black.

After adding source artwork, run `npm run v2:card:images:build`, then
`npm run v2:card:assets:build`, and commit the resulting card/phone variants,
`image-variants.json` and `media-manifest.json`. Do not hand-edit those outputs.
