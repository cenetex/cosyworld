// The world grows only through quests. A place's quest asks for items to be
// put down there and makes a new item once they all are. A step of an avatar's
// quest can open a doorway from one place to a new one. Each result is
// promised in advance as a latent entity, so other quests can require it
// before it exists, and chains of requirements deepen with level.
import {
  asleep,
  avatarOrder,
  awake,
  choiceHash,
  distances,
  holderOf,
  itemPlace,
  nameOf,
} from "./goals.mjs";

// A latent item has no holder yet. A latent place has no exits yet.
export const latentItem = (s, id) => s.items[id]?.holder === null;
export const latentPlace = (s, id) => Boolean(s.places[id]?.latent);

const describe = (row) => ({
  name: row.name,
  text: row.text || "",
  tags: [...(row.tags || [])],
});
export const newPlace = (row, extra = {}) => ({
  ...describe(row),
  exits: [],
  makes: row.makes ?? null,
  beyond: row.beyond ?? null,
  made: 0,
  quest: null,
  latent: false,
  opener: null,
  ...extra,
});
// The world grows as its avatars do: each new place or item needs a set
// number of levels gained across the world, so growth follows play and more
// players grow the world faster.
export function growthLeft(s) {
  const levels = Object.values(s.avatars).reduce(
    (sum, a) => sum + a.progress.program,
    0,
  );
  return (
    s.spawned < s.rules.maxSpawns &&
    s.spawned <
      s.rules.growthStart + Math.floor(levels / s.rules.levelsPerGrowth)
  );
}
function reserve(s, table) {
  s.spawned += 1;
  const id = `${table}-${s.spawned}`;
  const rows = s.tables[table];
  return { id, row: rows[choiceHash(s.seed, id) % rows.length] };
}

// Promise the next item a place will make.
function promiseItem(s, place) {
  const table = s.places[place].makes;
  if (!table || !growthLeft(s)) return null;
  const { id, row } = reserve(s, table);
  s.items[id] = { ...describe(row), holder: null, maker: place, history: [] };
  return id;
}

// Promise a place beyond this one. An unopened promise is reused, so a goal
// that is abandoned does not waste the world's growth.
export function promisePlace(s, from) {
  const waiting = Object.keys(s.places).find(
    (id) => latentPlace(s, id) && s.places[id].opener === from,
  );
  if (waiting) return waiting;
  const table = s.places[from].beyond;
  if (!table || !growthLeft(s)) return null;
  const { id, row } = reserve(s, table);
  s.places[id] = newPlace(row, { latent: true, opener: from });
  return id;
}

// Open a promised place. A claim key makes the opening happen once.
export function openPlace(s, id, by) {
  const p = s.places[id];
  if (!p?.latent) return false;
  p.latent = false;
  p.exits = [p.opener];
  s.places[p.opener].exits = [...s.places[p.opener].exits, id];
  s.claims[`${p.opener}:door:${id}`] = { turn: s.turn, created: id };
  p.quest = placeQuest(s, id);
  return { place: id, from: p.opener, by };
}

// A place's next quest: put down items found nearby, more as the place makes
// more. Items already here do not count, so a new quest is never met at once.
export function placeQuest(s, place, reward = null) {
  const p = s.places[place];
  if (!p.makes || p.latent) return null;
  const near = distances(s, place, s.rules.questRadius);
  const pool = Object.keys(s.items).filter(
    (id) =>
      !latentItem(s, id) &&
      near.has(itemPlace(s, id)) &&
      itemPlace(s, id) !== place &&
      !asleep(s, holderOf(s, id)),
  );
  const count = Math.min(s.rules.carry, 1 + Math.floor(p.made / 2));
  if (pool.length < count) return null;
  const start = choiceHash(s.seed, place, p.made) % pool.length;
  const items = [...pool.slice(start), ...pool.slice(0, start)].slice(0, count);
  reward ??= promiseItem(s, place);
  if (!reward) return null;
  return { id: `work-${place}-${p.made + 1}`, items, reward };
}
export const placeQuestMet = (s, place) =>
  Boolean(s.places[place].quest) &&
  s.places[place].quest.items.every((id) => holderOf(s, id) === place);

// After a round, each place where something happened makes its item if its
// quest is met, replaces a quest a sleeping player blocks, or finds a quest if
// it has none. Returns what was made for the log.
export function growPlaces(s, touched) {
  const made = [];
  for (const place of Object.keys(s.places)) {
    if (!touched.has(place)) continue;
    const p = s.places[place];
    if (p.quest && placeQuestMet(s, place)) {
      const { reward, items } = p.quest;
      s.items[reward].holder = place;
      s.items[reward].history = [`Turn ${s.turn}: Made at ${p.name}.`];
      p.made += 1;
      s.claims[`${place}:make:${p.made}`] = { turn: s.turn, created: reward };
      const makers = avatarOrder(s).filter(
        (id) => awake(s, id) && s.avatars[id].place === place,
      );
      made.push({ place, item: reward, items, makers });
      p.quest = placeQuest(s, place);
    } else if (
      p.quest?.items.some((id) => asleep(s, holderOf(s, id))) ||
      (!p.quest && p.makes)
    )
      p.quest = placeQuest(s, place, p.quest?.reward ?? null);
  }
  return made;
}
export const madeText = (s, { place, item }) =>
  `${nameOf(s, place)} makes a ${nameOf(s, item)}.`;

export function validPlaceQuest(s, place, q) {
  return (
    q === null ||
    (q &&
      typeof q.id === "string" &&
      Array.isArray(q.items) &&
      q.items.length >= 1 &&
      q.items.length <= s.rules.carry &&
      q.items.every((id) => s.items[id] && !latentItem(s, id)) &&
      latentItem(s, q.reward) &&
      s.items[q.reward].maker === place)
  );
}
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export function validTables(tables) {
  return (
    tables &&
    typeof tables === "object" &&
    Object.entries(tables).every(
      ([id, rows]) =>
        ID.test(id) &&
        Array.isArray(rows) &&
        rows.length >= 1 &&
        rows.every(
          (row) =>
            typeof row.name === "string" &&
            row.name.length >= 1 &&
            row.name.length <= 80 &&
            (row.text === undefined ||
              (typeof row.text === "string" && row.text.length <= 400)) &&
            (row.tags === undefined ||
              (Array.isArray(row.tags) && row.tags.every((t) => ID.test(t)))) &&
            [row.makes, row.beyond].every((t) => t === undefined || tables[t]),
        ),
    )
  );
}
