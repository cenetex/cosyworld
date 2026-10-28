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
    "assets/willows/swede.webp",
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
    "assets/hoppycat-archive/hoppycat-tapi-lilt-cutout.png",
    "assets/hoppycat-archive/hoppycat-penny-vellum-cutout.png",
    "assets/hoppycat-archive/hoppycat-rill-current-cutout.png",
    "assets/hoppycat-archive/hoppycat-patch-fern-cutout.png",
    "assets/hoppycat-archive/hoppycat-lumen-facet-cutout.png",
    "assets/hoppycat-archive/hoppycat-mira-meraki-cutout.png",
    "assets/hoppycat-archive/hoppycat-glim-twice-cutout.png",
    "assets/hoppycat-archive/hoppycat-nix-fermata-cutout.png",
    "assets/hoppycat-archive/hoppycat-hoppy-cat-cutout.png",
    "assets/hoppycat-archive/hoppycat-fable-cutout.png",
    "assets/hoppycat-archive/hoppycat-phase-two-cutout.png",
    "assets/hoppycat-archive/hoppycat-arc-cutout.png",
    "assets/hoppycat-archive/hoppycat-staticwashere-cutout.png",
    "assets/hoppycat-archive/hoppycat-solwashere-cutout.png",
    "assets/hoppycat-archive/hoppycat-ledger-opus-cutout.png",
    "assets/hoppycat-archive/hoppycat-ledger-sonnet-cutout.png",

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
