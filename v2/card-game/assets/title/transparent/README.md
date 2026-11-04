# Full-size transparent Lonely Forest logos

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

## Black Pond transparent artwork

`lonely-forest-black-pond.png` is the fifth full-size transparent logo:
1672 × 941, with the existing **Lonely Forest** silver/teal lettering,
extinguished lamp, dark glass, doorway and broken reflection. Black Pond
names the treatment, not replacement words for the logo. Neither teal
revision is used as its stand-in. The unrelated generated plaques reading
THE BLACK POND were rejected and are not committed.

Unlike the first four originals, this is a **background-removed derivative**
of `../lonely-forest-black-pond.webp`, not a recovered native alpha channel.
`build-black-pond-alpha.py` records the pinned-source recipe; its authoring
dependencies are listed in the file. It removes the black matte, protects
small pigment pockets and the dark lens, and unpremultiplies soft edges.
The full-size canvas and lettering geometry are unchanged. Compositing onto
black differs from the source by at most 3/255 per channel. Light/dark visual
inspection and full decode passed; there are 1,181,306 fully clear pixels.
`black-pond-alpha.provenance.json` records exact source/output hashes and alpha.

A supplied toolbar export is also committed:

```json
{
  "src": "assets/title/transparent/lonely-forest-black-pond-toolbar.webp",
  "width": 476,
  "height": 160
}
```

This is a lossless transparent WebP with the existing toolbar crop's framing.
Use it without a `crop` field. Do not enlarge it into an intro; use the
1672 × 941 PNG for the full-size input. The PNG Git blob is
`fff06921be2db9274d73d1fadd0d6940ff3ea708`; the toolbar blob is
`3b92439d2f5649fcaabc49a9c8164ba90980bd51`. Both match the locally reviewed bytes.

## Delivery and integration boundary

PR #2145 supplies the masters. The original-four image-only delivery commit
is `72baf4e78fd82a6e94c891d7fac6454c13bebf5d`. The completed temporary transfer
and Black Pond build workflows were removed; no transfer service is needed
to read these committed files.

This PR does **not** switch the live title catalogue or toolbar. It does not
register these masters as public assets or change the image/media manifests.
It leaves the toolbar agent's work, title order, saved indices, music, taps,
acknowledgement and highlighting untouched. Do not describe this asset commit
as deployment or as replacement of the existing opaque intro selections.

The toolbar agent can use the PNGs at `assets/title/transparent/<file>` as
full-resolution inputs for the title/toolbar pipeline. Use the gold pair for
their matching wordmarks, the teal pair for the artwork supplied by #2134 and
wired in #2136, and the new Black Pond cutout for catalogue index 4. The
attempted lantern-right teal revision did not finish generating.

For a runtime change, select and register the intended new paths without
reordering the catalogue; retain the old public paths for cached clients.
Run the official builders and commit their generated files:

```sh
npm run v2:card:images:build
npm run v2:card:assets:build
npm run v2:card:images:check
npm run v2:card:assets:check
npx vitest run test/card-title-fullsize.test.mjs test/card-title-black-pond-alpha.test.mjs test/card-title-logo.test.mjs test/card-title-alternates.test.mjs
node v2/scripts/smoke-card-toolbar-logo.mjs
node v2/scripts/smoke-card-title-intro.mjs
npm run check:version
git diff --check
```

## Checks on this asset delivery

The import verified each original PNG's byte count, SHA-256, RGBA header and
native size before committing. Full Pillow decode verified transparency.
`test/card-title-fullsize.test.mjs` checks the four unmodified native sources;
`test/card-title-black-pond-alpha.test.mjs` separately checks the processed
Black Pond source, toolbar export and near-exact black reconstruction.
Repository Vitest and browser results must be read from CI or the integrating
checkout, not assumed from the local image checks. No runtime manifest was
edited by hand.
