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
const houseArt = (file) => `assets/greek-drama/house-of-blood/${file}.png`;
const housePlaceWords = {
  "greek-thrace": "on the remembered Thracian shore",
  "greek-thrace-summons-tent": "on the remembered Thracian shore",
  "greek-thrace-burial-ground": "on the remembered Thracian shore",
  "greek-susa": "at the historical court at Susa",
  "greek-susa-tomb": "at the historical court at Susa",
  "greek-susa-threshold": "at the historical court at Susa",
  "greek-susa-road": "at the historical court at Susa",
  "greek-aulis": "at the remembered Aulis anchorage",
  "greek-aulis-household": "at the remembered Aulis anchorage",
  "greek-aulis-altar": "at the remembered Aulis anchorage",
  "greek-lemnos": "on the remembered Lemnian shore",
  "greek-lemnos-landing": "on the remembered Lemnian shore",
  "greek-ares-hill": "on Ares Hill",
  "greek-argos-refuge": "at the Argive Refuge",
  "greek-tauris-shore": "on the Taurian Shore",
};
const nightBackdrops = {
  "greek-cithaeron": art("bacchae-cithaeron-night"),
  "greek-egypt-tomb": art("helen-egypt-tomb-night"),
  "greek-book-iv-helen-court": art("helen-egypt-tomb-night"),
  "greek-book-iv-helen-landing": art("helen-egypt-tomb-night"),
  "greek-harbor": art("harbor-open-berth-night"),
  "greek-courtyard": art("courtyard-night"),
  "greek-pherae": art("book-two-pherae-night"),
  "greek-trachis": art("book-two-trachis-night"),
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
  "greek-ares-hill": houseArt("ares-hill-scene-night"),
  "greek-argos-refuge": houseArt("argos-refuge-scene-night"),
  "greek-tauris-shore": houseArt("tauris-shore-scene-night"),
  "greek-aulis": art("ajax-camp-night"),
  "greek-aulis-household": art("ajax-camp-night"),
  "greek-aulis-altar": art("ajax-camp-night"),
  "greek-lemnos": art("book-three-lemnos-night"),
  "greek-lemnos-landing": art("book-three-lemnos-night"),
  "greek-thrace": art("book-three-thrace-night"),
  "greek-thrace-summons-tent": art("book-three-thrace-night"),
  "greek-thrace-burial-ground": art("book-three-thrace-night"),
  "greek-susa": art("book-three-susa-night"),
  "greek-susa-tomb": art("book-three-susa-night"),
  "greek-susa-threshold": art("book-three-susa-night"),
};
const dockedNightBackdrops = {
  [art("harbor-ship-at-berth")]: art("harbor-ship-at-berth-night"),
  [art("athens-harbor")]: art("athens-harbor-ship-at-berth-night"),
  [art("open-door-piraeus")]: art("piraeus-ship-at-berth-night"),
  [houseArt("tauris-shore-ship-at-berth")]: houseArt(
    "tauris-shore-ship-at-berth-night",
  ),
};
export const daylightAssets = [
  ...new Set([
    ...Object.values(nightBackdrops),
    ...Object.keys(dockedNightBackdrops),
    ...Object.values(dockedNightBackdrops),
  ]),
];

export function locationDaylight(world, id) {
  if (!world) return null;
  if (willowsPlaces.has(id)) {
    const period = Math.floor(world.turn / WILLOWS_PHASE_TURNS);
    const phase = willowsPhases[period % willowsPhases.length];
    return {
      phase,
      period,
      description:
        willowsLight[phase] +
        (id === "willows-landing" && phase === "night"
          ? " A Greek ship waits in the backwater, its lanterns reflected on the river."
          : ""),
    };
  }
  if (!Object.hasOwn(nightBackdrops, id)) return null;
  const period = Math.floor(world.turn / DAYLIGHT_TURNS);
  const phase = period % 2 ? "night" : "day";
  const where =
    housePlaceWords[id] ||
    (id === "greek-egypt-tomb" || id.startsWith("greek-book-iv-helen-")
      ? "by the Nile in Helen’s Egyptian account"
      : id === "greek-cithaeron"
        ? "on Cithaeron Slopes"
        : id === "greek-pherae"
          ? "in Pherae"
          : id === "greek-trachis"
            ? "at Trachis"
            : id === "greek-athens-harbor"
              ? "at Athens Harbor"
              : id === "greek-piraeus"
                ? "at Piraeus Quays"
                : id === "greek-greek-camp" || id.startsWith("greek-ajax-")
                  ? "at the Greek camp near Troy"
                  : "in Thebes");
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
