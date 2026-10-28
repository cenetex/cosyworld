# Conversation art

`keeper-right.png` is the right-facing companion to `keeper.png`. It was made with the built-in image generation tool from the original cutout. Both files retain a transparent background and a 1024 by 1536 canvas.

Prompt used:

> Use case: identity-preserve. Asset type: opposite facing cutout for a JRPG conversation scene. Edit target: the supplied full-body keeper PNG. Create the same exact clock-headed railway keeper facing toward the viewer's RIGHT instead of left. Preserve the existing detailed hand-painted ink and watercolor art, identity, purple coat, cap, gloves, shushing finger, proportions, subtle texture and full body from hat to shoes, transparent background, centered 2:3 canvas, feet at the same baseline. Mirror the pose and silhouette horizontally but paint the clock face with correctly oriented Roman numerals and clockwise order, XII at the top, III at the right, VI at the bottom, IX at the left. The clock face and clock hands must remain readable in their natural direction. Keep the pose, expression, costume and lighting as close to the original as possible. Output a single full-body transparent cutout.

The renderer flips Vale and Pip on their image layer. The keeper selects the painted facing variant. Labels and carried item symbols keep their own orientation.

## Smaller images

The PNG files are the art sources. The image builder makes full-size WebP scene
files and 512-pixel-wide card files under `assets/optimized/`. It uses quality 88
and alpha quality 100. Scene files keep the source dimensions and exact alpha
values. Cards keep the same shape at their smaller size. Existing WebP scene
files keep their published bytes.

Build the images, then update their content hashes and the Rust asset list:

```sh
node v2/scripts/build-card-images.mjs
npm run v2:card:assets:build
```

Check the source hashes, output hashes, dimensions, alpha values, and image
preload with `node v2/scripts/build-card-images.mjs --check`.

`image-variants.json` records the source and output hashes. The browser's
`images.mjs` selects the scene or card file, then adds its content hash through
`media.mjs`. Catalogs and portrait-facing records use the authored image paths.
