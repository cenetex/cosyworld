// Extract a pack's space graph and mission graph from its authored data.
//
// The space graph is the places and the ways between them (exits, routes,
// crossings, sea lanes). The mission graph is what the ways, residents and
// things are shut behind (flags, choices, items, acts, wants) and which acts
// set each flag. A gate is any condition that shuts something. For each gate
// this computes the full transitive set of things that can matter to it, taken
// over every alternative of every `any`.
//
// It reads the compiled pack (`v2/card-game/packs.json`, which is the card
// pack compiler's own merge of `card-world.json` and `card-bridge.json`), so
// it never re-parses the sources differently from the game. It never runs the
// game. A condition kind it does not model throws; nothing is dropped.
import { CONDITION_KINDS } from "../../v2/card-game/pack-schema.mjs";

// How each condition kind behaves. `latch` kinds read a record that is kept
// once made; `live` kinds read the world as it stands and can close again.
export const LATCH_KINDS = [
  "flag",
  "choice",
  "choice_unset",
  "met",
  "knows",
  "talked",
  "upgraded",
  "gate_open",
  "drawn",
  "home_door",
];
export const LIVE_KINDS = [
  "holding",
  "item_at",
  "item_near",
  "item_present",
  "pack_item_present",
  "tag_held",
  "ship_at",
  "daylight",
  "clock",
  "weather",
  "light",
  "sound",
  "grounded",
  "held",
  "in_hand",
  "actor_at",
  "humans_at",
  "connected_humans",
  "shared_world",
  "trusted",
  "chance",
];
const COMPOUND = ["any", "not"];

const sorted = (values) => [...new Set(values)].sort();
const list = (value) => (Array.isArray(value) ? value : []);

// Stable id of a leaf condition: its kind and fields in key order.
export const atomKey = (c) =>
  `${c.kind}(${Object.keys(c)
    .filter((k) => k !== "kind")
    .sort()
    .map((k) => `${k}=${[].concat(c[k]).join("|")}`)
    .join(",")})`;

// Plain words for a leaf condition. `L` names things: L.place, L.item, L.who.
const WORDS = {
  flag: (c) => `${c.key} ${c.value ? "is set" : "is not set"}`,
  choice: (c) => `${c.key} chosen as ${c.value}`,
  choice_unset: (c) => `${c.key} not chosen yet`,
  holding: (c, L) =>
    c.role === "actor"
      ? `the traveler holds ${L.item(c.item)}`
      : `${L.who(c.actor)} holds ${L.item(c.item)}`,
  item_at: (c, L) => `${L.item(c.item)} lies at ${L.place(c.place)}`,
  item_near: (c, L) => `${L.item(c.item)} is in ${L.place(c.place)}`,
  item_present: (c, L) => `${L.item(c.item)} is in ${L.place(c.place)}`,
  pack_item_present: (c, L) =>
    `a ${c.pack} thing is in ${L.place(c.place)}`,
  tag_held: (c, L) => `a ${c.tag} thing is held in ${L.place(c.place)}`,
  ship_at: (c, L) =>
    `${c.transport} ${c.dock === "@sea" ? "is at sea" : `is docked at ${L.place(c.dock)}`}`,
  daylight: (c) => `it is ${c.phase}`,
  clock: (c) => `the clock is between ${c.from} and ${c.to}`,
  weather: (c, L) => `${L.place(c.place)} has ${c.condition} weather`,
  light: (c, L) =>
    `${L.item(c.item)} is lit at ${c.at.map(L.place).join(" or ")}`,
  sound: (c, L) => `a sound at ${c.at.map(L.place).join(" or ")}`,
  grounded: (c, L) => `${L.item(c.item)} is on the ground`,
  held: (c) => `the traveler holds a thing (${atomKey(c)})`,
  in_hand: (c, L) => `${L.item(c.item)} is in the traveler's hand`,
  actor_at: (c, L) => `the traveler is at ${L.place(c.place)}`,
  humans_at: (c, L) => `${c.minimum} travelers at ${L.place(c.place)}`,
  connected_humans: (c) => `${c.minimum} travelers connected`,
  shared_world: () => "the world is shared",
  trusted: (c, L) => `${L.who(c.actor)} trusts the traveler (level ${c.min})`,
  met: (c, L) => `${L.who(c.actor)} has been met`,
  knows: (c) => `the traveler knows ${c.topics ? c.topics.join(" or ") : c.topic}`,
  talked: (c, L) => `the traveler has talked to ${L.who(c.person)}`,
  upgraded: (c) => `the traveler has the ${c.upgrade} upgrade`,
  gate_open: (c, L) => `the way ${L.place(c.from)} to ${L.place(c.to)} is open`,
  drawn: (c) => `${c.id} was drawn`,
  home_door: (c, L) => `${c.home} has its door at ${L.place(c.place)}`,
};

// Things a leaf condition needs done first, as mission-graph node ids.
// Negative uses (`not`, a flag wanted false) need nothing: they hold at start.
const NEEDS = {
  flag: (c) => (c.value ? [`flag:${c.key}`] : []),
  choice: (c) => [`choice:${c.key}=${c.value}`],
  holding: (c) => [`item:${c.item}`, ...(c.actor ? [`resident:${c.actor}`] : [])],
  item_at: (c) => [`item:${c.item}`, `place:${c.place}`],
  item_near: (c) => [`item:${c.item}`, `place:${c.place}`],
  item_present: (c) => [`item:${c.item}`, `place:${c.place}`],
  light: (c) => [`item:${c.item}`],
  grounded: (c) => [`item:${c.item}`],
  in_hand: (c) => [`item:${c.item}`],
  tag_held: (c) => [`place:${c.place}`],
  actor_at: (c) => [`place:${c.place}`],
  humans_at: (c) => [`place:${c.place}`],
  met: (c) => [`resident:${c.actor}`],
  trusted: (c) => [`resident:${c.actor}`],
  talked: (c) => [`resident:${c.person}`],
  knows: (c) => (c.topics || [c.topic]).map((t) => `topic:${t}`),
  gate_open: (c) => [`route:${c.from}>${c.to}`],
};

function check(kind, owner) {
  if (!CONDITION_KINDS.includes(kind))
    throw new Error(`${owner}: unknown condition kind ${JSON.stringify(kind)}`);
  if (!LATCH_KINDS.includes(kind) && !LIVE_KINDS.includes(kind) && !COMPOUND.includes(kind))
    throw new Error(
      `${owner}: condition kind "${kind}" is in the schema but scripts/lib/level-graph.mjs does not model it`,
    );
}

// Turn a condition list (all must hold) into a tree of and/or/not/atom,
// registering each leaf in `atoms`.
function treeOf(conditions, owner, atoms) {
  const one = (c) => {
    check(c?.kind, owner);
    if (c.kind === "any") return { op: "or", of: c.conditions.map(one) };
    if (c.kind === "not") return { op: "not", of: [one(c.condition)] };
    const key = atomKey(c);
    atoms.set(key, c);
    return { op: "atom", atom: key };
  };
  return { op: "and", of: list(conditions).map(one) };
}

// Atoms that the tree reads positively (not under `not`).
function positiveAtoms(tree, out = []) {
  if (tree.op === "atom") out.push(tree.atom);
  else if (tree.op !== "not") tree.of.forEach((t) => positiveAtoms(t, out));
  return out;
}
function allAtoms(tree, out = []) {
  if (tree.op === "atom") out.push(tree.atom);
  else tree.of.forEach((t) => allAtoms(t, out));
  return out;
}

export const emptyTree = (tree) => tree.op === "and" && !tree.of.length;

function wordsOfTree(tree, atoms, L) {
  if (tree.op === "atom") {
    const c = atoms.get(tree.atom);
    return WORDS[c.kind](c, L);
  }
  const parts = tree.of.map((t) => wordsOfTree(t, atoms, L));
  if (tree.op === "not") return `not (${parts[0]})`;
  if (tree.op === "or") return `(${parts.join(" or ")})`;
  return parts.join(" and ");
}

// The pack's own names first, then the forest's, so a label reads well.
export function nameLookup(packs, forest = {}) {
  const names = new Map();
  for (const section of ["places", "people", "things"])
    for (const [id, v] of Object.entries(forest[section] || {}))
      names.set(id, v.name || id);
  for (const pack of packs)
    for (const section of ["places", "avatars", "items"])
      for (const [id, v] of Object.entries(pack[section] || {}))
        names.set(id, v.name || id);
  return (id) => names.get(id) ?? id;
}

const idSlug = (id) => id.replace(/[^a-z0-9]+/giu, "-");

// Build the graph for one pack. `hub` is the card table's hub entry,
// `nameOf` resolves any id to a display name.
export function buildPackGraph(pack, hub, nameOf = (id) => id) {
  const atoms = new Map();
  const nodes = new Map(); // mission-graph node id -> { needs: [] }
  const gates = []; // everything that shuts something
  const L = { place: nameOf, item: nameOf, who: nameOf };
  const places = pack.places || {};
  const avatars = pack.avatars || {};
  const items = pack.items || {};
  const transports = pack.transports || {};
  const own = (id) => Object.hasOwn(places, id);
  const gone = (id) => own(id) && places[id].retired === true;
  const node = (id, needs = []) => {
    const n = nodes.get(id) || { needs: [] };
    n.needs.push(...needs);
    nodes.set(id, n);
  };

  // Pass 1: who writes each flag and choice.
  const flags = new Map(); // key -> { set: [], clear: [] }
  const flagOf = (key) => {
    if (!flags.has(key)) flags.set(key, { set: [], clear: [], read: [] });
    return flags.get(key);
  };
  const acts = list(pack.choices).map((c) => ({
    id: c.id,
    label: c.label,
    at: c.at,
    subject: c.subject,
    on: c.on,
    effects: list(c.effects),
    requires: list(c.requires),
  }));
  const setters = new Map(); // node id -> acts that produce it
  const produce = (target, by) => {
    if (!setters.has(target)) setters.set(target, []);
    setters.get(target).push(by);
  };
  for (const a of acts)
    for (const e of a.effects) {
      if (e.kind === "set_flag") {
        flagOf(e.key)[e.value ? "set" : "clear"].push(`act:${a.id}`);
        if (e.value) produce(`flag:${e.key}`, `act:${a.id}`);
      }
      if (e.kind === "choose") produce(`choice:${e.key}=${e.value}`, `act:${a.id}`);
      if (e.kind === "give_item") produce(`item:${e.item}`, `act:${a.id}`);
    }
  const wants = [];
  for (const [id, a] of Object.entries(avatars))
    for (const w of [a.want, ...list(a.wants).map((x) => x.want)].filter(Boolean)) {
      wants.push({
        avatar: id,
        kind: w.kind,
        target: w.target,
        to: w.to,
        items: list(w.step?.items),
        finish: w.step?.finish,
      });
      if (w.step?.finish) {
        flagOf(w.step.finish).set.push(`want:${id}`);
        produce(`flag:${w.step.finish}`, `want:${id}`);
      }
    }
  const live = (c) =>
    LIVE_KINDS.includes(c.kind) ||
    (c.kind === "flag" && flags.get(c.key)?.clear.length > 0);

  // A gate: a named condition over something shut. Returns its id, or null
  // when there is nothing to hold.
  const gated = new Set();
  const itemReaders = new Map();
  const addGate = (g, bucket = gates) => {
    const tree = treeOf(g.requires, g.id, atoms);
    const seal = g.seal || null;
    if (emptyTree(tree) && !seal && !g.always) return null;
    const keys = sorted(allAtoms(tree));
    const gate = {
      id: g.id,
      kind: g.kind,
      title: g.title,
      cond: tree,
      words: emptyTree(tree) ? "" : wordsOfTree(tree, atoms, L),
      ids: emptyTree(tree) ? "" : wordsOfTree(tree, atoms, { place: (x) => x, item: (x) => x, who: (x) => x }),
      latch: keys.filter((k) => !live(atoms.get(k))),
      live: keys.filter((k) => live(atoms.get(k))),
      ...(g.follows ? { follows: g.follows } : {}),
      ...(seal ? { seal } : {}),
    };
    gated.add(g.id);
    for (const k of keys) {
      const c = atoms.get(k);
      if (c.kind === "flag") flagOf(c.key).read.push(g.id);
      if (c.item) itemReaders.set(c.item, [...(itemReaders.get(c.item) || []), g.id]);
    }
    const needs = positiveAtoms(tree).flatMap((k) => {
      const c = atoms.get(k);
      return (NEEDS[c.kind] || (() => []))(c);
    });
    if (seal?.kind === "item") needs.push(`item:${seal.target}`, `resident:${seal.to}`);
    if (seal?.kind === "person") needs.push(`resident:${seal.target}`);
    if (seal?.kind === "place") needs.push(`place:${seal.target}`);
    if (g.node) node(g.node, [...needs, ...list(g.extraNeeds)]);
    bucket.push(gate);
    return gate.id;
  };
  const sealOf = (s) => (s?.quest ? { ...s.quest } : null);

  // Places that are hidden until a condition holds.
  const placeGate = {};
  for (const [id, p] of Object.entries(places)) {
    if (p.retired) continue;
    placeGate[id] = addGate({
      id: `place:${id}`,
      node: `place:${id}`,
      kind: "place",
      title: `${p.name} appears`,
      requires: p.requires,
    });
  }

  // Edges of the space graph.
  const edges = [];
  const retiredWays = [];
  const edge = (e) => edges.push(e);
  for (const [id, p] of Object.entries(places)) {
    if (p.retired) continue;
    for (const to of list(p.exits)) {
      if (gone(to)) continue;
      edge({ from: id, to, kind: "exit", gate: own(to) ? placeGate[to] : null });
    }
  }
  for (const r of list(pack.routes)) {
    const id = `route:${r.from}>${r.to}`;
    const requires = [...list(r.requires), ...list(r.travelerRequires)];
    const gate = addGate({
      id,
      node: id,
      kind: "route",
      title: `${nameOf(r.from)} to ${nameOf(r.to)}`,
      requires,
      seal: sealOf(r.sealed),
      follows: requires.length ? (r.live ? "live" : "latches") : undefined,
    });
    edge({ from: r.from, to: r.to, kind: "route", gate, ...(r.live ? { live: true } : {}) });
  }
  for (const c of list(pack.crossings)) {
    if (c.retired) {
      retiredWays.push(`crossing:${c.id}`);
      continue;
    }
    const gate = addGate({
      id: `crossing:${c.id}`,
      node: `crossing:${c.id}`,
      kind: "crossing",
      title: `${nameOf(c.from)} to ${nameOf(c.to)}`,
      requires: [...list(c.requires), ...list(c.unlockWhen)],
    });
    edge({
      from: c.from,
      to: c.to,
      kind: "crossing",
      gate,
      ...(c.transport ? { transport: c.transport } : {}),
    });
  }
  for (const [tid, t] of Object.entries(transports))
    for (const lane of list(t.lanes)) {
      const gate = addGate({
        id: `lane:${tid}:${lane.from}>${lane.to}`,
        node: `lane:${tid}:${lane.from}>${lane.to}`,
        kind: "lane",
        title: `${nameOf(lane.from)} to ${nameOf(lane.to)} by sea`,
        requires: lane.opensWith,
        seal: lane.sealed ? { kind: "lane" } : null,
      });
      edge({
        from: lane.from,
        to: lane.to,
        kind: "lane",
        transport: tid,
        gate,
        ...(lane.oneWay ? { oneWay: true } : {}),
      });
    }

  // Residents: where they lie and what shows them.
  for (const [id, a] of Object.entries(avatars)) {
    const g = addGate({
      id: `resident:${id}`,
      node: `resident:${id}`,
      kind: "resident",
      title: `${a.name} appears`,
      requires: [...list(a.requires), ...list(a.appearsWhen)],
    });
    if (!g) node(`resident:${id}`);
  }
  // Things: shown by `requires`, or made by a maker from other things.
  for (const [id, it] of Object.entries(items)) {
    const recipe = it.locked
      ? {
          by: it.locked.by,
          consumes: list(it.locked.consumes),
        }
      : null;
    const made = recipe
      ? [`resident:${recipe.by}`, ...recipe.consumes.map((c) => `item:${c}`)]
      : [];
    const g = addGate({
      id: `item:${id}`,
      node: `item:${id}`,
      kind: recipe ? "recipe" : "item",
      title: `${it.name} ${recipe ? "is made" : "appears"}`,
      requires: it.requires,
      always: Boolean(recipe),
      extraNeeds: [...made, ...list(setters.get(`item:${id}`))],
    });
    if (!g) node(`item:${id}`, list(setters.get(`item:${id}`)));
    if (recipe) gates.find((x) => x.id === `item:${id}`).recipe = recipe;
  }

  // Acts and the facts they write. An act needs its own conditions, its
  // subject to be there, and its place to appear.
  const actRows = [];
  for (const a of acts)
    addGate(
      {
        id: `act:${a.id}`,
        node: `act:${a.id}`,
        kind: "act",
        title: a.label,
        requires: a.requires,
        always: true,
        extraNeeds: [`resident:${a.subject}`, `place:${a.at}`],
      },
      actRows,
    );

  // Topics a traveler can learn.
  for (const t of list(pack.topics))
    addGate(
      {
        id: `topic:${t.id}`,
        node: `topic:${t.id}`,
        kind: "topic",
        title: t.id,
        requires: t.requires,
        always: true,
        extraNeeds: [`resident:${t.speaker}`, `place:${t.at}`, ...(t.choiceId ? [`act:${t.choiceId}`] : [])],
      },
      [],
    );
  for (const w of wants)
    node(`want:${w.avatar}`, [
      `resident:${w.avatar}`,
      ...w.items.map((i) => `item:${i}`),
      ...(w.kind === "place" ? [`place:${w.target}`] : []),
    ]);
  // Every flag, choice, item or produced node exists once with its producers.
  for (const [target, by] of setters) node(target, by);

  // Transitive prerequisites: everything reachable through "needs", over every
  // alternative. Only things that can be done or held are listed.
  const closure = (start) => {
    const seen = new Set();
    const stack = [...nodes.get(start).needs];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id) || id === start) continue;
      seen.add(id);
      stack.push(...(nodes.get(id)?.needs || []));
    }
    return seen;
  };
  const groups = (seen) => {
    const out = {};
    for (const id of sorted(seen)) {
      const type = id.slice(0, id.indexOf(":"));
      // A resident or place with no condition of its own adds nothing.
      if (["resident", "place"].includes(type) && !gated.has(id)) continue;
      (out[type] ||= []).push(id.slice(type.length + 1));
    }
    return out;
  };
  const withPrereqs = (g) => ({ ...g, prerequisites: groups(closure(g.id)) });
  const gateRows = gates.map(withPrereqs);
  const actOut = actRows.map((g) => {
    const a = acts.find((x) => `act:${x.id}` === g.id);
    return {
      ...withPrereqs(g),
      at: a.at,
      subject: a.subject,
      on: a.on,
      sets: sorted(a.effects.filter((e) => e.kind === "set_flag" && e.value).map((e) => e.key)),
      clears: sorted(a.effects.filter((e) => e.kind === "set_flag" && !e.value).map((e) => e.key)),
      chooses: sorted(a.effects.filter((e) => e.kind === "choose").map((e) => `${e.key}=${e.value}`)),
      gives: sorted(a.effects.filter((e) => e.kind === "give_item").map((e) => e.item)),
      retires: sorted(a.effects.filter((e) => e.kind === "retire_item").map((e) => e.item)),
    };
  });

  // Every flag with its writers, its direct readers, and what it gates
  // transitively.
  const everyGate = [...gateRows, ...actOut];
  const flagRows = {};
  for (const [key, f] of [...flags].sort(([a], [b]) => a.localeCompare(b))) {
    const behind = everyGate
      .filter((g) => g.prerequisites.flag?.includes(key))
      .map((g) => g.id);
    flagRows[key] = {
      kind: f.clear.length ? "toggle" : "latch",
      setBy: sorted(f.set),
      clearedBy: sorted(f.clear),
      readBy: sorted(f.read),
      gates: behind.filter((id) => !id.startsWith("act:")),
      acts: behind.filter((id) => id.startsWith("act:")),
    };
  }

  // Districts: the places left after taking out the roads, joined by exits and
  // routes. A road or the ship is a way between districts, not part of one.
  const kindOf = (id) =>
    !own(id) ? (hub.places?.includes(id) ? "hub" : "external") : places[id].road ? "road" : Object.values(transports).some((t) => t.place === id) ? "ship" : "place";
  const near = new Map();
  const link = (a, b) => {
    for (const [x, y] of [[a, b], [b, a]]) {
      if (!near.has(x)) near.set(x, new Set());
      near.get(x).add(y);
    }
  };
  for (const e of edges) if (e.kind === "exit" || e.kind === "route") link(e.from, e.to);
  const inDistrict = (id) => own(id) && !gone(id) && kindOf(id) === "place";
  const districts = [];
  const seen = new Set();
  for (const start of Object.keys(places).sort()) {
    if (seen.has(start) || !inDistrict(start)) continue;
    const members = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const id = stack.pop();
      members.push(id);
      for (const next of near.get(id) || [])
        if (!seen.has(next) && inDistrict(next)) {
          seen.add(next);
          stack.push(next);
        }
    }
    members.sort();
    // The best-connected place names the district.
    const [head] = [...members].sort(
      (a, b) => (near.get(b)?.size || 0) - (near.get(a)?.size || 0) || a.localeCompare(b),
    );
    districts.push({ id: `d-${idSlug(head)}`, name: nameOf(head), places: members });
  }
  districts.sort((a, b) => a.id.localeCompare(b.id));
  const districtOf = new Map(districts.flatMap((d) => d.places.map((p) => [p, d.id])));

  const reached = new Set(edges.flatMap((e) => [e.from, e.to]));
  const spaceNodes = sorted([...Object.keys(places).filter((id) => !gone(id)), ...reached]).map(
    (id) => ({
      id,
      name: nameOf(id),
      kind: kindOf(id),
      ...(districtOf.has(id) ? { district: districtOf.get(id) } : {}),
      ...(placeGate[id] ? { gate: placeGate[id] } : {}),
    }),
  );
  edges.sort((a, b) =>
    `${a.from}>${a.to}:${a.kind}`.localeCompare(`${b.from}>${b.to}:${b.kind}`),
  );

  const itemRows = Object.entries(items).map(([id, it]) => ({
    id,
    name: it.name,
    holder: it.holder,
    ...(it.home ? { home: it.home } : {}),
    consumedBy: sorted(acts.filter((a) => a.effects.some((e) => e.kind === "retire_item" && e.item === id)).map((a) => a.id)),
    readBy: sorted(itemReaders.get(id) || []),
  }));
  const bare = { place: (x) => x, item: (x) => x, who: (x) => x };
  const atomRows = Object.fromEntries(
    [...atoms]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, c]) => [k, { kind: c.kind, class: live(c) ? "live" : "latch", words: WORDS[c.kind](c, bare) }]),
  );
  // The dependency graph itself: each node and what it needs done first.
  const needs = Object.fromEntries(
    [...nodes]
      .filter(([, n]) => n.needs.length)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, n]) => [id, sorted(n.needs)]),
  );

  return {
    pack: pack.id,
    name: pack.name,
    revision: pack.revision,
    entry: pack.entry,
    entries: hub.packEntries?.[pack.id] || [],
    space: { districts, nodes: spaceNodes, edges, retired: sorted(retiredWays) },
    mission: {
      gates: gateRows,
      acts: actOut,
      wants,
      flags: flagRows,
      items: itemRows,
      needs,
    },
    atoms: atomRows,
    conditionKinds: sorted([...atoms.values()].map((c) => c.kind)),
  };
}
