import { newMemories, upgradeSightings } from "./memory.mjs";
import { migrateLife } from "./life.mjs";
import { upgradeRecitals } from "./pack-recital.mjs";
import {
  packDefinitions,
  transports,
  canonicalPlace,
  localRoadEnds,
  retiredPlace,
  packPlaces,
  choiceText,
  conditionsMet,
  departed,
  entityEnabled,
  packEntity,
} from "./pack-registry.mjs";
import { sectionAllows } from "./pack-sections.mjs";
import { authoredRouteEdges } from "./roaming-routes.mjs";
import { humanAvatarIds } from "./human-cast.mjs";
import {
  laneEdges,
  laneOfEdge,
  learnLane,
  passengers,
  upgradeTransportState,
} from "./pack-transport.mjs";
import { installKnowledge } from "./knowledge.mjs";
import { newTemperament } from "./pack-rules.mjs";
import forest from "./forest.json" with { type: "json" };

// The quest machinery was replaced by one want per avatar. Its saved records
// are dropped; each avatar's want is installed again from authored data.
const QUEST_FIELDS = [
  "quests",
  "questCompletions",
  "roamingQuests",
  "introductionVisits",
  "storyQuests",
];
const QUEST_VERBS = ["drop-quest", "join-quest", "share-quest", "pursue"];
export function forgetQuests(s) {
  for (const field of QUEST_FIELDS) delete s[field];
  for (const actor of Object.values(s.actors || {})) delete actor.progress;
  if (s.motives) delete s.motives.questPrograms;
  if (Array.isArray(s.log))
    s.log = s.log
      .filter((e) => e?.kind !== "quest" && !QUEST_VERBS.includes(e?.verb))
      .map(({ questPlan, consequence, questKey, ...e }) => e);
  migrateLife(s);
}

// Upgrade historical records before the world validates the current save.
// World-owned helpers keep pack installation on the same path as a new game,
// while this module owns the schema order. Saves before schema 6 come from
// the first alpha tables and start fresh.
export function upgradeSave(s, { installPacks, laneText = () => null }) {
  if (!s || ![6, 7].includes(s.schema))
    throw new Error("This save needs a fresh start.");
  // Packs saved at an earlier revision follow their reworked story below.
  const reworked = new Set(
    packDefinitions
      .filter((p) => (s.packs?.[p.id]?.revision ?? p.revision) < p.revision)
      .map((p) => p.id),
  );
  forgetQuests(s);
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
    upgradeGreekPassSave(s);
    upgradeGreekShipSignalSave(s);
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
    upgradeGreekPassSave(s);
    upgradeGreekShipSignalSave(s);
    // A pack mounted after this save was written joins it fresh.
    installPacks(s);
  }
  if (s?.schema === 7) {
    // One flask now fills one empty lamp and returns full; the pond no longer
    // answers the bell with oil.
    if (s.items?.oil) delete s.items.oil.doses;
    if (s.locations?.pond?.answer === "call") s.locations.pond.answer = null;
    for (const entry of Array.isArray(s.log) ? s.log : [])
      if (entry?.verb === "refill") entry.verb = "refuel";
    // An open standoff gains who has stood down; nobody has yet.
    for (const c of Array.isArray(s.standoffs) ? s.standoffs : [])
      if (c && !c.steppedBack && c.challenger && c.defender)
        c.steppedBack = { [c.challenger]: false, [c.defender]: false };
    upgradeShoreRouteSave(s);
    upgradeBoardyStationSave(s);
    upgradeHoppyCatSeaSave(s);
    upgradeHoppyCatInteriorsSave(s);
    upgradeBoardingSave(s);
    upgradeForestButtonsSave(s);
    upgradeForestRevisionSave(s);
    upgradeWillowsKitSave(s);
    upgradeGreekThebesSave(s);
    upgradeGreekDistrictSave(s);
    upgradeGreekCithaeronSave(s);
    upgradeGreekDistrictRoadsSave(s);
    upgradeGreekOpenDoorSave(s);
    upgradeGreekEastSeaSave(s);
    upgradeGreekThreeLinksSave(s);
    upgradeRecitals(s, packDefinitions);
  }
  upgradeSightings(s);
  installPacks(s);
  reconcileContent(s);
  reconcilePackProgress(s, reworked);
  // A told lane keeps its id; its words follow the lane's current conditions.
  // A lane the ship no longer sails is forgotten (Greek revision 16).
  for (const [id, fact] of Object.entries(s?.knowledge?.facts || {})) {
    if (fact?.source?.kind !== "lane") continue;
    const text = laneText(id);
    if (text) fact.text = text;
    else if (reworked.size) forgetFact(s.knowledge, id);
  }
  reconcileTopics(s, reworked);
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

// A loaded save follows the current content. A retired crossing closes even
// where the save had found it, every authored thing is present, and a thing
// the content no longer defines leaves the world: whatever it held stays
// with whoever, or wherever, held it.
export function reconcileContent(s) {
  if (!s?.items || typeof s.items !== "object") return;
  for (const pack of packDefinitions)
    for (const c of pack.crossings)
      if (c.retired && s.crossings?.[c.id])
        s.crossings[c.id].discovered = false;
  const authored = structuredClone(forest.initialState.items);
  for (const pack of packDefinitions)
    for (const [id, item] of Object.entries(pack.items || {}))
      authored[id] ??= { holder: item.holder, history: [] };
  const fresh = newMemories();
  for (const [id, item] of Object.entries(authored))
    if (!Object.hasOwn(s.items, id)) {
      s.items[id] = item;
      if (s.memories) s.memories[id] ??= fresh[id];
    }
  const root = (id) => {
    let holder = s.items[id]?.holder;
    const seen = new Set([id]);
    while (s.items[holder] && !seen.has(holder)) {
      seen.add(holder);
      holder = s.items[holder].holder;
    }
    return holder;
  };
  const gone = Object.keys(s.items).filter(
    (id) => !Object.hasOwn(authored, id),
  );
  for (const id of gone) {
    const keeper = root(id);
    for (const item of Object.values(s.items))
      if (item?.holder === id) item.holder = keeper;
    delete s.items[id];
    if (s.memories) delete s.memories[id];
  }
  forgetRetiredThings(s, new Set(gone));
}

// A story step the content no longer leads to leaves a save from an earlier
// pack revision; a save at the current revision is checked as it stands.
// Receipts
// replay in order, as validation reads them; a step whose prerequisites
// are no longer met leaves with its log line and recital, and the pack's
// flags and choices are counted again from the steps that stay. Whoever and
// whatever those flags held back goes home, and anyone standing in a place
// they closed returns to the pack's entry. Greek revision 11 retired the
// Theban refusal, which had opened the Open Door, so a world that went on to
// Athens asked for a fresh start (2026-11-01).
export function reconcilePackProgress(s, reworked) {
  for (const pack of packDefinitions) {
    const state = s.packs?.[pack.id];
    if (
      !reworked.has(pack.id) ||
      !pack.choices ||
      !state?.receipts ||
      !state.flags ||
      !state.choices
    )
      continue;
    const kept = {},
      choices = {},
      flags = {};
    const projection = {
      ...s,
      packs: { ...s.packs, [pack.id]: { ...state, choices, flags } },
    };
    const holds = (requires = []) =>
      conditionsMet(
        projection,
        pack.id,
        requires.filter((c) =>
          ["choice", "choice_unset", "flag"].includes(c.kind),
        ),
      );
    const receipts = Object.entries(state.receipts).sort((a, b) => a[1] - b[1]);
    for (const [id, turn] of receipts) {
      const c = pack.choices.find((choice) => choice.id === id);
      if (
        !c ||
        !holds(c.requires) ||
        !holds(pack.places[c.at]?.requires) ||
        !holds(packEntity(c.subject)?.requires) ||
        !sectionAllows(projection, pack, c.at, conditionsMet) ||
        !sectionAllows(projection, pack, c.subject, conditionsMet) ||
        c.effects.some(
          (e) => e.kind === "choose" && Object.hasOwn(choices, e.key),
        )
      )
        continue;
      kept[id] = turn;
      for (const e of c.effects) {
        if (e.kind === "choose") choices[e.key] = e.value;
        if (e.kind === "set_flag") flags[e.key] = e.value;
      }
    }
    // Only what a dropped step set leaves; any other record stays as saved
    // and is checked as it stands.
    const dropped = receipts.map(([id]) => id).filter((id) => !kept[id]);
    for (const id of dropped) {
      delete state.receipts[id];
      delete state.recitals?.[id];
      for (const e of pack.choices.find((c) => c.id === id)?.effects || []) {
        const record = { choose: state.choices, set_flag: state.flags }[e.kind];
        const now = e.kind === "choose" ? choices : flags;
        if (record && !Object.hasOwn(now, e.key)) delete record[e.key];
      }
    }
    if (dropped.length)
      s.log = (s.log || []).filter(
        (e) => !(e?.packId === pack.id && dropped.includes(e.choiceId)),
      );
    // Valid saves already meet everything below; a reworked pack may not.
    for (const [id, avatar] of Object.entries(pack.avatars || {})) {
      const a = s.actors?.[id];
      // A journey not yet agreed starts from its first step.
      if (a && avatar.journey && !kept[avatar.journey.after])
        a.place = avatar.journey.path[0];
      if (!a || entityEnabled(s, id, true) || departed(pack, state, id))
        continue;
      delete state.met[id];
      if (a.place !== avatar.place && !avatar.previousHomes?.includes(a.place))
        a.place = avatar.place;
      Object.assign(a, { crossed: 0, lastTalk: -9 });
      s.standoffs = (s.standoffs || []).filter(
        (c) => c?.challenger !== id && c?.defender !== id,
      );
    }
    for (const [id, item] of Object.entries(pack.items || {}))
      if (s.items?.[id] && !entityEnabled(s, id, true)) {
        for (const other of Object.values(s.items))
          if (other?.holder === id) other.holder = s.items[id].holder;
        Object.assign(s.items[id], { holder: item.holder, history: [] });
      }
    const closed = (id) =>
      packEntity(id)?.packId === pack.id && !entityEnabled(s, id, true);
    for (const [id, item] of Object.entries(s.items || {}))
      if (closed(item?.holder) && entityEnabled(s, id, true))
        item.holder = pack.entry;
    for (const [id, a] of Object.entries(s.actors || {}))
      if (
        packEntity(a?.place)?.packId === pack.id &&
        !entityEnabled(s, a.place, true) &&
        entityEnabled(s, id, true)
      )
        a.place = pack.entry;
  }
}

// A told topic of a reworked pack follows its current words and choice. One
// the content retired, or gave another teller or place, is forgotten
// (#1747 reworded Oak's night watch; Greek revision 15 retired a report).
export function reconcileTopics(s, reworked) {
  const k = s?.knowledge;
  if (!k?.facts || typeof k.facts !== "object") return;
  const topics = new Map(
    packDefinitions.flatMap((pack) =>
      (pack.topics || []).map((t) => [`${pack.id}:${t.id}`, t]),
    ),
  );
  for (const [id, fact] of Object.entries(k.facts)) {
    const told = fact?.source?.kind === "topic" && fact.source.topic;
    if (!told || !reworked.has(told.packId)) continue;
    const topic = topics.get(`${told.packId}:${told.id}`);
    if (
      topic?.id === id &&
      topic.speaker === fact.source.actorId &&
      topic.at === fact.source.locationId
    ) {
      fact.text = topic.text;
      told.choiceId = topic.choiceId ?? null;
      continue;
    }
    forgetFact(k, id);
  }
}
function forgetFact(k, id) {
  delete k.facts[id];
  for (const known of Object.values(k.known || {})) delete known?.[id];
  if (Array.isArray(k.pending))
    k.pending = k.pending.filter((p) => p?.factId !== id);
}

// The journal keeps every moment that still names a living thing. A deed done
// with a retired thing leaves, with what anyone learned from it; a moment it
// only witnessed keeps the others.
export function forgetRetiredThings(s, retired) {
  if (!retired.size) return;
  const names = (lesson) =>
    [
      lesson?.item,
      lesson?.goal?.item,
      lesson?.action?.item,
      lesson?.action?.receive,
    ].some((id) => retired.has(id));
  for (const memory of Object.values(s.memories || {}))
    if (Array.isArray(memory?.learning))
      memory.learning = memory.learning.filter((lesson) => !names(lesson));
  // A keepsake's attachment leaves with it; an experience keeps its moment.
  for (const life of Object.values(s.life?.actors || {})) {
    for (const id of retired) delete life?.attachments?.[id];
    for (const e of Array.isArray(life?.experiences) ? life.experiences : [])
      if (retired.has(e?.item)) e.item = null;
  }
  for (const c of Array.isArray(s.standoffs) ? s.standoffs : [])
    if (retired.has(c?.item)) c.item = null;
  // A wish for a retired thing is let go; the rest of the stack stays.
  for (const a of Object.values(s.actors || {})) {
    const quests = [a?.want, ...(a?.under || [])].filter(Boolean);
    const kept = quests.filter(
      (w) => !(w.kind === "item" && retired.has(w.target)),
    );
    if (kept.length === quests.length) continue;
    a.want = kept[0] ?? null;
    if (kept.length > 1) a.under = kept.slice(1);
    else delete a.under;
  }
  if (!Array.isArray(s.log)) return;
  s.log = s.log.flatMap((entry) => {
    if (
      !entry ||
      retired.has(entry.itemId) ||
      retired.has(entry.receiveId) ||
      retired.has(entry.wantMet?.target)
    )
      return entry ? [] : [entry];
    const next = { ...entry };
    if (retired.has(next.entityId)) delete next.entityId;
    if (retired.has(next.targetId)) delete next.targetId;
    if (Array.isArray(next.witnesses))
      next.witnesses = next.witnesses.filter((id) => !retired.has(id));
    if (Array.isArray(next.items))
      next.items = next.items.filter(
        (item) => !retired.has(item?.id) && !retired.has(item?.holder),
      );
    if (Array.isArray(next.droppedItemIds))
      next.droppedItemIds = next.droppedItemIds.filter(
        (id) => !retired.has(id),
      );
    return [next];
  });
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

// Hoppy Cat revision 3 puts each drawn place within the Tea Garden or the
// Signal Jetty. A known step between two archive places that no longer
// exists becomes the walk through their parents.
export function upgradeHoppyCatInteriorsSave(s) {
  const pack = packDefinitions.find((p) => p.id === "hoppycat-archive");
  const saved = s.packs?.[pack?.id];
  if (!pack || pack.revision < 3 || saved?.revision !== 2) return;
  const authored = new Set(authoredRouteEdges().map((e) => JSON.stringify(e)));
  for (const [actor, edges] of Object.entries(s.routeKnowledge || {})) {
    const paths = edges.flatMap((edge) => {
      if (
        authored.has(JSON.stringify(edge)) ||
        !edge.every((id) => Object.hasOwn(pack.places, id))
      )
        return [edge];
      const path = walkablePath(...edge);
      return path ? path.slice(1).map((end, i) => [path[i], end]) : [];
    });
    s.routeKnowledge[actor] = [
      ...new Map(paths.map((edge) => [JSON.stringify(edge), edge])).values(),
    ];
  }
  saved.revision = 3;
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

// Revision 10 calls the ship with one cover and uncover instead of two. A
// saved phase past the new steps, or one that would now read as complete
// without a found ship, starts the signal again.
export function upgradeGreekShipSignalSave(s) {
  const pack = packDefinitions.find((p) => p.id === "greek-drama");
  const saved = s.packs?.[pack?.id];
  if (!pack || pack.revision < 10 || saved?.revision !== 9) return;
  const state = s.crossings?.["pond-greek-harbor"];
  if (state && (state.phase > 2 || (state.phase === 2 && !state.discovered)))
    state.phase = 0;
  saved.revision = 10;
}

// Revision 17 gives every Theban place at most three links: the sanctuary
// is reached through the palace. A known step that no longer exists becomes
// the walk that replaced it.
export function upgradeGreekThreeLinksSave(s) {
  const pack = packDefinitions.find((p) => p.id === "greek-drama");
  const saved = s.packs?.[pack?.id];
  if (!pack || pack.revision < 17 || saved?.revision !== 16) return;
  foldRetiredRoads(s);
  saved.revision = 17;
}

// Revision 14 sorts Athens into districts joined by gate roads. A known step
// between districts becomes a walkable path through the gates.
export function upgradeGreekDistrictRoadsSave(s) {
  const pack = packDefinitions.find((p) => p.id === "greek-drama");
  const saved = s.packs?.[pack?.id];
  if (!pack || pack.revision < 14 || saved?.revision !== 13) return;
  foldRetiredRoads(s);
  saved.revision = 14;
}

// Revision 13 makes Cithaeron the road from the battlefield to Eleusis. A
// known step to the old slopes from the sanctuary becomes a walkable path.
export function upgradeGreekCithaeronSave(s) {
  const pack = packDefinitions.find((p) => p.id === "greek-drama");
  const saved = s.packs?.[pack?.id];
  if (!pack || pack.revision < 13 || saved?.revision !== 12) return;
  foldRetiredRoads(s);
  saved.revision = 13;
}

// Revision 12 retires Athenian places. Anyone or anything there, or a ship
// berthed or bound there, continues at the place that took it in.
export function upgradeGreekDistrictSave(s) {
  const pack = packDefinitions.find((p) => p.id === "greek-drama");
  const saved = s.packs?.[pack?.id];
  if (!pack || pack.revision < 12 || saved?.revision !== 11) return;
  for (const [id, state] of Object.entries(s.transports || {})) {
    if (![state?.dock, state?.destination, state?.recall].some(retiredPlace))
      continue;
    const dock = canonicalPlace(state.destination || state.dock);
    s.transports[id] = upgradeTransportState(s, id, {
      ...state,
      dock,
      destination: dock,
      recall: state.recall && canonicalPlace(state.recall),
    });
  }
  foldRetiredRoads(s);
  saved.revision = 12;
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
}

// A known step between two Greek places that no exit or route joins any more
// becomes the shortest walkable path between them.
function walkablePath(from, to) {
  const edges = authoredRouteEdges().filter(
    ([a, b]) => canonicalPlace(a) === a && canonicalPlace(b) === b,
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
// roads and places. Their IDs stay in memories and completed records.
export function foldRetiredRoads(s) {
  // Retired places first, so a traveler on a road sees who is already there.
  for (const actor of Object.values(s.actors || {}))
    for (const field of ["place", "home"])
      if (retiredPlace(actor[field]))
        actor[field] = canonicalPlace(actor[field]);
  for (const [id, actor] of Object.entries(s.actors || {})) {
    const ends = localRoadEnds(actor.place)?.map(canonicalPlace);
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
      // A lane or crossing from a retired port is forgotten.
      .filter(
        (edge) =>
          !(laneOfEdge(edge) || []).some(retiredPlace) &&
          !(edge.some(retiredPlace) && !edge.every(greek)),
      )
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
  for (const actor of Object.values(s.actors || {})) {
    for (const want of [actor.want, ...(actor.under || [])])
      if (want?.kind === "place") want.target = canonicalPlace(want.target);
    if (Array.isArray(actor.visited))
      actor.visited = [...new Set(actor.visited.map(canonicalPlace))];
  }
  s.standoffs = (s.standoffs || []).filter(
    (conflict) => canonicalPlace(conflict.location) === conflict.location,
  );
}

// Revision 9 adds the Suppliant’s Olive Branch, which opens the lane
// between Piraeus and Athens Harbor while it is aboard.
export function upgradeGreekPassSave(s) {
  const pack = packDefinitions.find((p) => p.id === "greek-drama");
  const saved = s.packs?.[pack?.id];
  if (!pack || pack.revision < 9 || saved?.revision !== 8) return;
  const id = "greek-olive-branch";
  s.items[id] ??= { holder: pack.items[id].holder, history: [] };
  s.memories[id] ??= newMemories()[id];
  saved.revision = 9;
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
  saved.revision = 2;
}

// Lonely Forest revision 3 retires the story buttons and their fork keys.
// Each retired fork's deed passes to the step that took it in: setting the
// stones becomes clearing the drain, and telling Oak of the path becomes
// telling of the hearth. Both share their step's place, subject and flag.
const FOREST_FORKS = {
  "forest-set-stones": "forest-clear-drain",
  "forest-tell-path": "forest-tell-hearth",
};
export function upgradeForestRevisionSave(s) {
  const pack = packDefinitions.find((p) => p.id === "lonely-forest");
  const saved = s.packs?.[pack?.id];
  if (!pack || pack.revision < 3 || saved?.revision !== 2) return;
  const renamed = {};
  for (const [was, now] of Object.entries(FOREST_FORKS)) {
    const turn = saved.receipts?.[was];
    if (turn === undefined) continue;
    delete saved.receipts[was];
    if (saved.recitals) {
      if (saved.recitals[was] && !Object.hasOwn(saved.receipts, now))
        saved.recitals[now] ??= saved.recitals[was];
      delete saved.recitals[was];
    }
    if (Object.hasOwn(saved.receipts, now)) continue;
    saved.receipts[now] = turn;
    renamed[was] = now;
  }
  s.log = (s.log || []).flatMap((entry) => {
    if (
      entry?.packId !== pack.id ||
      !Object.hasOwn(FOREST_FORKS, entry.choiceId)
    )
      return [entry];
    const now = renamed[entry.choiceId];
    if (!now) return [];
    return [
      {
        ...entry,
        choiceId: now,
        text: choiceText(
          pack.choices.find((c) => c.id === now),
          entry.actorId,
        ),
      },
    ];
  });
  saved.choices = {};
  saved.revision = 3;
}

// Willows revision 2 drops the gear chain, ending, otter and boatman and
// moves unmoved kit. The thicket stays the road between camp and bank.
const WILLOWS_RETIRED_CHOICES = [
  "willows-prepare-canoe",
  "willows-set-paddle",
  "willows-choose-departure",
  "willows-choose-watch",
  "willows-watch-otter",
  "willows-watch-boatman",
];
const WILLOWS_KIT_WAS = {
  "willows-paddle": "willows-landing",
  "willows-sheet": "willows-camp",
  "willows-rope": "willows-camp",
  "willows-provisions": "willows-camp",
};
export function upgradeWillowsKitSave(s) {
  const pack = packDefinitions.find((p) => p.id === "willows");
  const saved = s.packs?.[pack?.id];
  if (!pack || pack.revision < 2 || saved?.revision !== 1) return;
  for (const id of WILLOWS_RETIRED_CHOICES) {
    delete saved.receipts[id];
    if (saved.recitals) delete saved.recitals[id];
  }
  for (const flag of ["gear-laid", "paddle-laid", "otter-seen", "boatman-seen"])
    delete saved.flags[`willows-${flag}`];
  delete saved.choices["willows-response"];
  s.log = (s.log || []).filter(
    (e) =>
      !(e.packId === pack.id && WILLOWS_RETIRED_CHOICES.includes(e.choiceId)),
  );
  for (const [id, was] of Object.entries(WILLOWS_KIT_WAS))
    if (s.items[id]?.holder === was) s.items[id].holder = pack.items[id].holder;
  saved.revision = 2;
}

// Greek revision 11 sets the Market Well within the courtyard and retires the
// Theban story buttons. Known steps the map lost become walkable paths; the
// refusal branch and the invitation receipts leave the save. A refusal save
// that went on to Athens loses the steps the refusal opened in
// reconcilePackProgress.
const THEBAN_RETIRED_CHOICES = [
  "prepare-permitted-burial",
  "decline-burial",
  "courtyard-refusal",
  "open-door-invite-burial",
  "open-door-invite-concession",
  "open-door-invite-refusal",
  "open-door-invite-exposure",
].map((id) => `greek-${id}`);
export function upgradeGreekThebesSave(s) {
  const pack = packDefinitions.find((p) => p.id === "greek-drama");
  const saved = s.packs?.[pack?.id];
  if (!pack || pack.revision < 11 || saved?.revision !== 10) return;
  foldRetiredRoads(s);
  for (const id of THEBAN_RETIRED_CHOICES) {
    delete saved.receipts[id];
    if (saved.recitals) delete saved.recitals[id];
  }
  if (saved.choices["greek-theban-response"] === "refusal") {
    delete saved.choices["greek-theban-response"];
    delete saved.flags["greek-refusal-public"];
    delete saved.flags["greek-open-door-open"];
  }
  // Dione's road now opens with the public account itself.
  if (
    ["burial", "concession", "exposure"].some((b) =>
      Object.hasOwn(saved.receipts, `greek-courtyard-${b}`),
    )
  )
    saved.flags["greek-open-door-open"] = true;
  s.log = (s.log || []).filter(
    (e) =>
      !(e.packId === pack.id && THEBAN_RETIRED_CHOICES.includes(e.choiceId)),
  );
  // Meeting the guard now tells the decree, so its account no longer names a
  // Talk choice. A told account follows its topic's current choice (#1755).
  for (const fact of Object.values(s.knowledge?.facts || {})) {
    const told = fact?.source?.kind === "topic" && fact.source.topic;
    const topic =
      told?.packId === pack.id &&
      (pack.topics || []).find((t) => t.id === told.id);
    if (topic) told.choiceId = topic.choiceId ?? null;
  }
  saved.revision = 11;
}

// Greek revision 15 retires the Open Door and homecoming story buttons. The
// steps that stay keep their receipts; a retired fork's receipt passes to the
// step that took it in, or leaves with its log line and its told topic. The
// reading at Dione's table is now the gift of the signed list. The story's
// flags and account choices are then counted again from its receipts.
const OPEN_DOOR_RETIRED = {
  "open-door-request-truce": null,
  "open-door-request-recovery": null,
  "open-door-hear-recovery-report": "open-door-hear-truce-report",
  "open-door-eleusis-pledge": null,
  "open-door-eleusis-care": null,
  "open-door-open-berth": "open-door-family-berth",
  "open-door-colonus-family": "open-door-colonus-custom",
  "open-door-marathon-alcmene": null,
  "open-door-marathon-hearing": null,
  "homecoming-report-agora-force": "homecoming-report-agora-truce",
  "homecoming-report-eleusis-care": "homecoming-report-eleusis-pledge",
  "homecoming-report-piraeus-family": null,
  "homecoming-report-piraeus-open": null,
  "homecoming-report-colonus-family": "homecoming-report-colonus-custom",
  "homecoming-report-marathon-hearing": "homecoming-report-marathon-alcmene",
  "homecoming-receive-open": "homecoming-receive-family",
  "homecoming-read-basket-family": "homecoming-report-piraeus-family",
  "homecoming-read-berth-family": "homecoming-report-piraeus-family",
  "homecoming-read-basket-open": "homecoming-report-piraeus-family",
  "homecoming-read-berth-open": "homecoming-report-piraeus-family",
};
export function upgradeGreekOpenDoorSave(s) {
  const pack = packDefinitions.find((p) => p.id === "greek-drama");
  const saved = s.packs?.[pack?.id];
  if (!pack || pack.revision < 15 || saved?.revision !== 14) return;
  const renamed = {};
  for (const [old, next] of Object.entries(OPEN_DOOR_RETIRED)) {
    const was = `greek-${old}`,
      now = next && `greek-${next}`;
    const turn = saved.receipts[was];
    delete saved.receipts[was];
    if (turn === undefined || !now || Object.hasOwn(saved.receipts, now))
      continue;
    saved.receipts[now] = turn;
    renamed[was] = now;
    if (saved.recitals?.[was]) saved.recitals[now] ??= saved.recitals[was];
  }
  const retired = Object.keys(OPEN_DOOR_RETIRED).map((id) => `greek-${id}`);
  if (saved.recitals) {
    for (const id of retired) delete saved.recitals[id];
    for (const v of pack.recital.verses)
      if (Object.hasOwn(saved.receipts, v.choice))
        saved.recitals[v.choice] ??= { actor: null, visit: null };
  }
  s.log = (s.log || []).flatMap((e) =>
    e?.packId !== pack.id || !retired.includes(e.choiceId)
      ? [e]
      : renamed[e.choiceId]
        ? [{ ...e, choiceId: renamed[e.choiceId] }]
        : [],
  );
  const story = (key) => /^greek-(open-door|homecoming)-/.test(key);
  for (const record of [saved.choices, saved.flags])
    for (const key of Object.keys(record)) if (story(key)) delete record[key];
  for (const [id] of Object.entries(saved.receipts).sort((a, b) => a[1] - b[1]))
    for (const e of pack.choices.find((c) => c.id === id)?.effects || []) {
      if (!story(e.key)) continue;
      if (e.kind === "choose") saved.choices[e.key] ??= e.value;
      if (e.kind === "set_flag") saved.flags[e.key] = e.value;
    }
  // The recovery report's topic is gone; whoever knew it forgets it.
  const k = s.knowledge,
    topic = "greek-open-door-hear-recovery-report";
  if (k?.facts?.[topic]) {
    delete k.facts[topic];
    for (const known of Object.values(k.known || {})) delete known[topic];
    k.pending = (k.pending || []).filter((p) => p.factId !== topic);
  }
  saved.revision = 15;
}

// Greek revision 16 opens the east sea. The ship rounds the cape to Marathon
// Bay and sails on to the Trojan landing and the Far Shores, which become
// one-place stops; their roads, Susa and the Scythian Crag retire. Known steps
// become walkable paths, and a lane the ship no longer sails is forgotten.
export function upgradeGreekEastSeaSave(s) {
  const pack = packDefinitions.find((p) => p.id === "greek-drama");
  const saved = s.packs?.[pack?.id];
  if (!pack || pack.revision < 16 || saved?.revision !== 15) return;
  foldRetiredRoads(s);
  const sailed = new Set(laneEdges().map((edge) => JSON.stringify(edge)));
  for (const [actor, edges] of Object.entries(s.routeKnowledge || {}))
    if (Array.isArray(edges))
      s.routeKnowledge[actor] = edges.filter(
        (edge) => !laneOfEdge(edge) || sailed.has(JSON.stringify(edge)),
      );
  saved.revision = 16;
}
