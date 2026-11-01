// Native directions in the painted files. Stage positions supply the intended
// gaze; the browser combines that gaze with this art metadata for its transform.
// Keep this module in the presentation layer so saved rule bundles stay stable.
import { rarityForms, rarityPortraitAssets } from "./rarity-portraits.mjs";
const groups = {
  right: [
    ...rarityPortraitAssets.filter((file) => file.startsWith("assets/combat/")),
    "assets/boardyai/boardyai.png",
    ...["rati", "skull", "whiskerwind"].map(
      (name) => `assets/lonely-forest/${name}.png`,
    ),
    "assets/vale.png",
    "assets/keeper-right.png",
    ...["vale", "mara", "ash", "nell", "tavi", "rue", "orin", "ada"].flatMap(
      (id) => [
        `assets/shared/characters/${id}.png`,
        `assets/shared/characters/${id}-scarf.png`,
        ...["guard", "attack", "hit"].flatMap((pose) => [
          `assets/combat/${id}-${pose}.webp`,
          `assets/combat/${id}-scarf-${pose}.webp`,
        ]),
      ],
    ),
  ],
  left: [
    ...Object.values(rarityForms)
      .filter((form) => form.facing === "left")
      .map((form) => form.portrait),
    ...["swede", "swede-listening", "swede-worried", "swede-seated"].map(
      (name) => `assets/willows/${name}.webp`,
    ),
    "assets/moth.png",
    "assets/keeper.png",
    ...["moth", "keeper"].flatMap((id) =>
      ["guard", "attack", "hit"].map(
        (pose) => `assets/combat/${id}-${pose}.webp`,
      ),
    ),
    "assets/greek-drama/myrine.webp",
    ...["tecmessa", "teucer", "odysseus"].map(
      (name) => `assets/greek-drama/ajax-${name}.png`,
    ),
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
    ...Object.values(rarityForms)
      .filter((form) => form.facing === "front")
      .map((form) => form.portrait),
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

    "assets/lonely-forest/oak.png",
    "assets/lonely-forest/oakheart.webp",
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

// Broad silhouettes keep their whole face and arms inside a narrow scene.
const widePortraits = new Set([
  "assets/lonely-forest/skull.png",
  "assets/lonely-forest/whiskerwind.png",
  "assets/moth.png",
  "assets/keeper.png",
  "assets/keeper-right.png",
  ...Object.keys(portraitFacings).filter((file) =>
    file.startsWith("assets/combat/"),
  ),
]);
export const portraitFraming = (cutout) =>
  widePortraits.has(cutout.replace(/^\.\//, "")) ? "wide" : "standard";
