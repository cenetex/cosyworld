import weather from "./weather.json" with { type: "json" };
// Every place in a region reads the same committed turn. Save reloads and
// shared viewers therefore keep the same weather, including during dialogue.
// The regional cycles and each place's exposure are data in weather.json;
// the weather is a word, and the narrator's words describe it.
export const WEATHER_TURNS = weather.turns;

const locations = Object.fromEntries(
  Object.entries(weather.places).flatMap(([region, exposures]) =>
    Object.entries(exposures).flatMap(([exposure, ids]) =>
      ids.map((id) => [id, { region, exposure }]),
    ),
  ),
);

export function regionWeather(world, region) {
  const cycle = weather.cycles[region];
  if (!cycle) return null;
  const period = Math.floor(world.turn / WEATHER_TURNS);
  return { region, period, condition: cycle[period % cycle.length] };
}

export function locationWeather(world, id) {
  const place = locations[id];
  if (!place) return null;
  const now = regionWeather(world, place.region);
  return {
    ...now,
    exposure: place.exposure,
    variant: `${now.condition}-${place.exposure}`,
  };
}
