# Revised transparent teal toolbar artwork

Two supplied toolbar exports from the owner's revised Lonely Forest artwork:

| File | Dimensions | Bytes |
| --- | --- | ---: |
| `lonely-forest-teal-lantern-left.webp` | 288 x 96 | 27,930 |
| `lonely-forest-teal-bell-and-lantern.webp` | 288 x 96 | 27,708 |

Both files have real alpha transparency. Their decoded alpha channels exactly
match Lanczos resizes of their 2172 x 724 RGBA PNG sources. They retain the full
3:1 composition without cropping or adding a black matte. The first has a left
lantern and a moth; the second has a left lantern and a ribbon-tied bell at the
right. `teal-revisions.provenance.json` records the generation IDs and hashes.

![Lantern left](lonely-forest-teal-lantern-left.webp)

![Bell and lantern](lonely-forest-teal-bell-and-lantern.webp)

## Integration boundary

This is an image handoff for the toolbar-logo work. The title catalogue,
public asset list, generated manifests and runtime are deliberately unchanged.
These files are not selected or published by the game's asset server yet.
No saved logo indices, taps, music, fades or attic behavior change.
Do not enlarge these toolbar exports into full-resolution intro paintings.
The native PNG masters and earlier 480 x 160 exports remain in the originating
conversation's `lonely-forest-teal-pr-bundle.zip`; they are not in this commit.

The existing toolbar selector accepts a supplied image with `src`, `width`
and `height`, without a `crop` member. Use 288 and 96 as the native dimensions.
The integration change should select these files, rebuild with
`npm run v2:card:images:build` and `npm run v2:card:assets:build`, and commit the
builder outputs. Verify both light and dark surfaces at desktop and phone
widths. The two designs are not automatically assigned to the three distinct
intro paintings from #2084.

## Validation

Both WebPs decode as RGBA at the recorded dimensions. Their corners are clear,
their alpha includes values from 0 to 255, and every alpha byte matches the
resized source. GitHub's returned blob IDs match the locally calculated Git
blob IDs exactly. Full application tests, official builders and browser
checks have not run for this art-only handoff.
