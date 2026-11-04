# Patroclus: the sunny friend pose set

The owner chose sketch 1 on 2026-11-04. These finished images preserve his warm
smile, chestnut curls, teal linen tunic, saffron-gold cloak, and coral woven belt.

| File | Size | Use |
| --- | --- | --- |
| [Portrait](patroclus-portrait.png) | 1151 × 1367 | Card portrait, cropped below the chest |
| [Holding bread](patroclus-stage.png) | 1024 × 1536 | Full figure, used when he holds bread |
| [Idle](patroclus-idle.png) | 1024 × 1536 | Everyday standing pose, empty hands |
| [Talking](patroclus-talking.png) | 1024 × 1536 | Warm smile, open hand, speaking |
| [Listening](patroclus-listening.png) | 1024 × 1536 | Quiet attention, hands together |
| [Walking](patroclus-walking.png) | 1024 × 1536 | A companion's easy step |
| [Sleeping](patroclus-sleeping.png) | 1024 × 1536 | Peaceful seated sleep, closed eyes |
| [Guard](patroclus-guard.png) | 1024 × 1536 | Raised empty hands and planted feet |
| [Attack](patroclus-attack.png) | 1024 × 1536 | Controlled forward strike |
| [Hit](patroclus-hit.png) | 1024 × 1536 | Brief recoil and wince |
| [Approved sketch](approved-sketch.png) | 1536 × 1024 | Chosen design reference |
| [Edge review](alpha-review.png) | 1200 × 780 | Both images on light and dark backgrounds |
| [Full set review](pose-review.png) | 1800 × 1012 | Every pose on light and dark backgrounds |

All final PNGs have RGBA colour and a transparent background. The full figures
show the complete head, hands, cloak, and sandals. The portrait focuses on his
smile. The owner assigned the bread pose to the holding-bread state. The idle
pose is his everyday full figure. The eight added poses have empty hands and
retain his sheathed sword as a worn costume detail.

The built-in image generation tool made each final image from the approved
sketch with transparency enabled. [Generation prompts](prompts.json) record the
exact instructions. [Pose prompts](pose-prompts.json) record the eight later
edits, which use the approved face and bread figure as references. The source
PNG bytes are preserved. [Pose validation](pose-validation.json) records each
file's hash, size, alpha range, and visible bounds.

## Validation

- Read the PNGs with Pillow and checked their size, RGBA mode, alpha range,
  clear pixels, and visible bounds.
- Rendered every PNG in Chromium on light grey and dark blue backgrounds.
- Checked his smile, face, colours, hands, full stage silhouette, and edges.
- Ran `git diff --check` and `npm run check:version`.

The generated near-opaque alpha values and faint edge pixels are preserved.
Pose scale, framing, and facing are recorded visually in the review sheet;
runtime placement can use the game's existing pose fitting when wired.

These files are the finished art handoff. Game wiring and release are separate
steps.
