# Patroclus: the sunny friend

The owner chose sketch 1 on 2026-11-04. These finished images preserve his warm
smile, chestnut curls, teal linen tunic, saffron-gold cloak, and coral woven belt.

| File | Size | Use |
| --- | --- | --- |
| [Portrait](patroclus-portrait.png) | 1151 × 1367 | Card portrait, cropped below the chest |
| [Stage figure](patroclus-stage.png) | 1024 × 1536 | Full figure, offering bread |
| [Approved sketch](approved-sketch.png) | 1536 × 1024 | Chosen design reference |
| [Edge review](alpha-review.png) | 1200 × 780 | Both images on light and dark backgrounds |

Both final PNGs have RGBA colour and a transparent background. The stage figure
shows the complete head, hands, cloak, and sandals. The portrait focuses on his
smile. The bread follows the companion bond in the owner's brief.

The built-in image generation tool made each final image from the approved
sketch with transparency enabled. [Generation prompts](prompts.json) record the
exact instructions. The source PNG bytes are preserved.

## Validation

- Read both PNGs with Pillow and checked their size, RGBA mode, alpha range,
  clear pixels, and visible bounds.
- Rendered both PNGs in Chromium on light grey and dark blue backgrounds.
- Checked his smile, face, colours, hands, full stage silhouette, and edges.
- Ran `git diff --check` and `npm run check:version`.

These files are the finished art handoff. Game wiring and release are separate
steps.
