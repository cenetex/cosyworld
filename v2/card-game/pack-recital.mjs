import { controlledByHuman, humanAvatar } from "./human-cast.mjs";
import forest from "./forest.json" with { type: "json" };

// Pack-authored songs grow from durable choices. A completed deed brings the
// singer to that player's next room; ordinary turns leave the visit pending.
export function recordRecital(world, pack, choice, actor) {
  if (pack.recital?.verses.some((v) => v.choice === choice))
    world.packs[pack.id].recitals[choice] = { actor, visit: null };
}

export function arriveRecitals(world, packs, actor) {
  if (!controlledByHuman(world, actor)) return [];
  const arrivals = [];
  for (const pack of packs) {
    if (!pack.recital || pack.avatars[pack.recital.actor]?.roamingQuest)
      continue;
    const records = world.packs[pack.id].recitals;
    const pending = pack.recital.verses.filter(
      (v) =>
        v.summons &&
        records[v.choice]?.actor === actor &&
        records[v.choice].visit === null,
    );
    if (!pending.length) continue;
    const singer = pack.recital.actor;
    const from = world.actors[singer].place;
    const to = world.actors[actor].place;
    for (const verse of pending) records[verse.choice].visit = world.turn;
    world.actors[singer].place = to;
    arrivals.push({ actorId: singer, fromLocationId: from, locationId: to });
  }
  return arrivals;
}

export function recitalVisit(world, pack) {
  return Math.max(
    0,
    ...Object.values(world.packs?.[pack.id]?.recitals || {}).map(
      (r) => r.visit || 0,
    ),
  );
}

export function recitalPoem(world, pack, through = Infinity) {
  const receipts = world.packs?.[pack.id]?.receipts || {};
  const stanzas = (pack.recital?.verses || [])
    .filter((v) => receipts[v.choice] && receipts[v.choice] <= through)
    .sort((a, b) => receipts[a.choice] - receipts[b.choice])
    .map((v) => ({
      id: v.choice,
      turn: receipts[v.choice],
      questId: v.quest,
      lines:
        v.after && receipts[v.after.choice] < receipts[v.choice]
          ? v.after.lines
          : v.lines,
    }));
  return { title: pack.recital?.title, stanzas };
}

export function recitalFacts(world, packs, actor) {
  const pack = packs.find((p) => p.recital?.actor === actor);
  if (!pack) return [];
  const name = (id) =>
    humanAvatar(id)?.name ||
    forest.people[id]?.name ||
    forest.places[id]?.name ||
    packs.find((p) => p.avatars?.[id])?.avatars[id].name ||
    packs.find((p) => p.places?.[id])?.places[id].name ||
    "an earlier traveler";
  const want = world.actors[actor]?.want;
  return want?.kind === "place"
    ? [
        world.actors[actor].place === want.target
          ? `You have reached ${name(want.target)}.`
          : `Your road leads to ${name(want.target)}. Take an ordinary open route toward it.`,
      ]
    : [];
}

export function validRecitals(world, pack) {
  if (!pack.recital) return true;
  const state = world.packs[pack.id],
    records = state.recitals;
  if (
    !records ||
    typeof records !== "object" ||
    Array.isArray(records) ||
    !state.receipts ||
    typeof state.receipts !== "object" ||
    Array.isArray(state.receipts)
  )
    return false;
  const verses = pack.recital.verses.filter((v) =>
    Object.hasOwn(state.receipts, v.choice),
  );
  if (Object.keys(records).length !== verses.length) return false;
  return verses.every((v) => {
    const r = records[v.choice];
    return (
      r &&
      Object.keys(r).sort().join() === "actor,visit" &&
      (r.actor === null || Object.hasOwn(world.actors, r.actor)) &&
      (r.visit === null ||
        (v.summons &&
          Number.isSafeInteger(r.visit) &&
          r.visit >= state.receipts[v.choice] &&
          r.visit <= world.turn))
    );
  });
}

// Older schema-seven saves retain their choices. Their first later journey
// introduces the singer when the traveler is known. Pruned deeds keep their
// verse with an unknown traveler until another known deed brings the song.
export function upgradeRecitals(world, packs) {
  for (const pack of packs) {
    const state = world.packs?.[pack.id];
    if (!pack.recital || !state || state.recitals !== undefined) continue;
    state.recitals = {};
    for (const v of pack.recital.verses) {
      if (!Object.hasOwn(state.receipts || {}, v.choice)) continue;
      const event = world.log?.find(
        (e) => e.choiceId === v.choice && e.packId === pack.id,
      );
      state.recitals[v.choice] = {
        actor: Object.hasOwn(world.actors, event?.actorId)
          ? event.actorId
          : null,
        visit: null,
      };
    }
  }
}

export function arriveRoamingRecitals(world, packs, actor) {
  for (const pack of packs.filter((p) => p.recital?.actor === actor)) {
    const state = world.packs[pack.id];
    for (const verse of pack.recital.verses) {
      const record = state.recitals[verse.choice];
      if (verse.summons && record && record.visit === null)
        record.visit = world.turn;
    }
  }
}

// The complete earned poem is separate from the short scene facts.
export function recitalContext(world, packs, actor) {
  const pack = packs.find((p) => p.recital?.actor === actor);
  if (!pack) return null;
  const poem = recitalPoem(world, pack);
  const stanzas = poem.stanzas.map((stanza) => {
    const authorId = world.packs[pack.id].recitals[stanza.id]?.actor ?? null;
    return {
      id: stanza.id,
      turn: stanza.turn,
      authorId,
      authorName:
        humanAvatar(authorId)?.name ||
        forest.people[authorId]?.name ||
        packs.find((p) => p.avatars?.[authorId])?.avatars[authorId].name ||
        "an earlier traveler",
      lines: [...stanza.lines],
    };
  });
  const latest = Math.max(0, ...stanzas.map((stanza) => stanza.turn));
  return {
    title: poem.title,
    stanzas,
    newLines: stanzas
      .filter((stanza) => stanza.turn === latest)
      .flatMap((stanza) => stanza.lines),
  };
}
