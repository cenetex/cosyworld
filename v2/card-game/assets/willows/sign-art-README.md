# Willows signs and the Traveller's Notebook

The owner's final fifteen-target brief is complete: nine required scenery
paintings, the optional hollows painting, and five notebook PNGs. Every scene
edits its named existing place. The original camera, horizon, shore landmarks
and painterly treatment remain visually matched. Fine texture can differ
between generated edits; these are complete paintings, not pixel-identical
composited layers.

## Place paintings

All ten are opaque **1672 × 941 WebPs**, each below **300,000 bytes**. There was
no crop, resize or creative postprocessing after generation. The official image
builder supplies 512 × 288 card variants.

| File                                               | Exact composition base                                        | Lighting and change                                                                    | Preview                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [landing-otter.webp](landing-otter.webp)           | `landing.webp`                                                | Existing low sun; a wet black otter rolls in the current with one yellow eye           | <img src="../optimized/card/webp/willows/landing-otter.webp" width="250" alt="Otter in the current">        |
| [landing-boatman.webp](landing-boatman.webp)       | `landing.webp`                                                | Existing sunset; a distant man crosses himself from a flat boat                        | <img src="../optimized/card/webp/willows/landing-boatman.webp" width="250" alt="Passing boatman">           |
| [landing-mended.webp](landing-mended.webp)         | `landing.webp`                                                | Existing sunset; repaired canoe upright, paddle, rope and folded sheet                 | <img src="../optimized/card/webp/willows/landing-mended.webp" width="250" alt="Mended canoe">               |
| [camp-closer.webp](camp-closer.webp)               | `camp.webp`, with `camp-lit-night.webp` as lighting reference | Night; willow ring nearer, campfire remains lit                                        | <img src="../optimized/card/webp/willows/camp-closer.webp" width="250" alt="Willows nearer the camp">       |
| [camp-tent-pressure.webp](camp-tent-pressure.webp) | `camp-lit-night.webp`                                         | Same lit night; canvas pressed inward, faint wet patter marks                          | <img src="../optimized/card/webp/willows/camp-tent-pressure.webp" width="250" alt="Pressure on the tent">   |
| [thicket-bronze.webp](thicket-bronze.webp)         | `thicket-night.webp`                                          | Cool night; dim fluid bronze forms ascend through the willow tops                      | <img src="../optimized/card/webp/willows/thicket-bronze.webp" width="250" alt="Bronze ascent">              |
| [thicket-hollows.webp](thicket-hollows.webp)       | `thicket.webp`                                                | Existing evening light; additional smooth sand hollows; optional target supplied       | <img src="../optimized/card/webp/willows/thicket-hollows.webp" width="250" alt="Sand hollows">              |
| [bank-humming.webp](bank-humming.webp)             | `bank.webp`                                                   | Existing dusk; faint distant shimmer and still water near the bank                     | <img src="../optimized/card/webp/willows/bank-humming.webp" width="250" alt="Humming over the far willows"> |
| [bank-roots.webp](bank-roots.webp)                 | `bank.webp`                                                   | Existing dusk; partial pale shape caught beneath the roots                             | <img src="../optimized/card/webp/willows/bank-roots.webp" width="250" alt="Pale shape below the roots">     |
| [bank-drowned.webp](bank-drowned.webp)             | `bank-night.webp`                                             | Existing night; a face-up drowned man with smooth hollow marks, without graphic injury | <img src="../optimized/card/webp/willows/bank-drowned.webp" width="250" alt="Night discovery at the roots"> |

The campfire and portable lamp are separate. The camp paintings retain the
fixed lit fire and do not paint in a portable lamp. `camp-closer` follows the
owner's `camp (night)` direction: its geometry comes from `camp.webp`, including
that source's crescent, while its night exposure follows `camp-lit-night`.

## Notebook cards

All five source files are **1254 × 1254 transparent PNGs**, copied byte-for-byte
from the generated originals. The official builder preserves alpha in the
optimized stage and 512 × 512 card variants. `map.png` supplied the paper and
item style; `sheet.png` and `rope.png` supplied oilcloth and flax references.
Pages two and three edit the first finished page to keep a coherent family.

| File                                         | Distinguishing detail                                  | Preview                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| [notebook-page-1.png](notebook-page-1.png)   | Canoe on a sand spit, graphite field notes             | <img src="../optimized/card/png/willows/notebook-page-1.webp" width="180" alt="Canoe notebook page">        |
| [notebook-page-2.png](notebook-page-2.png)   | Willow tops against the sky, matching paper and pencil | <img src="../optimized/card/png/willows/notebook-page-2.webp" width="180" alt="Willow notebook page">       |
| [notebook-page-3.png](notebook-page-3.png)   | Round hollows in sand, matching paper and pencil       | <img src="../optimized/card/png/willows/notebook-page-3.webp" width="180" alt="Hollows notebook page">      |
| [notebook-chapter.png](notebook-chapter.png) | Three leaves stitched with thread, river-damp edges    | <img src="../optimized/card/png/willows/notebook-chapter.webp" width="180" alt="Stitched notebook chapter"> |
| [notebook-book.png](notebook-book.png)       | Closed worn oilcloth field notebook tied with string   | <img src="../optimized/card/png/willows/notebook-book.webp" width="180" alt="Traveller's Notebook">         |

Pencil handwriting is illustrated surface texture. Readable canonical passages,
titles and assembly progress belong to the notebook content/UI.

## Integration and provenance

This art change registers the files and optimized variants. It does not add
Observe events, repair receipts, notebook assembly rules or display timers.
The Observe owner in [#1640](https://github.com/cenetex/cosyworld/pull/1640)
specifies that each sign painting holds while it is that place's newest sign;
there is no fixed six-second return. At `fca8307c`, the PR implements Observe
selection but does not yet implement that artwork selector. The owner kept the
willow thicket as a live road between camp and bank (2026-11-01), so its two
signs, the hollows and the bronze shapes, are Observed at the thicket and their
paintings are thicket `backdrops`. The later steps gate the mended canoe on the
kit at camp and give passing otter/boatman appearances seeded per-turn windows.
Those are content-owner integration tasks, not shipped behavior of this asset
PR. An unavailable alternate must retain its place's base painting and never
block play.

The owner's exact prompts and the state/timing handoff are in
`v2/content/willows/ART-BRIEF.md` and `ART-HANDOFF.md`. The four interim paintings
remain available: `thicket-uncanny`, `camp-uncanny`, `camp-dark-night` and
`bank-uncanny`; no substitute should silently change the scene's lighting.

### Framing handoff

Desktop and 390 × 844 stage checks preserve the full source compositions.
The otter and boatman were revised by moving only the added river subjects
within the existing narrow crop. The final subjects are visible beside Vale.
The other low scene details still need presentation work in the owner pilot:

- Camp's tent-pressure detail needs the same 82% horizontal focus on both the
  base and alternate, so the crossfade does not pan the scene.
- Roots, the drowned figure and many sand hollows sit beneath the player or
  card dock on a narrow phone. The drowned face also intersects Vale on desktop.
- The mended canoe's paddle and folded sheet are partly visible on a phone;
  its rope and full hull need a suitable reveal. Do not move the shore or crop
  the source painting to solve these stage-layout constraints.

All five notebook cards were checked in the real card layout. The thicket
paintings show while the player stands in the thicket, like any place.

[Initial and accepted revision prompts](sign-art-prompts.json) and
[provenance and file checks](sign-art-provenance.json) record the built-in tool,
generation IDs, source-reference hashes, original PNG hashes, output hashes and
encoding settings. Scene originals were encoded to WebP only; item originals
retain their generated RGBA data exactly.
