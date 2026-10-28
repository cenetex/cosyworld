// Native directions in the painted files. Stage positions supply the intended
// gaze; the browser combines that gaze with this art metadata for its transform.
// Keep this module in the presentation layer so saved rule bundles stay stable.
const groups = {
  right: [
    "assets/boardyai/boardyai.png",
    ...["rati", "skull", "whiskerwind"].map(
      (name) => `assets/lonely-forest/${name}.png`,
    ),
    "assets/vale.png",
    "assets/keeper-right.png",
    ...["vale", "mara", "ash", "nell", "tavi", "rue", "orin", "ada"].map(
      (id) => `assets/shared/characters/${id}.png`,
    ),
  ],
  left: [
    "assets/moth.png",
    "assets/keeper.png",
    "assets/greek-drama/myrine.webp",
    ...[
      "antigone",
      "ismene",
      "creon",
      "guard",
      "baker",
      "elder",
      "shipmaster",
      "singer",
      "neighbor",
      "attendant",
      "ferryman",
      "helen",
      "menelaus",
      "electra",
      "orestes",
    ].map((name) => `assets/greek-drama/chthonic-${name}.png`),
    ...[
      "aethra",
      "adrastus",
      "mother",
      "iphis",
      "theseus",
      "quay-host",
      "grove-keeper",
      "altar-keeper",
    ].map((name) => `assets/greek-drama/open-door-${name}.webp`),
  ],
  front: [
    "assets/lonely-forest/oak.png",
    "assets/badger-forest/badger-sleeping.png",
    "assets/badger-forest/badger-grumpy.png",
  ],
};
export const portraitFacings = Object.freeze(
  Object.fromEntries(
    Object.entries(groups).flatMap(([facing, files]) =>
      files.map((file) => [file, facing]),
    ),
  ),
);
export const nativePortraitFacing = (cutout) =>
  portraitFacings[cutout.replace(/^\.\//, "")] || null;
export function flipStagePortrait(cutout, facing) {
  const native = nativePortraitFacing(cutout);
  return Boolean(native && native !== "front" && native !== facing);
}

// Broad animal silhouettes keep their whole face inside a narrow scene.
const widePortraits = new Set([
  "assets/lonely-forest/skull.png",
  "assets/lonely-forest/whiskerwind.png",
]);
export const portraitFraming = (cutout) =>
  widePortraits.has(cutout.replace(/^\.\//, "")) ? "wide" : "standard";
