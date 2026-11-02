# Standoff effect art

Refs [#1920](https://github.com/cenetex/cosyworld/issues/1920). This first batch
publishes nine transparent still effects for later combat overlay integration.
The current renderer does not use them yet.

| Source | Canvas | Intended use |
| --- | --- | --- |
| `hit-1.png` | 512 × 512 | Small puff for 1 recorded damage |
| `hit-2.png` | 512 × 512 | Starburst and ink splashes for 2 recorded damage |
| `hit-3.png` | 512 × 512 | Jagged burst, shockwave and chips for 3 recorded damage |
| `brace-raise.png` | 512 × 512 | Translucent shield as the defender braces |
| `brace-absorb.png` | 512 × 512 | Shield ripple as a brace absorbs a point |
| `swipe-left.png` | 1024 × 512 | Curved lunge trail toward screen left |
| `swipe-right.png` | 1024 × 512 | Curved lunge trail toward screen right |
| `jab-left.png` | 1024 × 512 | Short straight punch trail toward screen left |
| `jab-right.png` | 1024 × 512 | Short straight punch trail toward screen right |

Each source is a single still, centred on the impact point with clear padding.
The PNGs enter through `public-assets.mjs`; the image and asset builders produce
WebP variants and media hashes. `art-prompts.json` records the complete prompts
and generation IDs. `provenance.json` records source hashes and processing.

## Integration handoff

Load the canonical PNG paths through `imageUrl()` from `images.mjs`. Overlay the
effects on the existing combat portraits in `combat-view.mjs`. Select `hit-1`,
`hit-2` or `hit-3` from the attack's recorded `damage` in `combat-beats.mjs`, and
use the recorded guard outcome for brace absorption. Choose trail direction
from the fighters' positions on screen.

Keep the existing beat timing and playback speed. Show static effects with
reduced motion, and respect the existing **Flashes and scares** setting for any
brightness flash. Check readability at 120–200 pixels over both a lamplit room
and a dark night scene.

## Remaining issue scope

The seven core designs `threaten`, `brace`, `strike`, `dizzy`, `yield`,
`stand-down` and `standoff-ring` remain deferred, along with optional
`brace-shatter` and the eight players' plain/scarf punch portraits. Runtime
wiring and any additional animation frames are also deferred.
