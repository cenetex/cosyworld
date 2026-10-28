// Native directions in the painted files. Stage positions supply the intended
// gaze; the browser combines that gaze with this art metadata for its transform.
// Keep this module in the presentation layer so saved rule bundles stay stable.
const groups = {
  right: [
    "assets/boardyai/boardyai.png",
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
    "assets/hoppycat-archive/hoppycat-tapi-lilt.webp",
    "assets/hoppycat-archive/hoppycat-penny-vellum.webp",
    "assets/hoppycat-archive/hoppycat-rill-current.webp",
    "assets/hoppycat-archive/hoppycat-patch-fern.webp",
    "assets/hoppycat-archive/hoppycat-lumen-facet.webp",
    "assets/hoppycat-archive/hoppycat-mira-meraki.webp",
    "assets/hoppycat-archive/hoppycat-glim-twice.webp",
    "assets/hoppycat-archive/hoppycat-nix-fermata.webp",
    "assets/hoppycat-archive/hoppycat-hoppy-cat.webp",
    "assets/hoppycat-archive/hoppycat-fable.webp",
    "assets/hoppycat-archive/hoppycat-phase-two.webp",
    "assets/hoppycat-archive/hoppycat-arc.webp",
    "assets/hoppycat-archive/hoppycat-staticwashere.webp",
    "assets/hoppycat-archive/hoppycat-solwashere.webp",
    "assets/hoppycat-archive/hoppycat-ledger-opus.webp",
    "assets/hoppycat-archive/hoppycat-ledger-sonnet.webp",

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
