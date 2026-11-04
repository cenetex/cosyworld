# Full-size transparent Lonely Forest logos

## Latest requested waterline revision — use this pair

The owner's latest "put it on a PR" request refers to
`a_high_detail_png_style_illustration_of_the_same.png`, generation
`0233e449-8cce-438e-948b-a8a87b99f5f8`. It is now committed byte for byte as
`lonely-forest-waterline.png`: **1774 × 887 RGBA**, 2,209,213 bytes, Git blob
`72df93ae7b2aac21e2cea9b0c1177b5ee19a6f29`. The title reads **Lonely Forest**,
with the lamp, oval mirror, doorway and reflection. It is not a plaque
reading THE BLACK POND and is not the earlier background-removed cutout.

Use the full PNG for the intro and its own matching transparent toolbar
export, `lonely-forest-waterline-toolbar.webp` (320 × 160), with no `crop`
field. Do not reuse the older Black Pond toolbar crop for this new revision.
The master is unchanged; the toolbar is a full-composition Lanczos resize
encoded as lossless WebP with its resized alpha preserved exactly.
`waterline-revision.provenance.json` records both hashes and the process.
The image-only delivery commit is `3be1b9f7fcc807b46099954211f7d9bec7923da6`.

## Original gold and teal masters

The first four PNGs are the native originals, committed byte for byte. They
are not enlarged toolbar exports or reconstructed JPEG previews.
`fullsize-sources.json` records their dimensions, byte counts, SHA-256 hashes,
source filenames and the two available teal generation IDs.

| File | Native dimensions | Bytes | Git blob SHA |
| --- | --- | ---: | --- |
| `lonely-forest-1.png` | 2007 × 783 | 2,285,564 | `c03fc3a8b24ae4e10ed5c13c2c79758812019b9e` |
| `lonely-forest-2.png` | 1983 × 793 | 2,553,241 | `d064958e62a15413ab03cd6c7cdcb5ddcd89a2f6` |
| `lonely-forest-teal-lantern-left.png` | 2172 × 724 | 2,233,531 | `2789c848f14cc30e2acc44c7d7da35ad2da521ad` |
| `lonely-forest-teal-bell-and-lantern.png` | 2172 × 724 | 2,394,763 | `d2c1fe3eae7fc9dd0403b4be5780baa5219f8777` |

All four decode as RGBA with alpha values from 0 to 255. Their fully clear
pixel counts are respectively 654,539; 603,586; 748,877; and 722,055. The gold
emblems retain their enclosed navy illustrations; only the surrounding area
is transparent. Preserve the masters' exact alpha, dimensions and framing.

## Earlier Black Pond cutout — retained for comparison

`lonely-forest-black-pond.png` is the earlier 1672 × 941 transparent cutout,
with the existing **Lonely Forest** silver/teal lettering, extinguished lamp,
dark glass, doorway and broken reflection. Black Pond names the treatment,
not replacement words for the logo. The unrelated generated plaques reading
THE BLACK POND were rejected and are not committed.

Unlike the native originals, this is a **background-removed derivative**
of `../lonely-forest-black-pond.webp`, not a recovered native alpha channel.
`build-black-pond-alpha.py` records the pinned-source recipe; its authoring
dependencies are listed in the file. It removes the black matte, protects
small pigment pockets and the dark lens, and unpremultiplies soft edges.
The full-size canvas and lettering geometry are unchanged. Compositing onto
black differs from the source by at most 3/255 per channel. Light/dark visual
inspection and full decode passed; there are 1,181,306 fully clear pixels.
`black-pond-alpha.provenance.json` records exact source/output hashes and alpha.

Its earlier toolbar export, `lonely-forest-black-pond-toolbar.webp`, is
476 × 160. Both earlier files remain unchanged for comparison and their
existing reconstruction tests. They are not the latest requested generation.
The earlier PNG Git blob is `fff06921be2db9274d73d1fadd0d6940ff3ea708`;
its toolbar blob is `3b92439d2f5649fcaabc49a9c8164ba90980bd51`.

## Delivery and integration boundary

PR #2145 supplies the masters. The original-four image-only delivery commit
is `72baf4e78fd82a6e94c891d7fac6454c13bebf5d`. All completed temporary transfer
and build workflows were removed; no transfer service is needed to read
these committed files.

This PR does **not** switch the live title catalogue or toolbar. It does not
register these masters as public assets or change the image/media manifests.
It leaves the toolbar agent's work, title order, saved indices, music, taps,
acknowledgement and highlighting untouched. Do not describe this asset commit
as deployment or as replacement of the existing opaque intro selections.

The toolbar agent can use the PNGs at `assets/title/transparent/<file>` as
full-resolution inputs for the title/toolbar pipeline. Use the gold pair for
their matching wordmarks, the teal pair for the artwork supplied by #2134 and
wired in #2136, and the **latest waterline pair above** for catalogue index 4.
The attempted lantern-right teal revision did not finish generating.

For a runtime change, select and register the intended new paths without
reordering the catalogue; retain the old public paths for cached clients.
Run the official builders and commit their generated files:

```sh
npm run v2:card:images:build
npm run v2:card:assets:build
npm run v2:card:images:check
npm run v2:card:assets:check
npx vitest run test/card-title-fullsize.test.mjs test/card-title-black-pond-alpha.test.mjs test/card-title-waterline.test.mjs test/card-title-logo.test.mjs test/card-title-alternates.test.mjs
node v2/scripts/smoke-card-toolbar-logo.mjs
node v2/scripts/smoke-card-title-intro.mjs
npm run check:version
git diff --check
```

## Checks on this asset delivery

The imports verified each original PNG's byte count, SHA-256, RGBA header and
native size before committing. Full Pillow decode verified transparency.
`test/card-title-fullsize.test.mjs` checks the four unmodified native sources;
`test/card-title-black-pond-alpha.test.mjs` separately checks the earlier
processed source and its black reconstruction. `test/card-title-waterline.test.mjs`
checks the latest native generation, its exact bytes and matching toolbar alpha.
The waterline import verified both image hashes and exact resized toolbar alpha;
local light/dark review and the new test's `node --check` also passed.
Repository Vitest and browser results must be read from CI or the integrating
checkout, not assumed from the local image checks. No runtime manifest was
edited by hand.
