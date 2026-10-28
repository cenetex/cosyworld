// The seven Theban places share the saved world clock.
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
};
const dockedDay = art("harbor-ship-at-berth");
const dockedNight = art("harbor-ship-at-berth-night");
export const daylightAssets = [...Object.values(nightBackdrops), dockedNight];

export function locationDaylight(world, id) {
  if (!world || !Object.hasOwn(nightBackdrops, id)) return null;
  const period = Math.floor(world.turn / DAYLIGHT_TURNS);
  const phase = period % 2 ? "night" : "day";
  return {
    phase,
    period,
    description:
      phase === "night" ? "It is night in Thebes." : "It is day in Thebes.",
  };
}

export function daylightBackdrop(world, id, file) {
  if (locationDaylight(world, id)?.phase !== "night") return file;
  return id === "greek-harbor" && file === dockedDay
    ? dockedNight
    : nightBackdrops[id];
}
