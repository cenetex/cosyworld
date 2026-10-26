import { controlledByHuman, currentActor, humanAvatar } from "./human-cast.mjs";

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
    if (!pack.recital) continue;
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
  const visit = recitalVisit(world, pack);
  if (!visit) return [];
  const poem = recitalPoem(world, pack, visit - 1);
  return [
    `Your song is ${poem.title}. These are the traveler's earned words, in order. Sing a couplet when addressed; keep the whole journey in mind.`,
    ...poem.stanzas.map((s, i) => {
      const traveler = world.packs[pack.id].recitals[s.id].actor;
      return `Verse ${i + 1}, ${humanAvatar(traveler).name}: ${s.lines.join(" ")}`;
    }),
  ];
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
      humanAvatar(r.actor) &&
      (r.visit === null ||
        (v.summons &&
          Number.isSafeInteger(r.visit) &&
          r.visit > state.receipts[v.choice] &&
          r.visit <= world.turn))
    );
  });
}

// Older schema-seven saves retain their choices. Their first later journey
// introduces the singer with the earned song, including after log pruning.
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
        actor: event?.actorId || currentActor(world),
        visit: null,
      };
    }
  }
}
