// Spawn rules let a place grow the world when a condition holds in play. Each
// rule is data: one trigger and one effect from closed sets, a table of rows
// to draw from, and a cap. A rule fires once per claim key, and the claim
// records what it created, so a replay creates the same entities.
import { avatarOrder, choiceHash, newProgress } from "./goals.mjs";

export const TRIGGERS = [
  "quest_completed_here",
  "item_brought",
  "visits",
  "gathered",
];
export const EFFECTS = ["open_place", "add_item", "bring_resident"];

// Count how often a rule's trigger held during this round.
function occurrences(s, placeId, rule, round) {
  const when = rule.when;
  switch (when.kind) {
    case "quest_completed_here":
      return round.completed.filter((c) => c.place === placeId).length;
    case "item_brought":
      return round.arrivals.filter(
        (a) =>
          a.place === placeId &&
          a.items.some(
            (id) => !when.tag || s.items[id].tags.includes(when.tag),
          ),
      ).length;
    case "visits": {
      const before = s.places[placeId].visits - round.visits(placeId);
      return (
        Math.floor(s.places[placeId].visits / when.count) -
        Math.floor(before / when.count)
      );
    }
    case "gathered":
      return avatarOrder(s).filter((id) => s.avatars[id].place === placeId)
        .length >= when.count && round.touched.has(placeId)
        ? 1
        : 0;
  }
  return 0;
}

const describe = (row) => ({
  name: row.name,
  text: row.text || "",
  tags: [...(row.tags || [])],
});
function create(s, placeId, rule, key) {
  const rows = s.tables[rule.make.table];
  const row = rows[choiceHash(s.seed, key) % rows.length];
  s.spawned += 1;
  const id = `${rule.make.table}-${s.spawned}`;
  switch (rule.make.kind) {
    case "open_place":
      s.places[id] = {
        ...describe(row),
        exits: [placeId],
        visits: 0,
        spawn: structuredClone(row.spawn || []),
      };
      s.places[placeId].exits = [...s.places[placeId].exits, id];
      break;
    case "add_item":
      s.items[id] = { ...describe(row), holder: placeId, history: [] };
      break;
    case "bring_resident":
      s.avatars[id] = {
        ...describe(row),
        role: "resident",
        place: placeId,
        progress: newProgress(),
        lastTalk: -9,
        peaceUntil: 0,
      };
      break;
  }
  return id;
}

// Fire every rule whose trigger held this round, in place order. Returns the
// created entities with their claims so the round can log them.
export function applySpawns(s, round) {
  const created = [];
  for (const placeId of Object.keys(s.places)) {
    if (!round.touched.has(placeId)) continue;
    for (const rule of s.places[placeId].spawn) {
      let times = occurrences(s, placeId, rule, round);
      for (; times > 0; times--) {
        const prefix = `${placeId}:${rule.id}:`;
        const used = Object.keys(s.claims).filter((k) =>
          k.startsWith(prefix),
        ).length;
        if (used >= rule.max || s.spawned >= s.rules.maxSpawns) break;
        const key = prefix + (used + 1);
        const id = create(s, placeId, rule, key);
        s.claims[key] = { turn: s.turn, created: id };
        created.push({ id, kind: rule.make.kind, place: placeId, key });
      }
    }
  }
  return created;
}

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export function validSpawnRule(rule, tables) {
  const when = rule?.when,
    make = rule?.make;
  return (
    rule &&
    ID.test(rule.id) &&
    Number.isInteger(rule.max) &&
    rule.max >= 1 &&
    rule.max <= 64 &&
    when &&
    TRIGGERS.includes(when.kind) &&
    (when.tag === undefined || ID.test(when.tag)) &&
    (!["visits", "gathered"].includes(when.kind) ||
      (Number.isInteger(when.count) && when.count >= 1)) &&
    make &&
    EFFECTS.includes(make.kind) &&
    Array.isArray(tables[make.table]) &&
    tables[make.table].length >= 1
  );
}
export function validTables(tables) {
  return (
    tables &&
    typeof tables === "object" &&
    Object.entries(tables).every(
      ([id, rows]) =>
        ID.test(id) &&
        Array.isArray(rows) &&
        rows.every(
          (row) =>
            typeof row.name === "string" &&
            row.name.length >= 1 &&
            row.name.length <= 80 &&
            (row.text === undefined ||
              (typeof row.text === "string" && row.text.length <= 400)) &&
            (row.tags === undefined ||
              (Array.isArray(row.tags) && row.tags.every((t) => ID.test(t)))) &&
            (row.spawn === undefined || Array.isArray(row.spawn)),
        ),
    )
  );
}
