# Settings workbench art

`source/moonlit-cozy-fantasy-workbench.png` (2172 × 724, opaque) is the
owner's "Moonlit Cozy Fantasy Workbench", supplied on 2026-11-04 with the
note "split this up for the settings cards". It is committed as supplied and
is source art, not served. From the left it shows old books, Pip the moth at
the table with three dice, a brass mug, a brass dice cup, a sealed letter, a
lit candle, an armillary sphere with a gear, stacked books, a rolled scroll
and a round moonlit window over water.

`build-workbench-crops.mjs` cuts eleven lossless, unscaled regions at about
7:5, the quest card's place ratio, into `workbench-<name>.png`. The cards
draw them as place paintings (`settings-cards.mjs`), not as cut-outs: the
painting has no alpha and a cut-out would halo.

| Crop | Card |
| --- | --- |
| `letter` | Privacy |
| `candle` | Volume |
| `dice-cup` | Fight speed |
| `dice` | Play counts |
| `moth` | Account |
| `old-books` | Credits |
| `mug` | World pool |
| `scroll` | Backup |
| `window` | New game |
| `armillary` | Controls |
| `book-stack` | Download |

`workbench.provenance.json` records the source hash and each crop's region
and hash. After changing a crop, run the script, then
`npm run v2:card:images:build` and `npm run v2:card:assets:build`, and commit
the variants, `image-variants.json` and `media-manifest.json`.
