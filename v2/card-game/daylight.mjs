// The Theban places and the ship's harbors share the saved world clock.
export const DAYLIGHT_TURNS = 24;
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
};
const dockedNightBackdrops = {
  [art("harbor-ship-at-berth")]: art("harbor-ship-at-berth-night"),
  [art("athens-harbor")]: art("athens-harbor-ship-at-berth-night"),
  [art("open-door-piraeus")]: art("piraeus-ship-at-berth-night"),
};
export const daylightAssets = [
  ...Object.values(nightBackdrops),
  ...Object.values(dockedNightBackdrops),
];

export function locationDaylight(world, id) {
  if (!world || !Object.hasOwn(nightBackdrops, id)) return null;
  const period = Math.floor(world.turn / DAYLIGHT_TURNS);
  const phase = period % 2 ? "night" : "day";
  const where =
    id === "greek-athens-harbor"
      ? "at Athens Harbor"
      : id === "greek-piraeus"
        ? "at Piraeus Quays"
        : "in Thebes";
  return {
    phase,
    period,
    description: `It is ${phase} ${where}.`,
  };
}

export function daylightBackdrop(world, id, file) {
  if (locationDaylight(world, id)?.phase !== "night") return file;
  return dockedNightBackdrops[file] || nightBackdrops[id];
}
