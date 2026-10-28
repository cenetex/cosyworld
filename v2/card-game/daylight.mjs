// Places resolve their light from the saved world clock.
export const DAYLIGHT_TURNS = 24;
export const WILLOWS_PHASE_TURNS = 8;
const willowsPlaces = new Set([
  "willows-landing",
  "willows-camp",
  "willows-thicket",
  "willows-bank",
]);
const willowsPhases = ["dawn", "day", "day", "dusk", "night", "night"];
const willowsLight = {
  dawn: "Dawn brings pale light to the Danube island.",
  day: "It is day on the Danube island.",
  dusk: "Dusk settles over the Danube island.",
  night: "It is night on the Danube island.",
};
const art = (file) => `assets/greek-drama/${file}.webp`;
const nightBackdrops = {
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
export const daylightAssets = [
  ...new Set([
    ...Object.values(nightBackdrops),
    ...Object.values(dockedNightBackdrops),
  ]),
];

export function locationDaylight(world, id) {
  if (!world) return null;
  if (willowsPlaces.has(id)) {
    const period = Math.floor(world.turn / WILLOWS_PHASE_TURNS);
    const phase = willowsPhases[period % willowsPhases.length];
    return { phase, period, description: willowsLight[phase] };
  }
  if (!Object.hasOwn(nightBackdrops, id)) return null;
  const period = Math.floor(world.turn / DAYLIGHT_TURNS);
  const phase = period % 2 ? "night" : "day";
  const where =
    id === "greek-athens-harbor"
      ? "at Athens Harbor"
      : id === "greek-piraeus"
        ? "at Piraeus Quays"
        : id === "greek-greek-camp" || id.startsWith("greek-ajax-")
          ? "at the Greek camp near Troy"
          : "in Thebes";
  return {
    phase,
    period,
    description: `It is ${phase} ${where}.`,
  };
}

export function daylightBackdrop(world, id, file) {
  if (locationDaylight(world, id)?.phase !== "night") return file;
  return dockedNightBackdrops[file] || nightBackdrops[id] || file;
}
