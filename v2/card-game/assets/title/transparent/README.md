# Full-size transparent Lonely Forest logos

These four PNGs are the native originals, committed byte for byte. They are
not enlarged toolbar exports and were not reconstructed from JPEG previews.
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

## Delivery and integration boundary

PR #2145 supplies the masters. The image-only delivery commit is
`72baf4e78fd82a6e94c891d7fac6454c13bebf5d`; all four remote Git blob hashes
match the locally inspected source PNGs. A one-off transfer workflow completed
successfully and was removed afterwards. No temporary transfer service is
needed to read these committed files.

This PR does **not** switch the live title catalogue or toolbar. It does not
register these masters as public assets or change the image/media manifests.
It leaves the toolbar agent's work, title order, saved indices, music, taps,
acknowledgement and highlighting untouched. Do not describe this asset commit
as deployment or as replacement of the existing opaque intro paintings.

The toolbar agent can use the PNGs at `assets/title/transparent/<file>` as
full-resolution inputs for the existing title/toolbar pipeline. Use the gold
pair for their matching wordmarks. The teal pair are the masters of the
compact artwork supplied by #2134 and wired in #2136. The Black Pond remains
a different painting: neither teal revision is a transparent Black Pond
replacement. The attempted lantern-right revision did not finish generating.

For a runtime change, select and register the intended new paths without
reordering the catalogue; retain the old public paths for cached clients.
Run the official builders and commit their generated files:

```sh
npm run v2:card:images:build
npm run v2:card:assets:build
npm run v2:card:images:check
npm run v2:card:assets:check
npx vitest run test/card-title-fullsize.test.mjs test/card-title-logo.test.mjs test/card-title-alternates.test.mjs
node v2/scripts/smoke-card-toolbar-logo.mjs
node v2/scripts/smoke-card-title-intro.mjs
npm run check:version
git diff --check
```

## Checks on this asset delivery

The import verified each PNG's byte count, SHA-256, RGBA header and native
size before committing. Full Pillow decode of the matching original bytes
verified actual transparency. `test/card-title-fullsize.test.mjs` checks the
committed hashes, native size, decoded alpha and the four-file source set.
The test file passed a local syntax check; repository Vitest and browser
results must be read from CI or the integrating checkout, not assumed from
that syntax check. No generated image output was edited by hand.
