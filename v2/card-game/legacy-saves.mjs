import { newMemories, profiles, upgradeSightings, upgradeSubjectMemories } from "./memory.mjs";
import {
  packDefinitions,
  conditionsMet,
  entityEnabled,
  packEntity,
  departed,
  transports,
  progressionRequirementsMet,
} from "./pack-registry.mjs";
import { boxDefs } from "./world/boxes.mjs";
import { sectionAllows } from "./pack-sections.mjs";
import { humanAvatarIds } from "./human-cast.mjs";
import forest from "./forest.json" with { type: "json" };
import { installItemCycle } from "./pack-items.mjs";
import { bringBack, gone, sendHome, usedUp, useUp } from "./item-use.mjs";
import { savedClaim } from "./claims.mjs";
import { installQuestFacts } from "./quest-learn.mjs";
import { settleStrandedWayfinder } from "./world/elysium-travel.mjs";
import { ELYSIUM_PACK } from "./elysium-models.mjs";
import {
  laneEdges,
  lanesFrom,
  seaEdge,
  TRANSPORT_VERSION,
} from "./pack-transport.mjs";
import { authoredRouteEdges } from "./roaming-routes.mjs";

// The save schema. The rules 133 bump retired every earlier save and shared
// world ("we can reset"): a save of another schema is not lifted, it starts
// fresh and keeps only what a traveler carries (`carryLocalProgress`).
export const SAVE_SCHEMA = 8;
// The schemas that ever shipped before it. Anything else that fails to load
// (unreadable text, an unknown schema, a broken current save) is corrupt, not
// retired, and keeps the "needs a fresh start" recovery notice.
const RETIRED_SCHEMAS = [6, 7];

export function canBackfillPackResidents(pack, previous) {
  if (!(previous.revision < pack.revision)) return false;
  if (pack.id === ELYSIUM_PACK) return true;
  return (
    pack.id === "greek-drama" &&
    Number.isSafeInteger(previous.revision) &&
    previous.revision > 0
  );
}

// A parsed save from before the current schema, or null. Unreadable text,
// and a save of the current schema, are not retired saves.
export function retiredSave(text) {
  try {
    const s = typeof text === "string" ? JSON.parse(text) : text;
    return s && typeof s === "object" && RETIRED_SCHEMAS.includes(s.schema)
      ? s
      : null;
  } catch {
    return null;
  }
}

// A fresh local world keeps what the traveler earned in a retired save: each
// human avatar's level and experience, as a shared claim carries them, and
// its cosmetic upgrades. Nothing else survives.
export function carryLocalProgress(world, old) {
  const count = (n) => Number.isInteger(n) && n >= 0 && n <= 1_000_000;
  for (const id of humanAvatarIds) {
    const from = old?.actors?.[id],
      to = world?.actors?.[id];
    if (!from || !to) continue;
    if (Array.isArray(from.upgrades)) {
      const kept = from.upgrades.filter(
        (u) => typeof u === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(u),
      );
      to.upgrades = [...new Set([...(to.upgrades || []), ...kept])]
        .sort()
        .slice(0, 40);
    }
    if (
      !count(from.xp) ||
      !(from.level === undefined || (count(from.level) && from.level >= 1))
    )
      continue;
    to.xp = from.xp;
    if (from.level === undefined) delete to.level;
    else to.level = from.level;
    // The least experience that level takes, so the rules' caps still hold.
    to.carried = Math.max(
      from.xp,
      from.level ? (from.level * (from.level - 1)) / 2 : 0,
    );
  }
  return world;
}

// Bring a loaded save of the current schema up to the current content: packs
// mounted since, reworked pack stories, and the facts they changed. A save of
// any other schema starts fresh.
export function upgradeSave(s, { installPacks, laneText = () => null }) {
  if (!s || s.schema !== SAVE_SCHEMA)
    throw new Error("This save needs a fresh start.");
  const reworked = new Set(
    packDefinitions
      .filter((p) => {
        const revision = s.packs?.[p.id]?.revision;
        return (
          Number.isSafeInteger(revision) &&
          revision > 0 &&
          revision < p.revision
        );
      })
      .map((p) => p.id),
  );
  upgradeSightings(s);
  for (const a of Object.values(s.actors || {})) {
    if (a?.offered && !Object.hasOwn(a.offered, "from")) delete a.offered;
    // Old agreements preserve the trip already taken, not permission for future legs.
    delete a?.companion;
    delete a?.actedAt;
  }
  installPacks(s);
  const greekRevision = s.packs?.["greek-drama"]?.revision;
  if (reworked.has("greek-drama")) {
    const restore = greekRevision < 43 ? releaseGreekStaples(s) : [];
    if (greekRevision < 41) {
      reconcileSingletonStock(s, "greek-bread");
      postGreekRecords(s);
    }
    if (greekRevision < 42) reconcileSingletonStock(s, "greek-figs");
    if (greekRevision < 43) {
      reconcileGreekHoney(s);
      retainGreekResponseHistory(s);
    }
    for (const id of restore) {
      const item = packEntity(id);
      if (!item.locked && usedUp(s, id)) bringBack(s, id, item.holder);
    }
  }
  reconcileContent(s);
  upgradeSubjectMemories(s);
  reconcilePackProgress(s, reworked);
  if (reworked.has("greek-drama")) {
    if (greekRevision < 37) reconcileGreekShips(s);
    if (greekRevision < 38 && packEntity("greek-road-north")?.retired)
      reconcileNorthernRoad(s);
    if (greekRevision < 43) {
      reconcileGreekRoutes(s);
      reconcileGreekClaims(s);
    }
  }
  if (reworked.has("elysium")) settleStrandedWayfinder(s);
  // A told lane keeps its id; its words follow the lane's current conditions.
  // A lane the ship no longer sails is forgotten (Greek revision 16).
  for (const [id, fact] of Object.entries(s?.knowledge?.facts || {})) {
    if (fact?.source?.kind !== "lane") continue;
    const text = laneText(id);
    if (text) fact.text = text;
    else if (reworked.size) forgetFact(s.knowledge, id);
  }
  reconcileTopics(s);
  reconcileClaims(s);
  for (const pack of packDefinitions)
    if (reworked.has(pack.id)) s.packs[pack.id].revision = pack.revision;
  installQuestFacts(s);
  return s;
}

// Recover staples surrendered before the rule that protects their renewal.
function releaseGreekStaples(s) {
  if (!Array.isArray(s.gone)) return [];
  const restored = s.gone.filter((id) => {
    const item = packEntity(id);
    return s.items?.[id] && item?.packId === "greek-drama" && item.tags?.includes("staple");
  });
  if (restored.length) s.gone = s.gone.filter((id) => !restored.includes(id));
  return restored;
}

// Local supplies replaced physical stocks of Bread (41), Figs (42) and Honey (43).
function reconcileSingletonStock(s, staple) {
  if (!s.items?.[staple] || !usedUp(s, staple) || gone(s, staple)) return;
  const pack = packDefinitions.find(({ id }) => id === "greek-drama");
  const carried = (pack.choices || [])
    .filter((choice) =>
      choice.id.endsWith("-supply") &&
      choice.effects.some((effect) => effect.kind === "drop_item" && effect.item === staple) &&
      conditionsMet(s, pack.id, choice.requires),
    )
    .map(({ id }) => id.slice(0, -"-supply".length))
    .filter((id) => s.actors[s.items[id]?.holder] && !usedUp(s, id) && !gone(s, id))
    .sort();
  // Prefer a human avatar, then a stable actor order, regardless of who loads
  // the save. Within that inventory keep the loaf selected in hand if any.
  const actors = [...new Set([...humanAvatarIds, ...Object.keys(s.actors).sort()])];
  for (const actor of actors) {
    const candidates = carried.filter((id) => s.items[id].holder === actor);
    if (!candidates.length) continue;
    const selected = s.actors[actor].heldItem;
    const id = candidates.includes(selected) ? selected : candidates[0];
    bringBack(s, staple, actor);
    s.items[staple].history = s.items[id].history;
    if (selected === id) s.actors[actor].heldItem = staple;
    break;
  }
}

function reconcileGreekHoney(s) {
  const honey = "greek-antigone-grave-honey";
  const grave = "greek-polynices-hollow";
  const former = s.items?.[honey];
  // Before burial, the old grave stock was dormant even though it had a holder.
  if (former?.holder === grave && !former.history.length &&
      !s.packs["greek-drama"].flags["greek-burial-performed"]) {
    useUp(s, honey, packEntity(honey).holder);
  }
  reconcileSingletonStock(s, honey);
  // The grave offering still exists, but the shared Honey now belongs at the sanctuary.
  forgetPlaceCards(s, (place, item) => place === grave && item === honey);
}

function retainGreekResponseHistory(s) {
  const pack = packDefinitions.find(({ id }) => id === "greek-drama");
  const receipts = s.packs[pack.id].receipts ?? {};
  const outcomes = (pack.choices || []).filter((choice) =>
    !choice.on && choice.workId && /-(?:first|second)-answer$/u.test(choice.id) &&
    Object.hasOwn(receipts, choice.id),
  );
  for (const choice of outcomes) {
    const former = choice.id.replace(/-(?:first|second)-answer$/u, "-object");
    const entry = s.log?.find((entry) => entry.verb === "give" && entry.accepted === true &&
      entry.itemId === former && entry.targetId === choice.subject && entry.turn === receipts[choice.id]);
    if (!entry) continue;
    entry.kind = "narration";
    delete entry.verb;
    delete entry.itemId;
    delete entry.accepted;
    delete entry.gone;
  }
  // The old portable Wine rewards were paid to the bearer in these exact handoffs.
  for (const [receipt, token] of [
    ["greek-acharnae-accept-private-order", "greek-acharnae-household-bond"],
    ["greek-helen-troy-shelter", "greek-troy-testimony"],
  ]) {
    const choice = pack.choices.find(({ id }) => id === receipt);
    if (!choice || !Object.hasOwn(receipts, receipt)) continue;
    const payment = s.log?.find((entry) => entry.verb === "give" && entry.accepted === true &&
      entry.itemId === token && entry.targetId === choice.subject && entry.turn === receipts[receipt]);
    const trust = s.actors[choice.subject]?.trust;
    if (trust && humanAvatarIds.includes(payment?.actorId))
      trust[payment.actorId] = Math.max(trust[payment.actorId] ?? 0, 2);
  }
}

const mergedGreekClaims = [
  ["greek-troezen-witness-tablet:account", "greek-story-euripides-hippolytus-record:greek-story-euripides-hippolytus-first-answer"],
  ["greek-troezen-expulsion-writ:account", "greek-story-euripides-hippolytus-record:greek-story-euripides-hippolytus-second-answer"],
  ["greek-farmhouse-hearing-writ:account", "greek-farm-testimony:greek-atreid-euripides-hearing"],
  ["greek-trojan-kin-roll-copy:greek-story-euripides-trojan-women-first-answer", "greek-story-euripides-trojan-women-record:greek-story-euripides-trojan-women-first-answer"],
  ["greek-tauris-release-tablet:greek-story-euripides-tauris-first-answer", "greek-story-euripides-tauris-record:greek-story-euripides-tauris-first-answer"],
  ["greek-helen-troy-return-tally:greek-helen-troy-passage", "greek-troy-testimony:greek-helen-troy-passage"],
  ["greek-areopagus-acquittal-counterseal:acquittal", "greek-story-aeschylus-eumenides-record:greek-story-aeschylus-eumenides-first-answer"],
  ["greek-delphi-witness-tablet:account", "greek-story-euripides-ion-record:greek-story-euripides-ion-first-answer"],
  ["greek-argos-herald-vote-tablet:account", "greek-story-euripides-orestes-record:greek-story-euripides-orestes-first-answer"],
  ["greek-theban-messenger-pledge:account", "greek-story-euripides-heracles-record:greek-story-euripides-heracles-second-answer"],
];

function reconcileGreekClaims(s) {
  const k = s.knowledge;
  for (const [oldClaim, newClaim] of mergedGreekClaims) {
    const from = `claim:greek-drama:${oldClaim}`;
    const to = `claim:greek-drama:${newClaim}`;
    const old = k?.facts?.[from];
    if (old?.source?.kind !== "claim") continue;
    const claim = savedClaim(s, to, old);
    if (!claim) continue;
    const current = k.facts[to];
    const first = !current || old.source.eventSeq < current.source.eventSeq ? old : current;
    const { book, claim: recorded, author, about, text } = claim;
    k.facts[to] = {
      id: to, text,
      source: {
        ...first.source, book, claim: recorded, author, about,
        witnesses: [...new Set([...old.source.witnesses, ...(current?.source.witnesses ?? [])])].sort(),
      },
    };
    for (const known of Object.values(k.known || {})) {
      const learned = known[from], existing = known[to];
      if (learned && (!existing ||
          (learned.kind === "read" && existing.kind !== "read") ||
          (learned.kind === existing.kind && learned.eventSeq < existing.eventSeq))) {
        known[to] = learned.kind === "read" ? { ...learned, book } : learned;
      }
    }
    forgetFact(k, from);
  }
}

// Court and witness papers now stay posted where their sources can attest to them.
function postGreekRecords(s) {
  for (const id of [
    "greek-areopagus-witness-order",
    "greek-danaids-vote-writ",
    "greek-marathon-guard-summons",
    "greek-rhesus-bedside-deposition",
  ]) {
    const book = packEntity(id);
    if (book?.lifecycle === "fixed" && s.items?.[id] && s.items[id].holder !== book.holder)
      sendHome(s, id, book.holder);
  }
}

// Greek revision 37 moved these four ports from the Charybdis to the Scylla.
const formerFarLanes = [
  ["greek-piraeus", "greek-lemnos"],
  ["greek-piraeus", "greek-sicily"],
  ["greek-lemnos", "greek-thrace"],
  ["greek-thrace", "greek-tauris"],
];
const formerFarPorts = new Set(
  formerFarLanes.flat().filter((port) => port !== "greek-piraeus"),
);

function forgetRouteEdges(s, obsolete) {
  for (const [actor, edges] of Object.entries(s.routeKnowledge || {})) {
    if (!Array.isArray(edges)) continue;
    s.routeKnowledge[actor] = edges.filter(
      (edge) =>
        !Array.isArray(edge) ||
        edge.length !== 2 ||
        !obsolete.has(edge.join(">")),
    );
  }
}

// The old catalog seeded its residents with these one-way returns. Their
// replacements lead through new roads and berths, which must be learned there.
const formerGreekReturns = [
  ["greek-bird-wilderness", "greek-attic-farm"],
  ["greek-divine-heights", "greek-attic-farm"],
  ["greek-jury-house", "greek-athens"],
  ["greek-lemnos", "greek-piraeus"],
  ["greek-scythian-crag", "greek-piraeus"],
  ["greek-sicily", "greek-piraeus"],
  ["greek-susa", "greek-troy"],
  ["greek-tauris", "greek-piraeus"],
  ["greek-thrace", "greek-piraeus"],
  ["greek-underworld", "greek-colonus"],
];

function reconcileGreekRoutes(s) {
  const live = new Set(authoredRouteEdges().map((edge) => edge.join(">")));
  const obsolete = formerGreekReturns
    .map((edge) => edge.join(">"))
    .filter((edge) => !live.has(edge));
  forgetRouteEdges(s, new Set(obsolete));
}

function reconcileNorthernRoad(s) {
  const road = "greek-road-north";
  // The road remains in history, but Ajax's landing is now reached by sea.
  forgetRouteEdges(
    s,
    new Set(
      ["greek-harbor", "greek-ajax-landing"].flatMap((end) => [
        `${road}>${end}`,
        `${end}>${road}`,
      ]),
    ),
  );
  s.standoffs = s.standoffs.filter((c) => c.location !== road);
}

function reconcileGreekShips(s) {
  const charybdis = transports["greek-ship"];
  const scylla = transports["greek-scylla"];
  if (!scylla) return;
  const priorEdges = new Set(
    [
      ...formerFarLanes.flatMap(([from, to]) => [
        seaEdge(from, to),
        seaEdge(to, from),
      ]),
      ...[...formerFarPorts].flatMap((port) => [
        [charybdis.place, port],
        [port, charybdis.place],
      ]),
      ["greek-harbor", "greek-egypt-tomb"],
      ["greek-egypt-tomb", "greek-harbor"],
    ].map((edge) => edge.join(">")),
  );
  const liveEdges = new Set(
    [...authoredRouteEdges(), ...laneEdges()].map((edge) => edge.join(">")),
  );
  forgetRouteEdges(s, new Set([...priorEdges].filter((key) => !liveEdges.has(key))));

  const old = s.transports["greek-ship"];
  if (old?.version !== TRANSPORT_VERSION) return;
  const transfer = formerFarPorts.has(old.dock) && scylla.docks.includes(old.dock);
  const ship = transfer ? scylla : charybdis;
  const dock = old.dock;
  const recall = ship.docks.includes(old.recall) ? old.recall : null;
  const canceled =
    old.destination !== null &&
    !lanesFrom(ship, dock).includes(old.destination);
  const riders = Object.keys(s.actors)
    .filter((id) =>
      s.actors[id].place === charybdis.place && entityEnabled(s, id, true),
    )
    .sort();
  // A canceled passage allows everyone to disembark where they set out.
  const stopped = (berthed, passengers = []) => ({
    version: TRANSPORT_VERSION,
    phase: passengers.length ? "arrived" : "docked",
    dock: berthed,
    destination: null,
    riders: passengers,
    since: s.turn,
    recall: null,
  });
  if (transfer) {
    for (const id of riders) s.actors[id].place = scylla.place;
    // A standoff's source names the old deck and stays in the journal.
    s.standoffs = s.standoffs.filter((c) => c.location !== charybdis.place);
    for (const item of Object.values(s.items))
      if (item.holder === charybdis.place) item.holder = scylla.place;
    const transferred = canceled ? stopped(dock, riders) : { ...old, recall };
    if (!canceled && (old.phase === "docked" || old.phase === "arrived")) {
      // Everyone aboard can step onto the berth after the ship changes.
      transferred.phase = riders.length ? "arrived" : "docked";
      transferred.riders = riders;
      if (!riders.length) transferred.recall = null;
    }
    s.transports["greek-scylla"] = transferred;
    s.transports["greek-ship"] = stopped(
      charybdis.docks.includes(old.recall) ? old.recall : charybdis.at,
    );
  } else if (
    canceled &&
    ship.docks.includes(dock) &&
    formerFarPorts.has(old.destination)
  ) {
    s.transports["greek-ship"] = stopped(dock, riders);
  } else if (formerFarPorts.has(old.recall)) {
    old.recall = recall;
  }
}

// A loaded save follows the current content. A retired crossing closes even
// where the save had found it, every authored thing is present, and a thing
// the content no longer defines leaves the world: whatever it held stays
// with whoever, or wherever, held it. A place or dock added after the save
// was written starts with an empty memory (rules 93). A resident's record is
// checked as saved: a new resident joins through its pack's save upgrade.
export function reconcileContent(s) {
  if (!s?.items || typeof s.items !== "object") return;
  const fresh = newMemories();
  if (s.memories && typeof s.memories === "object")
    for (const [id, memory] of Object.entries(fresh))
      if (profiles[id].kind === "location") s.memories[id] ??= memory;
  for (const pack of packDefinitions)
    for (const c of pack.crossings)
      if (c.retired && s.crossings?.[c.id])
        s.crossings[c.id].discovered = false;
  const pondCrossing = s.crossings?.["pond-greek-harbor"];
  if (pondCrossing?.method === "station-lantern") delete pondCrossing.method;
  const authored = structuredClone(forest.initialState.items);
  for (const pack of packDefinitions)
    for (const [id, item] of Object.entries(pack.items || {}))
      authored[id] ??= { holder: item.holder, history: [] };
  const added = [];
  for (const [id, item] of Object.entries(authored))
    if (!Object.hasOwn(s.items, id)) {
      s.items[id] = item;
      if (s.memories) s.memories[id] ??= fresh[id];
      added.push(id);
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
  delete s.openedRoutes;
  delete s.astray;
  if (s.opened && typeof s.opened === "object" && !Array.isArray(s.opened)) {
    const boxes = new Set(boxDefs().map((d) => d.id));
    for (const id of Object.keys(s.opened))
      if (!boxes.has(id)) delete s.opened[id];
    if (!Object.keys(s.opened).length) delete s.opened;
  }
  // A used-up thing waits where its content now starts it (rules 95).
  if (Array.isArray(s.usedUp)) {
    s.usedUp = s.usedUp.filter((id) => Object.hasOwn(s.items, id));
    for (const pack of packDefinitions)
      for (const [id, item] of Object.entries(pack.items || {}))
        if (s.usedUp.includes(id)) s.items[id].holder = item.holder;
    installItemCycle(s, added);
  }
}

// A story step the content no longer leads to leaves a save from an earlier
// pack revision; a save at the current revision is checked as it stands.
// Receipts replay in order, as validation reads them; a step whose prerequisites
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
      packs: {
        ...s.packs,
        [pack.id]: { ...state, choices, flags, receipts: kept },
      },
    };
    const holds = (requires) =>
      progressionRequirementsMet(projection, pack.id, requires);
    const receipts = Object.entries(state.receipts).sort((a, b) => a[1] - b[1]);
    for (const [id, turn] of receipts) {
      const c = pack.choices.find((choice) => choice.id === id);
      if (
        !c?.effects.length ||
        // A step the release no longer holds (a rumoured place's story) is
        // forgotten, and so is whatever followed from it.
        (pack.release &&
          state.scope !== "full" &&
          !pack.release.choices.includes(id)) ||
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
      if (!avatar.journey) delete s.journeyProgress?.[id];
      // A journey not yet agreed starts from its first step.
      if (a && avatar.journey && !kept[avatar.journey.after])
        a.place = avatar.journey.path[0];
      if (!a || entityEnabled(s, id, true) || departed(pack, state, id))
        continue;
      delete state.met[id];
      delete s.opening?.met?.[id];
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

// A told topic follows its current words and choice at any pack revision.
// One the content retired, or gave another teller or place, is forgotten.
export function reconcileTopics(s) {
  const k = s?.knowledge;
  if (!k?.facts || typeof k.facts !== "object") return;
  const topics = new Map(
    packDefinitions.flatMap((pack) =>
      (pack.topics || []).map((t) => [`${pack.id}:${t.id}`, t]),
    ),
  );
  for (const [id, fact] of Object.entries(k.facts)) {
    const told = fact?.source?.kind === "topic" && fact.source.topic;
    if (!told) continue;
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
// A read claim follows its book at any pack revision, or is forgotten.
export function reconcileClaims(s) {
  for (const [id, fact] of Object.entries(s?.knowledge?.facts || {})) {
    if (fact?.source?.kind !== "claim") continue;
    const claim = savedClaim(s, id, fact);
    if (!claim) forgetFact(s.knowledge, id);
    else {
      fact.text = claim.text;
      Object.assign(fact.source, { author: claim.author, about: claim.about });
      for (const known of Object.values(s.knowledge.known || {}))
        if (known?.[id]?.status !== undefined && known[id].status !== claim.settles)
          delete known[id].status;
    }
  }
}
function forgetFact(k, id) {
  delete k.facts[id];
  for (const known of Object.values(k.known || {})) delete known?.[id];
  if (Array.isArray(k.pending))
    k.pending = k.pending.filter((p) => p?.factId !== id);
}

function forgetPlaceCards(s, removed) {
  const activeCards = s.placeCard;
  if (activeCards && typeof activeCards === "object" && !Array.isArray(activeCards)) {
    for (const [place, item] of Object.entries(activeCards)) {
      if (!removed(place, item)) continue;
      delete activeCards[place];
      if (!Object.keys(activeCards).length) delete s.placeCard;
    }
  }
  const completedCards = s.placeMet;
  if (completedCards && typeof completedCards === "object" && !Array.isArray(completedCards)) {
    for (const [place, items] of Object.entries(completedCards)) {
      if (!Array.isArray(items)) continue;
      const kept = items.filter((item) => !removed(place, item));
      if (kept.length === items.length) continue;
      if (kept.length) completedCards[place] = kept;
      else delete completedCards[place];
      if (!Object.keys(completedCards).length) delete s.placeMet;
    }
  }
}

// The journal keeps every moment that still names a living thing. A deed done
// with a retired thing leaves, with what anyone learned from it; a moment it
// only witnessed keeps the others.
export function forgetRetiredThings(s, retired) {
  if (!retired.size) return;
  forgetPlaceCards(s, (_place, item) => retired.has(item));
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
    if (retired.has(a.heldItem)) delete a.heldItem;
    const quests = [a?.want, ...(a?.under || [])].filter(Boolean);
    const kept = quests.filter(
      (w) =>
        !(w.kind === "item" && retired.has(w.target)) &&
        !w.step?.items?.some((item) => retired.has(item)),
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
    if (retired.has(next.wantId)) delete next.wantId;
    // Keep the account of the completed recipe without a live custody receipt
    // for ingredients that no longer exist in this world.
    if (next.verb === "craft" && Array.isArray(next.consumedIds) &&
        next.consumedIds.some((id) => retired.has(id))) {
      delete next.verb;
      delete next.consumedIds;
      delete next.sourceSeq;
      delete next.holderId;
    }
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
