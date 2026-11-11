import { newMemories, profiles, upgradeSightings } from "./memory.mjs";
import {
  packDefinitions,
  conditionsMet,
  entityEnabled,
  packEntity,
  departed,
} from "./pack-registry.mjs";
import { sectionAllows } from "./pack-sections.mjs";
import { humanAvatarIds } from "./human-cast.mjs";
import forest from "./forest.json" with { type: "json" };
import { installItemCycle } from "./pack-items.mjs";

// The save schema. The rules 133 bump retired every earlier save and shared
// world ("we can reset"): a save of another schema is not lifted, it starts
// fresh and keeps only what a traveler carries (`carryLocalProgress`).
export const SAVE_SCHEMA = 8;
// The schemas that ever shipped before it. Anything else that fails to load
// (unreadable text, an unknown schema, a broken current save) is corrupt, not
// retired, and keeps the "needs a fresh start" recovery notice.
const RETIRED_SCHEMAS = [6, 7];

// A parsed save from before the current schema, or null. Unreadable text,
// and a save of the current schema, are not retired saves.
export function retiredSave(text) {
  try {
    const s = typeof text === "string" ? JSON.parse(text) : text;
    return s &&
      typeof s === "object" &&
      RETIRED_SCHEMAS.includes(s.schema)
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
        .slice(0, 16);
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
  // Packs saved at an earlier revision follow their reworked story below.
  const reworked = new Set(
    packDefinitions
      .filter((p) => (s.packs?.[p.id]?.revision ?? p.revision) < p.revision)
      .map((p) => p.id),
  );
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
  return s;
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
