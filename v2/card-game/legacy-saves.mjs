import { syncStoryQuests } from "./story-quests.mjs";
import { publishQuestCompletions } from "./quest-completions.mjs";
import { installSharedQuestRegistry } from "./shared-quests.mjs";
import { newProgress, questPrograms } from "./quests.mjs";
import {
  migrateMemories,
  newMemories,
  rememberEvent,
  upgradeSightings,
} from "./memory.mjs";
import { installHumanLife, migrateLife } from "./life.mjs";
import { upgradeRecitals } from "./pack-recital.mjs";
import {
  isPackActor,
  packDefinitions,
  transports,
  canonicalPlace,
  localRoadEnds,
  packPlaces,
  choiceText,
} from "./pack-registry.mjs";
import { authoredRouteEdges } from "./roaming-routes.mjs";
import { humanAvatarIds } from "./human-cast.mjs";
import {
  learnLane,
  passengers,
  upgradeTransportState,
} from "./pack-transport.mjs";
import { installKnowledge } from "./knowledge.mjs";
import { newTemperament } from "./pack-rules.mjs";

// Upgrade historical records before the world validates the current save.
// World-owned helpers keep pack installation and generated quests on the same
// path as a new game, while this module owns the schema order.
export function upgradeSave(
  s,
  { actorIds, ensurePrograms, installPacks, profileOf },
) {
  if (s?.schema === 1 && s.actors && typeof s.actors === "object") {
    s.schema = 2;
    for (const actor of Object.values(s.actors)) {
      if (actor && typeof actor === "object") {
        actor.progress = newProgress();
        delete actor.aim;
      }
    }
  }
  if (s?.schema === 2) {
    for (const [id, actor] of Object.entries(s.actors || {})) {
      if (isPackActor(id)) continue;
      const p = actor?.progress,
        programs = questPrograms[id];
      if (
        !programs ||
        !p ||
        !Number.isInteger(p.program) ||
        p.program < 0 ||
        p.program > programs.length ||
        !Number.isInteger(p.step) ||
        p.step < 0 ||
        (p.program === programs.length
          ? p.step !== 0
          : p.step >= programs[p.program].steps.length)
      )
        throw new Error("This save has an invalid quest step.");
    }
    s.schema = 3;
    ensurePrograms(s);
  }
  if (s?.schema === 3) {
    s.schema = 4;
    if (s.eventSeq === undefined && Array.isArray(s.log)) {
      s.log.forEach((entry, index) => {
        entry.seq = index + 1;
      });
      s.eventSeq = s.log.length;
    }
    if (Array.isArray(s.log)) migrateMemories(s);
  }
  if (s?.schema === 4) {
    s.schema = 5;
    s.standoffs = [];
    s.peaceUntil = Object.fromEntries(actorIds.map((id) => [id, 0]));
  }
  if (s?.schema === 5) {
    s.schema = 6;
    s.locations = { attic: { anchored: false }, pond: { answer: null } };
    for (const [id, actor] of Object.entries(s.actors || {}))
      actor.trust = Object.fromEntries(
        actorIds.filter((other) => other !== id).map((other) => [other, 0]),
      );
    const remembered = { ...s, memories: newMemories() };
    for (const entry of s.log || []) rememberEvent(remembered, entry);
    for (const [id, memory] of Object.entries(s.memories || {}))
      memory.landmarks = remembered.memories[id]?.landmarks || [];
  }
  if (s?.schema === 6) {
    // Schema 7 moved the Steam Clock into the world-pack state.
    upgradeSteamClockSave(s);
    upgradeTransportSave(s);
    upgradeGreekSectionSave(s);
    upgradeGreekHomecomingSave(s);
    upgradeGreekRoadSave(s);
    upgradeGreekTownSave(s);
    upgradeGreekAjaxSave(s);
    upgradeGreekOneRoadSave(s);
    s.schema = 7;
    installPacks(s);
  } else if (
    s?.schema === 7 &&
    s.packs &&
    typeof s.packs === "object" &&
    s.crossings &&
    typeof s.crossings === "object"
  ) {
    upgradeTransportSave(s);
    upgradeGreekSectionSave(s);
    upgradeGreekHomecomingSave(s);
    upgradeGreekRoadSave(s);
    upgradeGreekTownSave(s);
    upgradeGreekAjaxSave(s);
    upgradeGreekOneRoadSave(s);
    // A pack mounted after this save was written joins it fresh.
    installPacks(s);
  }
  if (s?.schema === 7) {
    upgradeShoreRouteSave(s);
    upgradeBoardyStationSave(s);
    upgradeHoppyCatSeaSave(s);
    upgradeBoardingSave(s);
    upgradeForestButtonsSave(s);
    upgradeRecitals(s, packDefinitions);
  }
  upgradeSightings(s);
  migrateLife(s, profileOf);
  installHumanLife(s, profileOf);
  if (Object.values(s.life?.actors || {}).some((life) => life.collection))
    installSharedQuestRegistry(s);
  if (s?.schema === 7) publishQuestCompletions(s, syncStoryQuests(s));
  if (s?.schema === 7)
    installKnowledge(
      s,
      undefined,
      packDefinitions.flatMap((pack) =>
        (pack.topics || []).map((topic) => ({ ...topic, packId: pack.id })),
      ),
    );
  return s;
}

// Earlier station links to the attic and carriage pass through the pond.
// Keep just the routes each traveler already knew, and preserve their journal.
// The parlour door returned to the station in BoardyAI revision 2.
export function upgradeShoreRouteSave(s) {
  const moved = new Set(["attic", "train"]);
  for (const [actor, known] of Object.entries(s.routeKnowledge || {})) {
    if (!Array.isArray(known)) continue;
    let changed = false;
    const expanded = known.flatMap((edge) => {
      if (!Array.isArray(edge) || edge.length !== 2) return [edge];
      const [from, to] = edge;
      if (
        (moved.has(from) && to === "station") ||
        (from === "station" && moved.has(to))
      ) {
        changed = true;
        return [
          [from, "pond"],
          ["pond", to],
        ];
      }
      return [edge];
    });
    if (changed)
      s.routeKnowledge[actor] = [
        ...new Map(
          expanded.map((edge) => [JSON.stringify(edge), edge]),
        ).values(),
      ];
  }
}

// BoardyAI revision 2 moves the parlour door from the pond back to the station.
// A card still resting at the pond moves with it; held cards stay held.
export function upgradeBoardyStationSave(s) {
  const pack = packDefinitions.find((p) => p.id === "boardyai");
  const saved = s.packs?.[pack?.id];
  if (!pack || pack.revision < 2 || saved?.revision !== 1) return;
  const card = s.items?.["boardyai-calling-card"];
  if (card?.holder === "pond") card.holder = "station";
  for (const [actor, known] of Object.entries(s.routeKnowledge || {})) {
    if (!Array.isArray(known)) continue;
    s.routeKnowledge[actor] = [
      ...new Map(
        known.map((edge) => {
          if (Array.isArray(edge) && edge.length === 2) {
            if (edge[0] === "pond" && edge[1] === "boardyai-parlour")
              edge = ["station", "boardyai-parlour"];
            else if (edge[0] === "boardyai-parlour" && edge[1] === "pond")
              edge = ["boardyai-parlour", "station"];
          }
          return [JSON.stringify(edge), edge];
        }),
      ).values(),
    ];
  }
  saved.revision = 2;
}

// Hoppy Cat revision 2 is reached by ship from Piraeus to the Signal Jetty.
// The red thread from Black pond is retired: it stays open only in saves that
// already found it, so the crossing record and every learned route are kept.
// Anyone who has been in Hoppy Cat learns the Piraeus lane from that visit.
export function upgradeHoppyCatSeaSave(s) {
  const pack = packDefinitions.find((p) => p.id === "hoppycat-archive");
  const saved = s.packs?.[pack?.id];
  if (!pack || pack.revision < 2 || saved?.revision !== 1) return;
  const home = (place) => Object.hasOwn(pack.places, place);
  const ships = new Set(Object.values(transports).map((t) => t.place));
  const visited = (actor) =>
    home(s.actors[actor]?.place) ||
    (s.log || []).some(
      (e) =>
        e?.actorId === actor && (home(e.locationId) || home(e.fromLocationId)),
    ) ||
    Object.values(s.memories?.[actor]?.seen || {}).some((v) =>
      home(v?.place),
    ) ||
    // A walked route into or out of Hoppy Cat; the new ship berth is no visit.
    (s.routeKnowledge?.[actor] || []).some(
      (edge) =>
        Array.isArray(edge) &&
        edge.some(home) &&
        !edge.some((p) => ships.has(p)),
    );
  for (const actor of Object.keys(s.actors || {}).sort())
    if (!Object.hasOwn(pack.avatars, actor) && visited(actor))
      learnLane(s, actor, "greek-piraeus", "hoppycat-signal-jetty");
  saved.revision = 2;
}

// Revision 5 adds port and road memories. Every earlier position and deed
// remains valid, including a household already waiting at the quay.
export function upgradeGreekRoadSave(s) {
  const pack = packDefinitions.find((p) => p.id === "greek-drama");
  const saved = s.packs?.[pack?.id];
  if (saved?.revision !== 4) return;
  const fresh = newMemories();
  for (const [id, place] of Object.entries(pack.places))
    if (place.road || id === "greek-athens-harbor")
      s.memories[id] ??= fresh[id];
  for (const [actor, known] of Object.entries(s.routeKnowledge || {})) {
    if (!Array.isArray(known)) continue;
    const expanded = known.flatMap((edge) => {
      if (!Array.isArray(edge) || edge.length !== 2) return [edge];
      const [from, to] = edge;
      let path;
      if (from === "greek-harbor" && to === "greek-athens")
        path = [
          from,
          "greek-ship",
          "greek-athens-harbor",
          "greek-road-athens-harbor",
          to,
        ];
      else if (from === "greek-athens" && to === "greek-harbor")
        path = [
          from,
          "greek-road-athens-harbor",
          "greek-athens-harbor",
          "greek-ship",
          to,
        ];
      else if (
        [from, to].includes("greek-harbor") &&
        [from, to].includes("greek-piraeus")
      )
        path = [from, "greek-ship", to];
      else {
        const road = pack.places[from]?.exits.find((id) =>
          pack.places[id]?.road?.includes(to),
        );
        if (road) path = [from, road, to];
      }
      return path ? path.slice(1).map((end, i) => [path[i], end]) : [edge];
    });
    s.routeKnowledge[actor] = [
      ...new Map(expanded.map((edge) => [JSON.stringify(edge), edge])).values(),
    ];
  }
  saved.revision = 5;
}

// Local paths now belong to their town. Preserve the old IDs in memories and
// completed records, and continue current visits and purposes at their ends.
export function upgradeGreekTownSave(s) {
  const saved = s.packs?.["greek-drama"];
  if (saved?.revision !== 5) return;
  foldRetiredRoads(s);
  saved.revision = 6;
}

// Revision 8 joins towns by one road each. Inside a town places link
// directly; between towns there is one road or a sea lane.
// - Attica keeps one road, from Athens to Piraeus. The other Attic roads are
//   retired; Colonus, Marathon and Eleusis are direct visits in their towns.
// - The Theban Harbor Road is the only way between the harbor and Thebes.
// - Distant towns gain purposeful roads (see joinDistantTowns).
// The named rewrites run first; the road fold then turns any other learned
// step that no longer exists into the shortest walkable path.
export function upgradeGreekOneRoadSave(s) {
  const pack = packDefinitions.find((p) => p.id === "greek-drama");
  const saved = s.packs?.[pack?.id];
  if (!pack || pack.revision < 8 || saved?.revision !== 7) return;
  restoreThebanRoad(s, pack);
  joinDistantTowns(s, pack, saved);
  foldRetiredRoads(s);
  saved.revision = 8;
}

// The Theban Harbor Road is again the only way between the harbor and Thebes.
// Known direct steps pass along the road, and an open request for passage
// between the two asks for the road instead.
function restoreThebanRoad(s, pack) {
  const road = "greek-road-thebes";
  const [harbor, town] = pack.places[road].road;
  const direct = (from, to) =>
    (from === harbor && to === town) || (from === town && to === harbor);
  for (const [actor, edges] of Object.entries(s.routeKnowledge || {})) {
    if (!Array.isArray(edges)) continue;
    const paths = edges.flatMap((edge) =>
      Array.isArray(edge) && direct(...edge)
        ? [
            [edge[0], road],
            [road, edge[1]],
          ]
        : [edge],
    );
    s.routeKnowledge[actor] = [
      ...new Map(paths.map((edge) => [JSON.stringify(edge), edge])).values(),
    ];
  }
  for (const quest of Object.values(s.quests?.records || {}))
    if (quest.completedTurn === null && !quest.retired)
      for (const step of quest.program?.steps || []) {
        const passage = step.passage;
        if (passage?.kind === "passage" && direct(passage.from, passage.to))
          passage.to = road;
      }
  for (const state of Object.values(s.roamingQuests || {}))
    if (state.blocked && direct(state.blocked.from, state.blocked.to))
      state.blocked = null;
}

// A known step between two Greek places that no exit or route joins any more
// becomes the shortest walkable path between them.
function walkablePath(from, to) {
  const edges = authoredRouteEdges().filter(
    ([a, b]) => !localRoadEnds(a) && !localRoadEnds(b),
  );
  const queue = [[from]],
    seen = new Set([from]);
  while (queue.length) {
    const path = queue.shift(),
      here = path.at(-1);
    if (here === to) return path;
    for (const [a, b] of edges)
      if (a === here && !seen.has(b)) {
        seen.add(b);
        queue.push([...path, b]);
      }
  }
  return null;
}

// Move saved visits, belongings, knowledge and current purposes off retired
// roads. The road IDs stay in memories and completed records.
export function foldRetiredRoads(s) {
  for (const [id, actor] of Object.entries(s.actors || {})) {
    const ends = localRoadEnds(actor.place);
    if (!ends) continue;
    const count = (place) =>
      humanAvatarIds.filter((human) => s.actors[human]?.place === place).length;
    actor.place =
      humanAvatarIds.includes(id) && count(ends[0]) >= 4 ? ends[1] : ends[0];
  }
  for (const item of Object.values(s.items || {}))
    item.holder = canonicalPlace(item.holder);
  const authored = new Set(
    authoredRouteEdges().map((edge) => JSON.stringify(edge)),
  );
  const greek = (id) => packPlaces[id]?.packId === "greek-drama";
  for (const [actor, edges] of Object.entries(s.routeKnowledge || {})) {
    const paths = edges
      .map(([from, to]) => [canonicalPlace(from), canonicalPlace(to)])
      .filter(([from, to]) => from !== to)
      .flatMap((edge) => {
        if (authored.has(JSON.stringify(edge)) || !edge.every(greek))
          return [edge];
        const path = walkablePath(...edge);
        return path ? path.slice(1).map((end, i) => [path[i], end]) : [];
      });
    s.routeKnowledge[actor] = [
      ...new Map(paths.map((edge) => [JSON.stringify(edge), edge])).values(),
    ];
  }
  const condition = (value) => {
    if (!value) return;
    if (value.place) value.place = canonicalPlace(value.place);
    if (value.at) value.at = [...new Set(value.at.map(canonicalPlace))];
    if (value.condition) condition(value.condition);
  };
  const hand = (value) => {
    if (!value) return;
    if (value.location) value.location = canonicalPlace(value.location);
    for (const option of value.any || []) hand(option);
    for (const test of value.conditions || []) condition(test);
    if (value.passage) {
      value.passage.from = canonicalPlace(value.passage.from);
      value.passage.to = canonicalPlace(value.passage.to);
      if (value.passage.from === value.passage.to) delete value.passage;
    }
  };
  const program = (value) => {
    for (const step of value?.steps || []) hand(step);
  };
  for (const actor of Object.values(s.actors || {}))
    program(actor.progress?.current);
  for (const quest of Object.values(s.quests?.records || {}))
    if (quest.completedTurn === null && !quest.retired) {
      if (quest.holder?.kind === "place")
        quest.holder.id = canonicalPlace(quest.holder.id);
      program(quest.program);
    }
  for (const state of Object.values(s.roamingQuests || {})) {
    if (state.target)
      state.target.locationId = canonicalPlace(state.target.locationId);
    if (
      state.blocked &&
      [state.blocked.from, state.blocked.to].some(localRoadEnds)
    )
      state.blocked = null;
  }
  s.standoffs = (s.standoffs || []).filter(
    (conflict) => !localRoadEnds(conflict.location),
  );
}

// Revision 7 adds the invited Trojan account while earlier journeys retain
// their cast, belongings, access and recorded choices.
export function upgradeGreekAjaxSave(s) {
  const pack = packDefinitions.find((p) => p.id === "greek-drama");
  const saved = s.packs?.[pack?.id];
  if (!pack || pack.revision < 7 || saved?.revision !== 6) return;
  addGreekEntities(
    s,
    pack,
    ["greek-ajax-tecmessa", "greek-ajax-teucer", "greek-ajax-odysseus"],
    [
      "greek-ajax-shield",
      "greek-ajax-plea",
      "greek-ajax-cloth",
      "greek-ajax-tools",
    ],
  );
  const fresh = newMemories();
  for (const id of [
    "greek-ajax-landing",
    "greek-ajax-household",
    "greek-ajax-grave",
  ])
    s.memories[id] ??= fresh[id];
  saved.revision = 7;
}

// In revision 8 distant towns are joined by one road each. Agora and Delphi meet on
// the Sacred Way, Delphi and Trachis on the Oeta Road, Troy and Susa on the
// Royal Road, Thrace and Tauris on the Black Sea Road, and Corinth and Sicily
// on the Colonists' Road. Piraeus no longer reaches Tauris or Sicily, Aulis no
// longer reaches the Greek camp, and the Scythian Crag now joins Tauris.
const GREEK_ROAD_LINKS = {
  "greek-athens|greek-delphi": "greek-road-sacred-way",
  "greek-delphi|greek-trachis": "greek-oeta",
  "greek-susa|greek-troy": "greek-road-royal",
};
const GREEK_CUT_LINKS = new Set([
  "greek-piraeus|greek-tauris",
  "greek-piraeus|greek-sicily",
  "greek-aulis|greek-greek-camp",
  "greek-scythian-crag|greek-susa",
]);
// Without the Trojan invitation the ship does not call at the camp landing.
// A traveler left on that side goes back through the link they came by.
const GREEK_TROJAN_SIDE = {
  "greek-greek-camp": "greek-aulis",
  "greek-troy": "greek-aulis",
  "greek-trojan-camp": "greek-aulis",
  "greek-lemnos": "greek-aulis",
  "greek-thrace": "greek-aulis",
  "greek-susa": "greek-aulis",
  "greek-scythian-crag": "greek-aulis",
  "greek-tauris": "greek-piraeus",
};
function joinDistantTowns(s, pack, saved) {
  const fresh = newMemories();
  for (const id of [
    "greek-road-sacred-way",
    "greek-road-royal",
    "greek-road-black-sea",
    "greek-road-colonists",
  ])
    if (s.memories) s.memories[id] ??= fresh[id];
  for (const [actor, known] of Object.entries(s.routeKnowledge || {})) {
    if (!Array.isArray(known)) continue;
    const paths = known.flatMap((edge) => {
      if (!Array.isArray(edge) || edge.length !== 2) return [edge];
      const [from, to] = edge;
      const key = [from, to].sort().join("|");
      if (GREEK_CUT_LINKS.has(key)) return [];
      const road = GREEK_ROAD_LINKS[key];
      return road
        ? [
            [from, road],
            [road, to],
          ]
        : [edge];
    });
    s.routeKnowledge[actor] = [
      ...new Map(paths.map((edge) => [JSON.stringify(edge), edge])).values(),
    ];
  }
  if (!saved.flags?.["greek-ajax-open"])
    for (const [id, actor] of Object.entries(s.actors || {})) {
      const home = GREEK_TROJAN_SIDE[actor.place];
      if (home && !GREEK_TROJAN_SIDE[pack.avatars[id]?.place])
        actor.place = home;
    }
}

// Revision 3 adds these residents and objects. Earlier records keep their
// custody, memories, receipts, and access scope. Only new IDs are installed.
export function upgradeGreekSectionSave(s) {
  const pack = packDefinitions.find((p) => p.id === "greek-drama");
  const saved = s.packs?.[pack?.id];
  if (!pack || pack.revision < 3 || saved?.revision !== 2) return;
  const avatars = [
    "greek-aethra",
    "greek-adrastus",
    "greek-argive-mother",
    "greek-iphis",
    "greek-theseus",
    "greek-quay-host",
    "greek-colonus-keeper",
    "greek-marathon-keeper",
  ];
  const items = [
    "greek-burial-petition",
    "greek-return-cloths",
    "greek-provision-basket",
    "greek-ash-urn",
    "greek-return-list",
    "greek-grove-cup",
    "greek-grove-honey",
    "greek-shelter-blanket",
    "greek-refuge-tablet",
  ];
  addGreekEntities(s, pack, avatars, items);
  saved.revision = 3;
}

// Revision 4 adds Myrine after the earlier Open Door records are restored.
export function upgradeGreekHomecomingSave(s) {
  const pack = packDefinitions.find((p) => p.id === "greek-drama");
  const saved = s.packs?.[pack?.id];
  if (!pack || pack.revision < 4 || saved?.revision !== 3) return;
  addGreekEntities(s, pack, ["greek-household-witness"], []);
  saved.revision = 4;
}

function addGreekEntities(s, pack, avatars, items) {
  const fresh = newMemories();
  if (
    !s.actors ||
    !s.items ||
    !s.memories ||
    !s.peaceUntil ||
    avatars.some(
      (id) =>
        !pack.avatars[id] ||
        s.actors[id] ||
        s.memories[id] ||
        Object.hasOwn(s.peaceUntil, id) ||
        Object.hasOwn(s.motives?.grievances || {}, id),
    ) ||
    items.some((id) => !pack.items[id] || s.items[id] || s.memories[id]) ||
    Object.values(s.actors).some(
      (actor) =>
        !actor.trust || avatars.some((id) => Object.hasOwn(actor.trust, id)),
    )
  )
    throw new Error(
      "This earlier Greek save needs its original entity records.",
    );
  const actorIds = [...Object.keys(s.actors), ...avatars];
  for (const id of avatars) {
    s.actors[id] = {
      place: pack.avatars[id].place,
      progress: newProgress(),
      crossed: 0,
      lastTalk: -9,
      trust: Object.fromEntries(
        actorIds.filter((other) => other !== id).map((other) => [other, 0]),
      ),
      ...newTemperament(id),
    };
    s.peaceUntil[id] = 0;
    s.memories[id] = fresh[id];
    if (s.motives) s.motives.grievances[id] = [];
  }
  for (const id of items) {
    s.items[id] = { holder: pack.items[id].holder, history: [] };
    s.memories[id] = fresh[id];
  }
  for (const [id, actor] of Object.entries(s.actors))
    for (const other of avatars) if (other !== id) actor.trust[other] ??= 0;
}

// Earlier occupied ships used a null dock. Keep their saved destination and
// restore the departure shore so companions can join the same trip.
function upgradeBoardingSave(s) {
  for (const [id, transport] of Object.entries(transports)) {
    const state = s.transports?.[id];
    if (!state || state.version !== undefined) continue;
    const occupied = passengers(s, id).length > 0;
    const valid =
      Object.keys(state).sort().join() === "destination,dock,recall" &&
      (occupied
        ? state.dock === null &&
          transport.docks.includes(state.destination) &&
          (state.recall === null || transport.docks.includes(state.recall))
        : transport.docks.includes(state.dock) &&
          state.destination === null &&
          state.recall === null);
    if (!valid) throw new Error("This save has an invalid ship record.");
    if (occupied)
      state.dock = transport.docks.find((dock) => dock !== state.destination);
    state.version = 2;
  }
  // Version 3 ships sail lanes and take a world round at sea.
  for (const id of Object.keys(transports)) {
    const state = s.transports?.[id];
    if (state?.version !== 2) continue;
    if (
      Object.keys(state).sort().join() !== "destination,dock,recall,version" ||
      !transports[id].docks.includes(state.dock)
    )
      throw new Error("This save has an invalid ship record.");
    s.transports[id] = upgradeTransportState(s, id, state);
  }
}

// Explicit migrations of historical pre-pack records, never runtime gate rules.
export function upgradeTransportSave(s) {
  const pack = s.packs?.["greek-drama"];
  if (pack?.revision !== 1) return;
  const signal = s.crossings?.["pond-greek-harbor"];
  if (
    signal &&
    (!Number.isInteger(signal.phase) || signal.phase < 0 || signal.phase > 4)
  )
    throw new Error("Invalid legacy lamp signal.");
  if (s.transports?.["greek-ship"] !== undefined)
    throw new Error("Conflicting legacy ship record.");
  s.transports ??= {};
  s.transports["greek-ship"] = {
    dock: signal?.phase === 4 ? "pond" : "greek-harbor",
    destination: null,
    recall: null,
  };
  if (s.memories)
    s.memories["greek-ship"] ??= {
      events: [],
      landmarks: [],
      text: null,
      turn: null,
    };
  pack.revision = 2;
}

export function upgradeSteamClockSave(s) {
  const clock = s.steamClock;
  delete s.steamClock;
  s.crossings ??= {};
  s.packs ??= {};
  if (
    clock !== undefined &&
    (!clock || typeof clock !== "object" || Array.isArray(clock))
  )
    throw new Error("Invalid legacy crossing record.");
  if (clock) {
    s.crossings["pond-clearing"] = {
      discovered: clock.discovered,
      phase: clock.rings,
      until: clock.openUntil ?? 0,
    };
    s.crossings["clearing-pond"] = { discovered: false };
    s.packs["badger-forest"] = {
      revision: 1,
      sounds: { "steam-clock": clock.returnRingingUntil ?? 0 },
    };
    if (s.actors?.badger?.wakeCause === "bell")
      s.actors.badger.wakeCause = "sound";
  }
  const old = s.packs["greek-drama"];
  if (old !== undefined) {
    const allowed = ["revision", "choices", "flags", "receipts", "met"],
      current = [...allowed, "sounds", "scope"];
    const keys =
      old && typeof old === "object" ? Object.keys(old).sort().join() : "";
    if (
      keys === current.sort().join() ||
      keys === [...current, "recitals"].sort().join()
    ) {
      if (s.locations?.pond?.shipSignal !== undefined)
        throw new Error("Conflicting legacy lamp signal.");
      return;
    }
    if (
      !old ||
      typeof old !== "object" ||
      Array.isArray(old) ||
      keys !== allowed.sort().join()
    )
      throw new Error("Invalid legacy Greek pack record.");
    old.sounds = {};
    old.scope = "full";
    const phase = s.locations?.pond?.shipSignal ?? 0;
    if (!Number.isInteger(phase) || phase < 0 || phase > 4)
      throw new Error("Invalid legacy lamp signal.");
    const discovered =
      phase === 4 ||
      Object.keys(old.met || {}).length > 0 ||
      String(s.actors?.vale?.place).startsWith("greek-");
    s.crossings["pond-greek-harbor"] = { discovered, phase, until: 0 };
    s.crossings["greek-harbor-pond"] = { discovered: false };
  }
  if (s.locations?.pond) delete s.locations.pond.shipSignal;
}

// Lonely Forest revision 2 replaces the shared Story Button with one button
// per traveler. The Story Button, the Dewbright Button and the Watch Bell
// leave the world, with the choices and story card that needed them. A Watch
// Bell set beside Skull becomes the pawprint watch it stood for.
const FOREST_RETIRED_ITEMS = [
  "forest-story-button",
  "forest-dewbright-button",
  "forest-watch-bell",
];
const FOREST_RETIRED_CHOICES = ["forest-mend-scarf", "forest-share-symbols"];
const FOREST_RETIRED_FLAGS = ["forest-scarf-mended", "forest-symbols-shared"];
export function upgradeForestButtonsSave(s) {
  const pack = packDefinitions.find((p) => p.id === "lonely-forest");
  const saved = s.packs?.[pack?.id];
  if (!pack || pack.revision < 2 || saved?.revision !== 1) return;
  const retired = new Set(FOREST_RETIRED_ITEMS);
  for (const id of FOREST_RETIRED_ITEMS) {
    delete s.items?.[id];
    delete s.memories?.[id];
  }
  const fresh = newMemories();
  for (const [id, item] of Object.entries(pack.items)) {
    if (s.items[id]) continue;
    s.items[id] = { holder: item.holder, history: [] };
    s.memories[id] ??= fresh[id];
  }
  const bell = "forest-set-watch-bell",
    tracks = "forest-mark-pawprints";
  if (Object.hasOwn(saved.receipts, bell)) {
    saved.receipts[tracks] = saved.receipts[bell];
    delete saved.receipts[bell];
    if (saved.choices["forest-watch-style"] === "bell")
      saved.choices["forest-watch-style"] = "tracks";
    if (saved.recitals?.[bell]) {
      saved.recitals[tracks] = saved.recitals[bell];
      delete saved.recitals[bell];
    }
  }
  for (const id of FOREST_RETIRED_CHOICES) {
    delete saved.receipts[id];
    if (saved.recitals) delete saved.recitals[id];
  }
  for (const key of FOREST_RETIRED_FLAGS) delete saved.flags[key];
  // The journal keeps every deed that still names a living thing.
  s.log = (s.log || []).flatMap((entry) => {
    if (
      (entry.packId === pack.id &&
        FOREST_RETIRED_CHOICES.includes(entry.choiceId)) ||
      retired.has(entry.itemId) ||
      retired.has(entry.receiveId) ||
      /forest-(story|dewbright)-button|forest-watch-bell/.test(
        JSON.stringify([entry.questPlan, entry.program, entry.target]),
      )
    )
      return [];
    const next = { ...entry };
    if (next.packId === pack.id && next.choiceId === bell) {
      next.choiceId = tracks;
      next.text = choiceText(
        pack.choices.find((c) => c.id === tracks),
        next.actorId,
      );
    }
    if (retired.has(next.entityId)) delete next.entityId;
    if (retired.has(next.targetId)) delete next.targetId;
    if (Array.isArray(next.items))
      next.items = next.items.filter(
        (item) => !retired.has(item?.id) && !retired.has(item?.holder),
      );
    if (next.witnesses)
      next.witnesses = next.witnesses.filter((id) => !retired.has(id));
    return [next];
  });
  // Experiences and hopes keep their moment without the retired thing.
  const forget = (value) => {
    if (Array.isArray(value)) value.forEach(forget);
    else if (value && typeof value === "object") {
      if (retired.has(value.item)) value.item = null;
      Object.values(value).forEach(forget);
    }
  };
  for (const life of Object.values(s.life?.actors || {})) {
    for (const id of FOREST_RETIRED_ITEMS) delete life.attachments?.[id];
    forget(life);
  }
  const quests = s.quests;
  if (quests?.records) {
    const named = /forest-(story|dewbright)-button|forest-watch-bell/;
    const dropped = Object.values(quests.records)
      .filter(
        (q) =>
          q.key === "lonely-forest:story-quest-forest-hearth" ||
          (q.mode === "personal" && named.test(JSON.stringify(q.program))),
      )
      .map((q) => q.key);
    for (const key of dropped) {
      delete quests.records[key];
      for (const [actor, focused] of Object.entries(quests.focus || {}))
        if (focused === key) delete quests.focus[actor];
      for (const hand of Object.values(quests.hands || {}))
        if (Array.isArray(hand) && hand.includes(key))
          hand.splice(hand.indexOf(key), 1);
      for (const [actor, life] of Object.entries(s.life?.actors || {})) {
        const c = life.collection;
        if (!c) continue;
        c.cards = c.cards.filter((card) => card !== key);
        c.archive = c.archive.filter((card) => card !== key);
        if (c.active === key) {
          c.active = null;
          s.actors[actor].progress.step = 0;
        }
      }
    }
    for (const q of Object.values(quests.records)) forget(q.origin);
    const path = quests.records["lonely-forest:story-quest-forest-path"];
    if (path) {
      path.program.art = "forest-garden";
      if (path.completedTurn !== null) {
        const ending = ["forest-clear-drain", "forest-set-stones"].find((id) =>
          Object.hasOwn(saved.receipts, id),
        );
        path.completedTurn = saved.receipts[ending];
      }
    }
  }
  saved.revision = 2;
}
