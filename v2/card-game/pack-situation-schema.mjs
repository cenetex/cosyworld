// Personal quest situations a pack declares as data. Each template names its
// steps as hands of held items, one place and the people present. Roles pick
// real entities when a resident starts a new purpose; situations.mjs turns
// the result into an ordinary saved program. Unknown references fail here.

export const SITUATION_LIMIT = 16;
// The same kinds the hub situations use, so hopes count them alike.
export const SITUATION_KINDS = ["delivery", "gathering", "crossing", "answer"];
export const SITUATION_TAKERS = ["visitors"];
// Quest hand conditions from situations.mjs. Light and sound use hub items.
export const SITUATION_CONDITIONS = [
  "heldBy",
  "knows",
  "together",
  "lit",
  "ringing",
  "covered",
];

const record = (v) => v && typeof v === "object" && !Array.isArray(v);
const idOk = (v) => typeof v === "string" && /^[a-z][a-z0-9-]{0,79}$/.test(v);
const roleOk = (v) => typeof v === "string" && /^[a-z][a-z0-9]{0,23}$/.test(v);
const textOk = (v, max) =>
  typeof v === "string" &&
  v.trim().length > 0 &&
  v.length <= max &&
  !/[\u0000-\u001f{}]/.test(v);
const keysOk = (o, allowed) =>
  record(o) && Object.keys(o).every((k) => allowed.includes(k));
const listOk = (v, min, max) =>
  Array.isArray(v) &&
  v.length >= min &&
  v.length <= max &&
  new Set(v).size === v.length;

// Role specs: exactly one field each.
const ROLE_FIELDS = {
  item: "item",
  avatar: "avatar",
  place: "place",
  holder: "avatar",
  placeOf: "place",
};

/**
 * Validate a pack's `situations`. `requirements(list, what)` checks pack
 * conditions for feasibility with the pack's own closed vocabulary.
 */
export function situationProblems(pack, hub, requirements = () => {}) {
  if (pack?.situations === undefined) return [];
  const problems = [];
  const check = (ok, message) => {
    if (!ok) problems.push(`${pack.id}: ${message}`);
    return ok;
  };
  if (
    !check(
      Array.isArray(pack.situations) &&
        pack.situations.length <= SITUATION_LIMIT &&
        pack.situations.every(record),
      `situations must be a list of at most ${SITUATION_LIMIT} records`,
    )
  )
    return problems;
  const own = (field) => Object.keys(record(pack[field]) ? pack[field] : {});
  const literals = {
    item: [...own("items"), ...(hub?.items || [])],
    avatar: [...own("avatars"), ...(hub?.avatars || [])],
    place: [...own("places"), ...(hub?.places || [])],
  };
  const topics = new Set((pack.topics || []).map((t) => t?.id));
  const ids = new Set();
  for (const t of pack.situations) {
    const what = `situation ${typeof t.id === "string" ? t.id : "template"}`;
    if (
      !check(
        keysOk(t, [
          "id",
          "kind",
          "name",
          "purpose",
          "takers",
          "requires",
          "roles",
          "steps",
          "consequence",
        ]) &&
          idOk(t.id) &&
          !ids.has(t.id) &&
          SITUATION_KINDS.includes(t.kind) &&
          textOk(t.name, 100) &&
          textOk(t.purpose, 200),
        `${what} needs a unique id, a known kind, a name and a purpose`,
      )
    )
      continue;
    ids.add(t.id);
    check(
      listOk(t.takers, 1, 8) &&
        t.takers.every(
          (id) => SITUATION_TAKERS.includes(id) || literals.avatar.includes(id),
        ),
      `${what} takers must name visitors or known avatars`,
    );
    requirements(t.requires, `${what} requires`);
    // Roles resolve in declaration order; a later role may name an earlier one.
    const roles = {};
    const roleList = record(t.roles) ? Object.entries(t.roles) : null;
    if (
      !check(
        roleList && roleList.length <= 8,
        `${what} roles must be a map of at most eight roles`,
      )
    )
      continue;
    for (const [name, spec] of roleList) {
      const fields = record(spec) ? Object.keys(spec) : [];
      const field = fields[0];
      const type = ROLE_FIELDS[field];
      let ok = roleOk(name) && fields.length === 1 && Boolean(type);
      if (ok && ["item", "avatar", "place"].includes(field))
        ok =
          listOk(spec[field], 1, 6) &&
          spec[field].every((id) => literals[field].includes(id));
      else if (ok && field === "holder")
        ok = roles[ref(spec.holder)] === "item";
      else if (ok && field === "placeOf")
        ok = ["item", "avatar"].includes(roles[ref(spec.placeOf)]);
      if (check(ok, `${what} role ${name} must name known entities or roles`))
        roles[name] = type;
    }
    check(
      roles.partner === "avatar",
      `${what} needs a partner role that names an avatar`,
    );
    const resolves = (value, type) =>
      typeof value === "string" &&
      (value.startsWith("$")
        ? roles[value.slice(1)] === type
        : literals[type].includes(value));
    let items = 0,
      avatars = 0,
      changes = 0;
    const handOk = (h) => {
      if (
        !keysOk(h, ["hold", "at", "with", "conditions"]) ||
        !resolves(h.at, "place") ||
        (h.hold !== undefined &&
          !(
            listOk(h.hold, 1, 3) && h.hold.every((v) => resolves(v, "item"))
          )) ||
        (h.with !== undefined &&
          !(
            listOk(h.with, 1, 2) && h.with.every((v) => resolves(v, "avatar"))
          )) ||
        (h.conditions !== undefined &&
          !(Array.isArray(h.conditions) && h.conditions.length <= 3))
      )
        return false;
      items += h.hold?.length || 0;
      avatars += h.with?.length || 0;
      return (h.conditions || []).every((c) => {
        changes += 1;
        switch (record(c) && c.kind) {
          case "heldBy":
            items += 1;
            avatars += 1;
            return (
              keysOk(c, ["kind", "item", "avatar"]) &&
              resolves(c.item, "item") &&
              resolves(c.avatar, "avatar")
            );
          case "knows":
            return keysOk(c, ["kind", "topic"]) && topics.has(c.topic);
          case "together":
            avatars += 2;
            return (
              keysOk(c, ["kind", "avatars"]) &&
              listOk(c.avatars, 2, 2) &&
              c.avatars.every((v) => resolves(v, "avatar"))
            );
          case "lit":
            return keysOk(c, ["kind", "item"]) && c.item === "lamp";
          case "ringing":
            return keysOk(c, ["kind", "item"]) && c.item === "bell";
          case "covered":
            return (
              keysOk(c, ["kind", "item"]) && ["lamp", "bell"].includes(c.item)
            );
          default:
            return false;
        }
      });
    };
    check(
      Array.isArray(t.steps) &&
        t.steps.length >= 1 &&
        t.steps.length <= 4 &&
        t.steps.every((step) =>
          record(step) && step.any !== undefined
            ? keysOk(step, ["any"]) &&
              Array.isArray(step.any) &&
              step.any.length >= 2 &&
              step.any.length <= 4 &&
              step.any.every(handOk)
            : handOk(step),
        ),
      `${what} steps must be one to four hands with a place, known items, people and conditions`,
    );
    if (t.consequence !== undefined) {
      changes += 1;
      check(
        keysOk(t.consequence, ["kind", "avatar"]) &&
          t.consequence.kind === "trust" &&
          resolves(t.consequence.avatar, "avatar"),
        `${what} consequence must be trust with a known avatar`,
      );
    }
    check(
      items > 0 && avatars > 0 && changes > 0,
      `${what} needs an item, a person and a condition or consequence`,
    );
  }
  return problems;
}
function ref(value) {
  return typeof value === "string" && value.startsWith("$")
    ? value.slice(1)
    : null;
}
