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
