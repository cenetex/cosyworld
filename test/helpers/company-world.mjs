// A small made-up world for the companion rules (rules 133): two packs of
// invented places and people, a gate that opens for whoever carries a key, a
// ship lane between a home dock and a pier in the other pack, and a crossing
// between the packs. The tests mount it with vi.mock on packs.json, so story
// edits to the real packs never touch them.
const person = (name, place, extra = {}) => ({
  name,
  text: `${name} stands about.`,
  place,
  home: place,
  seed: `${name}, an invented resident.`,
  portrait: "assets/PACK/p.png",
  tastes: { likes: "quiet", sore: "noise", reason: `${name} likes quiet.` },
  ...extra,
});
const spot = (name, exits = [], extra = {}) => ({
  name,
  text: `${name}.`,
  persona: `${name}.`,
  exits,
  backdrop: "assets/PACK/x.png",
  ...extra,
});

export const home = {
  schemaVersion: 1,
  id: "co-home",
  packId: "cosyworld.co-home",
  revision: 1,
  name: "Company Home",
  description: "An invented pack for the companion tests.",
  entry: "co-a",
  places: {
    "co-a": spot("Place A", ["co-b"]),
    "co-b": spot("Place B", ["co-a", "co-c"], { sanctuary: true }),
    "co-c": spot("Place C", ["co-b", "co-dock", "co-pit"]),
    "co-pit": spot("The Pit", []),
    "co-dock": spot("Home Dock", ["co-c"]),
    "co-yard": spot("Locked Yard", []),
    "co-ship": spot("The Test Ship", []),
  },
  avatars: {
    "co-ann": person("Ann", "co-a"),
    "co-bo": person("Bo", "co-b"),
    "co-cy": person("Cy", "co-c"),
    "co-oak": person("The Post", "co-a", {
      travels: false,
    }),
  },
  items: {
    "co-key": {
      name: "Test Key",
      text: "A key for the yard.",
      holder: "co-cy",
      persona: "A key.",
      art: "assets/PACK/k.png",
    },
  },
  routes: [
    // The way out of the yard is open only while the key lies in the yard.
    {
      from: "co-yard",
      to: "co-b",
      live: true,
      requires: [{ kind: "item_near", item: "co-key", place: "co-yard" }],
    },
    {
      from: "co-b",
      to: "co-yard",
      live: true,
      requires: [],
      travelerRequires: [{ kind: "holding", item: "co-key", role: "actor" }],
    },
  ],
  transports: {
    "co-ship": {
      place: "co-ship",
      docks: ["co-dock", "co-far-pier"],
      lanes: [
        { from: "co-dock", to: "co-far-pier" },
      ],
      at: "co-dock",
      waitVerb: "Sail",
      waitSentence: "{actor} sails on.",
    },
  },
  crossings: [
    {
      id: "co-dock-ship",
      from: "co-dock",
      to: "co-far-pier",
      travelers: "any",
      travel: "aboard the ship",
      travelLabel: "Board",
      requires: [],
      transport: "co-ship",
      scenery: { open: "The test ship waits.", cardName: "The Test Ship" },
    },
    {
      id: "co-pier-ship",
      from: "co-far-pier",
      to: "co-dock",
      travelers: "any",
      travel: "aboard the ship",
      travelLabel: "Board",
      requires: [],
      transport: "co-ship",
      scenery: { open: "The test ship waits.", cardName: "The Test Ship" },
    },
    {
      id: "station-co-a",
      from: "station",
      to: "co-a",
      travelers: "any",
      travel: "through the test door",
      requires: [],
    },
    {
      id: "co-a-station",
      from: "co-a",
      to: "station",
      travelers: "any",
      travel: "through the test door",
      requires: [],
    },
  ],
  choices: [],
  bridge: { id: "shore-co-home", description: "Invented." },
};

export const away = {
  schemaVersion: 1,
  id: "co-away",
  packId: "cosyworld.co-away",
  revision: 1,
  name: "Company Away",
  description: "The other invented pack.",
  entry: "co-far",
  places: {
    "co-far": spot("The Far Arch", ["co-farther", "co-far-pier"]),
    "co-farther": spot("Farther On", ["co-far"]),
    "co-far-pier": spot("The Far Pier", ["co-far"]),
  },
  avatars: { "co-dee": person("Dee", "co-far") },
  crossings: [
    {
      id: "station-co-far",
      from: "station",
      to: "co-far",
      travelers: "any",
      travel: "through the far door",
      requires: [],
    },
    {
      id: "co-far-station",
      from: "co-far",
      to: "station",
      travelers: "any",
      travel: "through the far door",
      requires: [],
    },
  ],
  choices: [],
  bridge: { id: "shore-co-away", description: "Invented." },
};

export const companyPacks = [home, away].map((pack) =>
  JSON.parse(
    JSON.stringify(pack).replaceAll("assets/PACK/", `assets/${pack.id}/`),
  ),
);
