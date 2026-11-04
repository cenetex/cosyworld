// Cuts the owner's moonlit workbench into the Settings cards' paintings
// (PROVENANCE.md). Each crop is a lossless, unscaled region of the source at
// about the quest card's place ratio (7:5), so the card's cover fit keeps the
// object whole. Run from the repo root:
//   node v2/card-game/assets/settings/build-workbench-crops.mjs
// then npm run v2:card:images:build and npm run v2:card:assets:build.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const here = new URL("./", import.meta.url);
const SOURCE = "source/moonlit-cozy-fantasy-workbench.png";
// name: [left, top, width, height] in the 2172 x 724 source.
export const CROPS = {
  letter: [624, 245, 392, 280],
  dice: [444, 278, 392, 280],
  "dice-cup": [737, 180, 336, 240],
  candle: [758, 70, 644, 460],
  "old-books": [0, 110, 448, 320],
  mug: [486, 185, 364, 260],
  armillary: [1084, 100, 532, 380],
  scroll: [1490, 245, 420, 300],
  "book-stack": [1383, 235, 364, 260],
  window: [1528, 0, 644, 460],
  moth: [116, 60, 728, 520],
  // The Settings hand's groups (You, Play) and the cards that were figures.
  you: [470, 280, 504, 360],
  play: [590, 190, 476, 340],
  lamplight: [880, 300, 504, 360],
  flame: [930, 90, 280, 200],
  ears: [360, 70, 336, 240],
  wing: [150, 330, 392, 280],
  gear: [1150, 270, 336, 240],
  moon: [1820, 30, 336, 240],
};

const hash = (body) => createHash("sha256").update(body).digest("hex");
const source = await readFile(new URL(SOURCE, here));
const crops = {};
for (const [name, [left, top, width, height]] of Object.entries(CROPS)) {
  const file = `workbench-${name}.png`;
  const body = await sharp(source)
    .extract({ left, top, width, height })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(new URL(file, here), body);
  crops[file] = { left, top, width, height, sha256: hash(body) };
}
const record = {
  source: SOURCE,
  supplied: "Moonlit Cozy Fantasy Workbench.png",
  suppliedBy: "owner",
  date: "2026-11-04",
  width: 2172,
  height: 724,
  sha256: hash(source),
  crops,
};
await writeFile(
  new URL("workbench.provenance.json", here),
  `${JSON.stringify(record, null, 2)}\n`,
);
console.log(`Workbench crops: ${Object.keys(crops).length} written.`);
