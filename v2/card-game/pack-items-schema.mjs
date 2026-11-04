// Pack checks for things that are used up and come back (rules 95). Beyond
// field shapes, this proves the loops cannot strand a world: a thing that is
// used up and still needed elsewhere renews, a spending lane has a free way
// back, and a repeating give is fed only by things that renew.
const REGROW_EVENTS = ["dawn", "dusk", "rest"];
const CUSTODY = ["holding", "item_near", "item_at", "item_present"];
const record = (v) => v && typeof v === "object" && !Array.isArray(v);
const owns = (o, key) =>
  record(o) && typeof key === "string" && Object.hasOwn(o, key);
const idOk = (v) => typeof v === "string" && /^[a-z][a-z0-9-]{0,79}$/.test(v);

// Every thing a condition list names by custody, nested ones too.
export function custodyItems(conditions = []) {
  const out = [];
  for (const c of Array.isArray(conditions) ? conditions : []) {
    if (CUSTODY.includes(c?.kind)) out.push(c.item);
    if (c?.kind === "any") out.push(...custodyItems(c.conditions));
    if (c?.kind === "not") out.push(...custodyItems([c.condition]));
  }
  return out;
}

export function itemCycleProblems(pack, mountedPlaces = [], hubPlaces = []) {
  const problems = [];
  const check = (ok, message) => {
    if (!ok) problems.push(`${pack.id}: ${message}`);
  };
  const items = record(pack.items) ? pack.items : {};
  const places = record(pack.places) ? pack.places : {};
  const choices = Array.isArray(pack.choices) ? pack.choices : [];
  const drops = (id) =>
    choices.filter((c) =>
      (c.effects || []).some((e) => e.kind === "drop_item" && e.item === id),
    );
  // A thing renews when it has a home (regrowing there, made there again,
  // or, rules 102, sent straight back there once used), or when a repeating
  // give makes it from things that renew.
  const renews = (id, seen = new Set()) => {
    const thing = items[id];
    if (!thing || seen.has(id)) return false;
    if (thing.home) return true;
    return drops(id).some(
      (c) =>
        c.repeats &&
        c.effects
          .filter((e) => e.kind === "retire_item")
          .every((e) => renews(e.item, new Set([...seen, id]))),
    );
  };

  for (const [id, i] of Object.entries(items)) {
    // Rules 102: a food goes home once eaten; a crafted thing waits there
    // locked until its maker, a resident of the pack, consumes its set.
    check(
      !["food", "drink"].some((tag) => i.tags?.includes(tag)) ||
        owns(places, i.home),
      `item ${id} is food or drink, so it needs a home to go back to`,
    );
    const lock = i.locked;
    if (lock !== undefined)
      check(
        record(lock) &&
          Object.keys(lock).length === 2 &&
          owns(pack.avatars, lock.by) &&
          owns(places, i.home) &&
          Array.isArray(lock.consumes) &&
          lock.consumes.length >= 1 &&
          lock.consumes.length <= 3 &&
          new Set(lock.consumes).size === lock.consumes.length &&
          lock.consumes.every((c) => c !== id && owns(places, items[c]?.home)),
        `item ${id} locked needs a maker of the pack, a home and homed things it consumes`,
      );
    if (
      i.home === undefined &&
      i.regrow === undefined &&
      !i.startsUsed &&
      !i.locked &&
      i.absentReturn === undefined
    )
      continue;
    check(
      (i.home === undefined || owns(places, i.home)) &&
        (i.regrow === undefined ||
          (REGROW_EVENTS.includes(i.regrow) && i.home !== undefined)) &&
        (i.startsUsed === undefined || i.startsUsed === true) &&
        (i.absentReturn === undefined ||
          (i.absentReturn === true && i.home !== undefined)) &&
        // A thing may start in someone's hands and be homed elsewhere
        // (rules 102); one that rests used up rests in a place.
        (owns(places, i.holder) ||
          (owns(pack.avatars, i.holder) &&
            !i.regrow &&
            !i.startsUsed &&
            !i.locked)),
      `item ${id} home, regrow and startsUsed need a place of the pack to rest at`,
    );
    check(
      !i.startsUsed ||
        i.regrow !== undefined ||
        i.locked !== undefined ||
        drops(id).length > 0,
      `item ${id} starts used up but nothing brings it into play`,
    );
  }

  for (const c of choices) {
    if (c.repeats === undefined) continue;
    const effects = Array.isArray(c.effects) ? c.effects : [];
    const made = effects.filter((e) => e.kind === "drop_item");
    check(
      c.repeats === true &&
        c.on === "give" &&
        made.length === 1 &&
        Boolean(items[made[0]?.item]?.home) &&
        effects.every((e) =>
          ["retire_item", "drop_item", "set_flag"].includes(e.kind),
        ),
      `choice ${c.id} repeats only as a give that drops one homed thing`,
    );
    for (const e of effects.filter((e) => e.kind === "retire_item"))
      check(
        renews(e.item),
        `choice ${c.id} repeats, so its ${e.item} must renew or the loop stops`,
      );
  }

  // A used-up thing still needed by another choice, a route, a lane or a
  // resident must come back.
  const needs = [
    ...choices.map((c) => ({ by: c.id, items: custodyItems(c.requires) })),
    ...(pack.routes || []).map((r) => ({
      by: `${r.from}>${r.to}`,
      items: custodyItems(r.requires),
    })),
    ...Object.values(pack.transports || {}).flatMap((t) =>
      (t.lanes || []).map((l) => ({
        by: `${l.from}>${l.to}`,
        items: custodyItems(l.opensWith),
      })),
    ),
    ...Object.entries(pack.avatars || {}).map(([id, a]) => ({
      by: id,
      items: custodyItems(a.stayUntil),
    })),
  ];
  for (const c of choices)
    for (const e of (c.effects || []).filter((e) => e.kind === "retire_item"))
      check(
        renews(e.item) ||
          !needs.some((n) => n.by !== c.id && n.items.includes(e.item)),
        `item ${e.item} is used up by ${c.id} but still needed, so it must renew`,
      );

  for (const [id, t] of Object.entries(pack.transports || {}))
    for (const lane of Array.isArray(t?.lanes) ? t.lanes : []) {
      if (lane.spends === undefined) continue;
      const cargo = custodyItems(lane.opensWith).filter((i) => items[i]);
      check(
        lane.spends === true &&
          lane.oneWay === true &&
          Array.isArray(lane.opensWith) &&
          t.lanes.some(
            (back) =>
              back.from === lane.to &&
              back.to === lane.from &&
              back.opensWith === undefined,
          ),
        `transport ${id} lane ${lane.from}>${lane.to} spends, so it is one-way with a free way back`,
      );
      for (const item of cargo)
        check(
          renews(item),
          `transport ${id} lane ${lane.from}>${lane.to} spends ${item}, which must renew`,
        );
    }

  const kits = pack.kits === undefined ? [] : pack.kits;
  check(Array.isArray(kits) && kits.length <= 4, "kits must be a short list");
  const known = new Set([
    ...Object.keys(places),
    ...mountedPlaces,
    ...hubPlaces,
  ]);
  const kitIds = new Set(),
    kitItems = new Set();
  for (const kit of Array.isArray(kits) ? kits : []) {
    const ok =
      record(kit) &&
      Object.keys(kit).every((k) =>
        ["id", "items", "places", "on", "requires"].includes(k),
      ) &&
      idOk(kit.id) &&
      !kitIds.has(kit.id) &&
      REGROW_EVENTS.includes(kit.on) &&
      Array.isArray(kit.items) &&
      kit.items.length >= 1 &&
      kit.items.length <= 12 &&
      kit.items.every(
        (i) =>
          Boolean(items[i]?.home) && !kitItems.has(i) && !items[i].startsUsed,
      ) &&
      new Set(kit.items).size === kit.items.length &&
      Array.isArray(kit.places) &&
      kit.places.length >= 1 &&
      kit.places.length <= 16 &&
      new Set(kit.places).size === kit.places.length &&
      kit.places.every((p) => known.has(p));
    check(
      ok,
      `kit ${kit?.id} needs homed things of the pack, known places and an event`,
    );
    if (!ok) continue;
    kitIds.add(kit.id);
    for (const i of kit.items) kitItems.add(i);
  }
  return problems;
}
