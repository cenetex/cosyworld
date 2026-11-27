// Sleeping is committed state, never inferred from a Wait or the clock.
import { avatarImage, scarfPortrait } from "./scarves.mjs";

const travelers = new Set([
  "vale",
  "mara",
  "ash",
  "nell",
  "tavi",
  "rue",
  "orin",
  "ada",
]);
// Approved resident sleep art is registered by actor id. Aliases can point
// to the same asset without changing the world-life rules or base portrait.
// Source art and character aliases are recorded in docs/design/assets/resident-sleep.
const residentSleepArt = [
  "greek-ismene",
  "greek-creon",
  "greek-elder",
  "greek-shipmaster",
  "greek-market-neighbor",
  "greek-temple-attendant",
  "greek-ferryman",
  "greek-helen-egypt",
  "greek-menelaus-egypt",
  "greek-electra-aeschylus",
  "greek-orestes-aeschylus",
  "greek-aethra",
  "greek-adrastus",
  "greek-argive-mother",
  "greek-iphis",
  "greek-theseus",
  "greek-quay-host",
  "greek-colonus-keeper",
  "greek-marathon-keeper",
  "greek-household-witness",
  "greek-ajax-tecmessa",
  "greek-ajax-teucer",
  "greek-ajax-odysseus",
  "hoppycat-tapi-lilt",
  "hoppycat-penny-vellum",
  "hoppycat-rill-current",
  "hoppycat-patch-fern",
  "hoppycat-lumen-facet",
  "hoppycat-mira-meraki",
  "hoppycat-glim-twice",
  "hoppycat-nix-fermata",
  "hoppycat-hoppy-cat",
  "hoppycat-fable",
  "hoppycat-phase-two",
  "hoppycat-arc",
  "hoppycat-staticwashere",
  "hoppycat-solwashere",
  "hoppycat-ledger-opus",
  "hoppycat-ledger-sonnet",
  "willows-swede",
  "rati",
  "skull",
  "whiskerwind",
  "oak",
];
const residentSleepAliases = {
  "greek-helen-troy": "greek-helen-egypt",
  "greek-menelaus-troy": "greek-menelaus-egypt",
  "greek-electra-sophocles": "greek-electra-aeschylus",
  "greek-electra-euripides": "greek-electra-aeschylus",
  "greek-orestes-sophocles": "greek-orestes-aeschylus",
  "greek-orestes-euripides": "greek-orestes-aeschylus",
};
const residentSleepPath = (id) => `assets/sleep/residents/${id}-sleeping.webp`;
const residentSleepPortraits = {
  ...Object.fromEntries(residentSleepArt.map((id) => [id, residentSleepPath(id)])),
  badger: "assets/badger-forest/badger-sleeping.png",
  "greek-antigone": "assets/sleep/residents/greek-antigone-sleeping.png",
  "greek-baker": "assets/sleep/greek-baker-sleeping.png",
  "greek-patroclus": "assets/sleep/residents/greek-patroclus-sleeping.png",
  listener: "assets/listener/listener-sleeping.webp",
};
export const sleepPortraitAssets = [
  ...[...travelers].flatMap((id) =>
    ["", "-scarf"].map(
      (wardrobe) => `assets/shared/characters/${id}-sleeping${wardrobe}.webp`,
    ),
  ),
  ...Object.values(residentSleepPortraits),
  ...["moth", "keeper"].map((id) => `assets/sleep/${id}-sleeping.webp`),
];

export function sleepingPortrait(world, id) {
  if (!world?.actors?.[id]?.sleeping) return null;
  if (travelers.has(id)) {
    const scarf = avatarImage(world, id) === scarfPortrait(id);
    return `assets/shared/characters/${id}-sleeping${scarf ? "-scarf" : ""}.webp`;
  }
  const resident = residentSleepPortraits[residentSleepAliases[id] ?? id];
  if (resident) return resident;
  return ["moth", "keeper"].includes(id)
    ? `assets/sleep/${id}-sleeping.webp`
    : null;
}
