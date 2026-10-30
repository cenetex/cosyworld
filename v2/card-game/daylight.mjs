import { locationWeather } from "./weather.mjs";

// Painted Greek and Willows places share the saved world clock.
export const DAYLIGHT_TURNS = 24;
// Night is every other block of DAYLIGHT_TURNS on the saved world clock.
export const isNight = (world) =>
  Math.floor((world?.turn ?? 0) / DAYLIGHT_TURNS) % 2 === 1;
// The Willows mist rises beside the ship's rail only on a misty night.
export const darkMist = (world) =>
  isNight(world) && locationWeather(world, "greek-ship")?.condition === "mist";
const art = (file) => `assets/greek-drama/${file}.webp`;
const willows = (file) => `assets/willows/${file}.webp`;
// The ship shows at the Willows landing only in dark mist.
const darkMistBackdrops = {
  "willows-landing": willows("landing-ship-night"),
};
const nightBackdrops = {
  "willows-camp": willows("camp-lit-night"),
  "greek-harbor": art("harbor-open-berth-night"),
  "greek-courtyard": art("courtyard-night"),
  "greek-well": art("market-well-night"),
  "greek-palace": art("palace-night"),
  "greek-gate": art("city-gate-night"),
  "greek-battlefield": art("burial-ground-night"),
  "greek-sanctuary": art("sanctuary-night"),
  "greek-road-thebes": art("theban-harbor-road-night"),
  "greek-athens-harbor": art("athens-harbor-open-berth-night"),
  "greek-piraeus": art("piraeus-open-berth-night"),
  "greek-athens": art("athens-grand-agora-night"),
  "greek-colonus": art("open-door-colonus-night"),
  "greek-eleusis": art("open-door-eleusis-night"),
  "greek-marathon": art("open-door-marathon-night"),
  "greek-ship": art("ship-deck-night"),
  "greek-road-athens-harbor": art("attic-road-night"),
  "greek-road-athens-piraeus": art("attic-road-night"),
  "greek-road-athens-colonus": art("attic-road-night"),
  "greek-road-athens-eleusis": art("attic-road-night"),
  "greek-road-athens-marathon": art("attic-road-night"),
  "greek-road-piraeus-eleusis": art("attic-road-night"),
  "greek-road-colonus-eleusis": art("attic-road-night"),
  "greek-road-colonus-marathon": art("attic-road-night"),
  "greek-aulis": art("aulis-anchorage-night"),
  "greek-troy": art("trojan-walls-night"),
  "greek-trojan-camp": art("trojan-night-camp-night"),
  "greek-lemnos": art("lemnian-cave-night"),
  "greek-thrace": art("thracian-shore-night"),
  "greek-troy-beach": art("homecoming-beach-night"),
  "greek-greek-camp": art("ajax-camp-night"),
  "greek-ajax-landing": art("ajax-camp-night"),
  "greek-ajax-household": art("ajax-camp-night"),
  "greek-ajax-grave": art("ajax-camp-night"),
};
const dockedNightBackdrops = {
  [art("harbor-ship-at-berth")]: art("harbor-ship-at-berth-night"),
  [art("athens-harbor")]: art("athens-harbor-ship-at-berth-night"),
  [art("open-door-piraeus")]: art("piraeus-ship-at-berth-night"),
};
const placeDescriptions = {
  "greek-athens-harbor": "at Athens Harbor",
  "greek-piraeus": "at Piraeus Quays",
  "greek-athens": "in the Athenian Agora",
  "greek-colonus": "in Colonus Grove",
  "greek-eleusis": "at the Eleusinian Sanctuary",
  "greek-marathon": "at Marathon Altar",
  "greek-aulis": "at Aulis Anchorage",
  "greek-troy": "by the Trojan walls",
  "greek-trojan-camp": "at the Trojan camp",
  "greek-lemnos": "at the Lemnian Cave",
  "greek-thrace": "on the Thracian shore",
  "greek-troy-beach": "on the Homecoming Beach",
  "greek-ship": "aboard the Greek ship",
  "willows-landing": "on the Danube island",
  "willows-camp": "on the Danube island",
};
export const daylightAssets = [
  ...new Set([
    ...Object.values(darkMistBackdrops),
    ...Object.values(nightBackdrops),
    ...Object.values(dockedNightBackdrops),
  ]),
];

export function locationDaylight(world, id) {
  if (
    !world ||
    !(Object.hasOwn(nightBackdrops, id) || Object.hasOwn(darkMistBackdrops, id))
  )
    return null;
  const period = Math.floor(world.turn / DAYLIGHT_TURNS);
  const phase = isNight(world) ? "night" : "day";
  const where =
    placeDescriptions[id] ||
    (id === "greek-greek-camp" || id.startsWith("greek-ajax-")
      ? "at the Greek camp near Troy"
      : id.startsWith("greek-road-") && id !== "greek-road-thebes"
        ? "on the Attic roads"
        : "in Thebes");
  return {
    phase,
    period,
    description: `It is ${phase} ${where}.`,
  };
}

export function daylightBackdrop(world, id, file) {
  if (Object.hasOwn(darkMistBackdrops, id))
    return darkMist(world) ? darkMistBackdrops[id] : file;
  if (locationDaylight(world, id)?.phase !== "night") return file;
  return dockedNightBackdrops[file] || nightBackdrops[id];
}
