// The Open Door checklist (open-door-rework.md, section G), computed from a
// compiled pack, so the same reading can be run on any revision.

// Every condition in a list, `any` and `not` opened up.
export function conditionsIn(list = [], out = []) {
  for (const c of list || []) {
    out.push(c);
    conditionsIn(c.conditions, out);
    if (c.condition) conditionsIn([c.condition], out);
  }
  return out;
}
const names = (c, key) => c.item === key;

/** Who reads a thing: locks, wants, recipes, gates, lanes and plays. */
export function readersOf(pack, key) {
  const out = new Set();
  const read = (who, list) => {
    if (conditionsIn(list).some((c) => names(c, key))) out.add(who);
  };
  for (const [id, a] of Object.entries(pack.avatars)) {
    read(`lock:${id}`, [...(a.requires || []), ...(a.appearsWhen || [])]);
    read(`pass:${id}`, a.passWhen);
    for (const w of [a.want, ...(a.wants || []).map((e) => e.want)])
      if (w && (w.target === key || w.step?.items?.includes(key)))
        out.add(`want:${id}`);
  }
  for (const [id, i] of Object.entries(pack.items)) {
    if (i.locked?.consumes.includes(key)) out.add(`recipe:${id}`);
    read(`item:${id}`, i.requires);
  }
  for (const r of pack.routes || [])
    read(`gate:${r.from}>${r.to}`, [
      ...(r.requires || []),
      ...(r.travelerRequires || []),
    ]);
  for (const t of Object.values(pack.transports || {}))
    for (const lane of t.lanes || [])
      read(`lane:${lane.from}>${lane.to}`, lane.opensWith);
  for (const c of pack.choices || []) read(`play:${c.id}`, c.requires);
  return [...out].sort();
}

const STORY = ["flag", "choice", "choice_unset"];
/** The story conditions (flags and choices) a list of conditions reads. */
export const storyConditions = (list) =>
  conditionsIn(list).filter((c) => STORY.includes(c.kind));

// How many steps must come one after another before a lock opens. Each
// thing got is a step, each play a flag waits on is a step, and the lock
// itself is the last. A person is not a step: meeting someone, or their
// making a thing, waits only on what opens them. `any` takes its quickest
// branch; meeting oneself is the latch that keeps an opened box open.
export function forcedChain(pack) {
  const memo = new Map();
  const people = pack.avatars,
    things = pack.items;
  const setters = (c) =>
    (pack.choices || []).filter((ch) =>
      (ch.effects || []).some(
        (e) =>
          e.key === c.key &&
          (c.kind === "flag" ? e.kind === "set_flag" : e.kind === "choose") &&
          e.value === c.value,
      ),
    );
  let condition, all, opener;
  const memoized = (key, fn) => {
    if (memo.has(key)) return memo.get(key);
    memo.set(key, Infinity); // a cycle is never forced
    const d = fn();
    memo.set(key, d);
    return d;
  };
  all = (list, self) =>
    Math.max(0, ...(list || []).map((c) => condition(c, self) ?? 0));
  // What opens a person, without counting the person.
  opener = (id) =>
    memoized(`person|${id}`, () =>
      all([...(people[id]?.requires || []), ...(people[id]?.appearsWhen || [])], id),
    );
  const thing = (id) =>
    memoized(`thing|${id}`, () => {
      const t = things[id];
      if (!t) return 0;
      return (
        1 +
        Math.max(
          all(t.requires, null),
          t.locked ? opener(t.locked.by) : 0,
          ...(t.locked?.consumes || []).map(thing),
        )
      );
    });
  condition = (c, self) => {
    if (c.kind === "any") {
      const options = c.conditions
        .map((x) => condition(x, self))
        .filter((x) => x !== null);
      return options.length ? Math.min(...options) : 0;
    }
    if (c.kind === "not") return 0;
    if (c.kind === "met") return c.actor === self ? null : opener(c.actor);
    if (c.item && things[c.item]) return thing(c.item);
    if (c.kind === "flag" || c.kind === "choice")
      return memoized(`story|${c.kind}|${c.key}|${c.value}`, () => {
        const ways = setters(c).map((ch) => 1 + all(ch.requires, ch.subject));
        return ways.length ? Math.min(...ways) : 0;
      });
    return 0;
  };
  return {
    lock: (id) => 1 + opener(id),
    gate: (from, to) =>
      1 +
      all(
        (pack.routes || []).find((r) => r.from === from && r.to === to)
          ?.requires,
        null,
      ),
    thing,
  };
}
