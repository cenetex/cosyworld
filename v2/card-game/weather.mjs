// Every place in a region reads the same committed turn. Save reloads and
// shared viewers therefore keep the same weather, including during dialogue.
export const WEATHER_TURNS = 12;

const cycles = {
  boeotia: ["clear", "cloud", "rain", "cloud", "mist", "clear"],
  attica: ["clear", "clear", "cloud", "rain", "cloud", "mist"],
  argolid: ["cloud", "clear", "clear", "mist", "cloud", "rain"],
  phocis: ["mist", "cloud", "rain", "cloud", "clear", "clear"],
  thessaly: ["cloud", "rain", "mist", "clear", "clear", "cloud"],
  troad: ["mist", "cloud", "rain", "rain", "cloud", "clear"],
  thrace: ["cloud", "mist", "rain", "cloud", "clear", "cloud"],
  lemnos: ["clear", "mist", "cloud", "rain", "cloud", "clear"],
  egypt: ["clear", "clear", "cloud", "clear", "mist", "clear"],
  tauris: ["mist", "rain", "cloud", "clear", "cloud", "rain"],
  sicily: ["clear", "cloud", "clear", "mist", "rain", "cloud"],
  susa: ["clear", "clear", "cloud", "clear", "cloud", "rain"],
  scythia: ["cloud", "rain", "mist", "cloud", "rain", "clear"],
  heights: ["mist", "clear", "cloud", "mist", "clear", "cloud"],
  underworld: ["mist"],
};

const locations = {};
function group(region, exposure, names) {
  for (const name of names.split(" "))
    locations[`greek-${name}`] = { region, exposure };
}
group("boeotia", "coast", "harbor aulis ship");
group("boeotia", "court", "courtyard well palace");
group("boeotia", "shelter", "heracles-theban-house");
group("boeotia", "open", "gate battlefield road-thebes");
group("boeotia", "grove", "sanctuary cithaeron");
group("attica", "court", "athens acropolis acharnae");
group(
  "attica",
  "coast",
  "piraeus athens-harbor road-athens-harbor road-piraeus-eleusis",
);
group(
  "attica",
  "open",
  "road-athens-piraeus road-athens-colonus road-athens-eleusis road-athens-marathon road-colonus-eleusis road-colonus-marathon heracles-athens-road",
);
group("attica", "open", "assembly attic-farm marathon");
group("attica", "shelter", "demos-house thinkery jury-house heracles-athens-guest-room");
group("attica", "grove", "festival colonus eleusis bird-wilderness");
group("argolid", "open", "argolid-road argos-tomb");
group("argolid", "coast", "argos-sanctuary");
group("argolid", "court", "argos-palace mycenae-palace corinth troezen danaid-refuge-court");
group("argolid", "shelter", "argive-farm");
group("phocis", "court", "delphi");
group("thessaly", "shelter", "trachis");
group("thessaly", "open", "oeta trachis-canae-approach");
group("thessaly", "court", "pherae");
group("thessaly", "grove", "thetis");
group("troad", "open", "troy trojan-camp");
group("troad", "coast", "greek-camp troy-beach ajax-landing");
group("troad", "shelter", "ajax-household");
group("troad", "open", "ajax-grave");
group("thrace", "coast", "thrace");
group("lemnos", "shelter", "lemnos");
group("egypt", "court", "egypt-tomb");
group("tauris", "court", "tauris");
group("sicily", "shelter", "sicily");
group("susa", "court", "susa");
group("scythia", "open", "scythian-crag");
group("heights", "open", "divine-heights");
group("underworld", "underground", "underworld");

export function regionWeather(world, region) {
  const cycle = cycles[region];
  if (!cycle) return null;
  const period = Math.floor(world.turn / WEATHER_TURNS);
  return { region, period, condition: cycle[period % cycle.length] };
}

const descriptions = {
  clear: {
    coast: "Clear light falls across the water.",
    court: "Clear light rests on the courtyard stones.",
    open: "Clear light reaches across the open ground.",
    grove: "Clear light falls between the branches.",
    shelter: "Clear light reaches the doorway.",
  },
  cloud: {
    coast: "Cloud lies over the water.",
    court: "Cloud softens the light on the stones.",
    open: "Cloud gathers above the open ground.",
    grove: "Cloud dims the light beneath the branches.",
    shelter: "Cloud dims the light at the doorway.",
  },
  rain: {
    coast: "Rain blows across the landing and water.",
    court: "Rain falls on the courtyard stones.",
    open: "Rain sweeps across the open ground.",
    grove: "Rain falls through the branches.",
    shelter: "Rain falls outside the shelter.",
  },
  mist: {
    coast: "Sea mist drifts across the water.",
    court: "Mist gathers along the courtyard stones.",
    open: "Mist lies across the open ground.",
    grove: "Mist gathers beneath the branches.",
    shelter: "Mist lies beyond the doorway.",
    underground: "Low mist hangs above the dark water.",
  },
};

export function locationWeather(world, id) {
  const place = locations[id];
  if (!place) return null;
  const weather = regionWeather(world, place.region);
  return {
    ...weather,
    exposure: place.exposure,
    variant: `${weather.condition}-${place.exposure}`,
    description: descriptions[weather.condition][place.exposure],
  };
}
