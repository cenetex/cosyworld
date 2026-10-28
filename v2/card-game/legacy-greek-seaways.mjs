import { controlledByHuman } from "./human-cast.mjs";

// Earlier visits knew a direct distant edge. Keep that knowledge as the actual
// landing, ship and local path now used for the same journey.
export const legacyGreekSeaPaths = [
  [
    "greek-harbor",
    "greek-ship",
    "greek-book-iv-helen-landing",
    "greek-egypt-tomb",
  ],
  ["greek-harbor", "greek-ship", "greek-ajax-landing", "greek-troy-beach"],
  ["greek-piraeus", "greek-ship", "greek-tauris-shore", "greek-tauris"],
  ["greek-piraeus", "greek-ship", "greek-sicily-shore", "greek-sicily"],
  [
    "greek-gate",
    "greek-courtyard",
    "greek-harbor",
    "greek-ship",
    "greek-aulis",
  ],
  ["greek-aulis", "greek-ship", "greek-ajax-landing", "greek-greek-camp"],
  [
    "greek-greek-camp",
    "greek-ajax-landing",
    "greek-ship",
    "greek-lemnos-landing",
    "greek-lemnos",
  ],
  [
    "greek-troy",
    "greek-greek-camp",
    "greek-ajax-landing",
    "greek-ship",
    "greek-thrace",
  ],
];
const paths = new Map(
  legacyGreekSeaPaths
    .flatMap((path) => [path, [...path].reverse()])
    .map((path) => [JSON.stringify([path[0], path.at(-1)]), path]),
);
const oldRemotePlaces = new Set([
  "greek-aulis",
  "greek-lemnos",
  "greek-greek-camp",
  "greek-trojan-camp",
  "greek-troy",
  "greek-thrace",
  "greek-susa",
  "greek-scythian-crag",
  "greek-egypt-tomb",
  "greek-troy-beach",
  "greek-tauris",
  "greek-sicily",
]);

export function upgradeGreekSeaKnowledge(world) {
  for (const [actor, known] of Object.entries(world.routeKnowledge || {})) {
    if (!Array.isArray(known)) continue;
    const expanded = known.flatMap((edge) => {
      const path = paths.get(JSON.stringify(edge));
      return path
        ? path.slice(1).map((to, index) => [path[index], to])
        : [edge];
    });
    world.routeKnowledge[actor] = [
      ...new Map(expanded.map((edge) => [JSON.stringify(edge), edge])).values(),
    ];
  }
  const signal = world.crossings?.["pond-greek-harbor"];
  if (
    signal?.discovered === false &&
    Object.entries(world.actors || {}).some(
      ([actor, state]) =>
        controlledByHuman(world, actor) && oldRemotePlaces.has(state?.place),
    )
  )
    signal.discovered = true;
}

export function restoreGreekLandingAccess(world) {
  const pack = world.packs?.["greek-drama"];
  if (
    pack?.revision === 8 &&
    pack.flags &&
    pack.choices &&
    (pack.flags["greek-ajax-open"] ||
      pack.choices["greek-helen-account"] === "troy")
  )
    pack.flags["greek-camp-road-open"] = true;
}
