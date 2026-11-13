import { conditionMet, runHash } from "../pack-rules.mjs";
import { joinWants, wantWords } from "../world/want-words.mjs";

export const ROLE_KINDS = { resident: "actors", item: "items", place: "locations" };

export function resolve(value, binding) {
  if (typeof value === "string")
    return value.startsWith("$") ? (binding[value.slice(1)] ?? value) : value;
  if (Array.isArray(value)) return value.map((v) => resolve(v, binding));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [key, resolve(v, binding)]),
  );
}

const fits = (entry, match) =>
  Object.entries(match).every(([key, want]) =>
    Array.isArray(want) ? want.includes(entry[key]) : entry[key] === want,
  );

function happened(journal, c, before = Infinity) {
  return journal.some(
    (e) =>
      !e.generated &&
      e.seq < before &&
      fits(e, c.match) &&
      !(c.absent || []).some((id) => e.cast?.includes(id)) &&
      !(c.without || []).some((key) => e[key] !== undefined) &&
      (!c.after || happened(journal, c.after, e.seq)),
  );
}

export function holds(world, condition, binding = {}, journal = world.log || []) {
  const c = resolve(condition, binding);
  const each = (r) => holds(world, r, binding, journal);
  switch (c.kind) {
    case "all":
      return c.conditions.every(each);
    case "any":
      return c.conditions.some(each);
    case "not":
      return !each(c.condition);
    case "wants": {
      const want = world.actors[c.actor]?.want;
      return Boolean(
        want &&
          (c.target === undefined || want.target === c.target) &&
          (c.want === undefined || want.kind === c.want),
      );
    }
    case "event":
      return happened(journal, c);
    default:
      return conditionMet(world, c, null, null, binding.traveler ?? null);
  }
}

export function instances(pattern, world, fixed = {}, ids = null) {
  const pool = ids ?? ((kind) => Object.keys(world[ROLE_KINDS[kind]] || {}));
  const found = [];
  const fill = (index, binding) => {
    const role = pattern.roles[index];
    if (!role) return found.push(binding);
    const taken = Object.values(binding);
    for (const id of [...pool(role.kind)].sort()) {
      if (taken.includes(id)) continue;
      const next = { ...binding, [role.name]: id };
      if ((role.where || []).every((c) => holds(world, c, next)))
        fill(index + 1, next);
    }
  };
  fill(0, { ...fixed });
  return found;
}

export function bind(pattern, world, seed = world.run?.seed ?? 0, fixed = {}, ids) {
  const run = { run: { seed } };
  const ranked = instances(pattern, world, fixed, ids)
    .map((binding) => {
      const key = pattern.roles.map((role) => binding[role.name]).join("|");
      return { binding, key, rank: runHash(run, `arcana:${pattern.id}:${key}`) };
    })
    .sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key))
    .map((entry) => entry.binding);
  return ranked.length
    ? { bound: true, binding: ranked[0], instances: ranked }
    : { bound: false, binding: null, instances: [], reason: "no instance in this world" };
}

export function proved(pattern, binding, world, journal = world.log || []) {
  if (!binding) return { proved: false, failed: "unbound" };
  const failed = pattern.proof.find((c) => !holds(world, c.when, binding, journal));
  return { proved: !failed, failed: failed?.name ?? null };
}

export function lockWords(pattern, binding, known = () => true, cards = null) {
  const say = (want) => {
    const words = wantWords(want, known, cards ? { cards } : {});
    return words[0].toUpperCase() + words.slice(1);
  };
  return joinWants(resolve(pattern.desire, binding), say);
}
