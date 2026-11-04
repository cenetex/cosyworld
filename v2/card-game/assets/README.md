# Conversation art

`keeper-right.png` is the right-facing companion to `keeper.png`. It was made with the built-in image generation tool from the original cutout. Both files retain a transparent background and a 1024 by 1536 canvas.

Prompt used:

> Use case: identity-preserve. Asset type: opposite facing cutout for a JRPG conversation scene. Edit target: the supplied full-body keeper PNG. Create the same exact clock-headed railway keeper facing toward the viewer's RIGHT instead of left. Preserve the existing detailed hand-painted ink and watercolor art, identity, purple coat, cap, gloves, shushing finger, proportions, subtle texture and full body from hat to shoes, transparent background, centered 2:3 canvas, feet at the same baseline. Mirror the pose and silhouette horizontally but paint the clock face with correctly oriented Roman numerals and clockwise order, XII at the top, III at the right, VI at the bottom, IX at the left. The clock face and clock hands must remain readable in their natural direction. Keep the pose, expression, costume and lighting as close to the original as possible. Output a single full-body transparent cutout.

The renderer flips Vale and Pip on their image layer. The keeper selects the painted facing variant. Labels and carried item symbols keep their own orientation.

## Smaller images

The PNG files are the art sources. The image builder makes full-size WebP scene
files, 512-pixel-wide card files, and phone scene files that fit inside 960
pixels under `assets/optimized/`. It uses quality 88 and alpha quality 100.
Scene files keep the source dimensions and exact alpha values. Cards and phone
scenes keep the same shape at their smaller size. Existing WebP scene files
keep their published bytes. An image no larger than 960 pixels uses its scene
file as its phone file.

Build the images, then update their content hashes and the Rust asset list:

```sh
npm run v2:card:images:build
npm run v2:card:assets:build
```

The build encodes only new or changed sources. It reuses the committed scene
and card files when the source hash and encode settings match
`image-variants.json` and the committed files still match their recorded
hashes. It still checks the reused files' dimensions and alpha values. A sharp
upgrade or a different platform's encoder therefore leaves unchanged art and
its cached URLs alone. To re-encode every image on purpose, run
`npm run v2:card:images:build -- --reencode` in its own change.

Check the source hashes, output hashes, dimensions, alpha values, and image
preload with `npm run v2:card:images:check`. CI and the Docker build run only
this check.

`image-variants.json` records the source and output hashes. The browser's
`images.mjs` selects the scene, phone scene, or card file, then adds its content hash through
`media.mjs`. Catalogs and portrait-facing records use the authored image paths.

## The locked box lid

`card-back-locked.webp` is the lid of a card locked behind a quest
(`locked-box.mjs`). The closed-clasp artwork adds a brass padlock, two keeper
plates, chased oak detail and a contact shadow to the existing carved lid.
The original carving outside the central lock remains unchanged in the PNG
master. The runtime keeps the existing image path and 1024 by 1536 canvas.

This is a composited illustration for review, not a new model-generated
painting. `card-back-locked-provenance.json` records the pinned source,
editable SVG, deterministic recipe, original-sized PNG and runtime hashes;
its generation ID is null. Do not describe it as an image-model generation.

The editable drawing and PNG master live in `locked-card-back/`. Rebuild with
`python v2/card-game/assets/locked-card-back/build.py` from the repository
root, using Pillow 12.3.0, numpy 2.3.5 and CairoSVG 2.8.2. Then run the image
and asset builders above. The recipe stops if the source carving changes.
The regression test checks native size, hashes, published variants and
preservation of the wood outside the clasp.

The painting needs:

- 1024 by 1536 pixels (2:3), opaque and full bleed;
- the same carved-box lid as `card-back.webp`, seen straight down, so the two
  read as one box face down and locked;
- a lock or clasp, clearly shut;
- the same palette: worn wood, old brass, amber light and indigo shadow;
- no lettering.
