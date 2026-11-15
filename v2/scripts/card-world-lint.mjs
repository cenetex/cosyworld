#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const list = (v) => (Array.isArray(v) ? v : []);
const ids = (o) => Object.keys(o || {}).sort();

export function itemRefs(node, out = new Set()) {
  if (Array.isArray(node)) node.forEach((n) => itemRefs(n, out));
  else if (node && typeof node === "object") {
    if (typeof node.item === "string") out.add(node.item);
    list(node.items).forEach((i) => typeof i === "string" && out.add(i));
    Object.values(node).forEach((n) => itemRefs(n, out));
  }
  return out;
}

export const wantsOf = (a) =>
  [a.want, ...list(a.wants).map((w) => w.want)].filter((w) => w?.target);

export function liveWorld(packsJson, forest) {
  const hub = packsJson.hub;
  const packs = list(packsJson.packs);
  const open = (pack, kind, id) => !pack.release || list(pack.release[kind]).includes(id);
  const places = {}, people = {}, items = {}, skipped = { places: 0, people: 0, items: 0 };
  const opening = forest.opening || {}, start = forest.initialState || {};
  for (const id of list(hub.places))
    places[id] = { id, pack: "hub", exits: list(forest.places?.[id]?.exits), hub: true };
  for (const id of list(hub.avatars)) {
    const p = forest.people?.[id] || {};
    const place = opening.actors?.[id]?.place || start.actors?.[id]?.place || p.place;
    people[id] = { ...p, id, pack: "hub", place };
  }
  for (const id of list(hub.items))
    items[id] = { ...forest.things?.[id], id, pack: "hub", holder: opening.items?.[id]?.holder || start.items?.[id]?.holder };
  const fold = {};
  for (const pack of packs)
    for (const [id, pl] of Object.entries(pack.places || {})) {
      if (pl.retired) fold[id] = pl.road ? pl.road[0] : pl.exits[0];
      else if (!open(pack, "places", id)) skipped.places++;
      else places[id] = { ...pl, id, pack: pack.id, exits: list(pl.exits) };
    }
  const at = (id) => (fold[id] && fold[id] !== id ? at(fold[id]) : id);
  for (const pack of packs) {
    for (const [id, a] of Object.entries(pack.avatars || {}))
      if (open(pack, "avatars", id)) people[id] = { ...a, id, pack: pack.id, place: at(a.place) };
      else skipped.people++;
    for (const [id, it] of Object.entries(pack.items || {}))
      if (open(pack, "items", id)) items[id] = { ...it, id, pack: pack.id, holder: at(it.holder) };
      else skipped.items++;
  }
  const edges = [];
  const link = (from, to, gate, kind) => {
    [from, to] = [at(from), at(to)];
    if (places[from] && places[to] && from !== to)
      edges.push({ from, to, kind, gated: list(gate).length > 0 || list(places[to].requires).length > 0, gate: list(gate) });
  };
  for (const p of Object.values(places)) p.exits.forEach((to) => link(p.id, to, [], "exit"));
  for (const r of list(forest.reflectionRoutes)) link(r.from, r.to, r.requires, "route");
  for (const pack of packs) {
    for (const r of list(pack.routes)) link(r.from, r.to, r.requires, "route");
    for (const c of list(pack.crossings))
      if (!c.retired) link(c.from, c.to, [...list(c.requires), ...list(c.unlockWhen)], "crossing");
    for (const t of Object.values(pack.transports || {}))
      for (const l of list(t.lanes)) {
        link(l.from, t.place, ["docked"], "board");
        link(t.place, l.to, l.opensWith, "lane");
      }
  }
  const entries = new Set(Object.values(hub.packEntries || {}).flat().map((e) => e.arrive));
  packs.forEach((p) => entries.add(p.entry));
  const player = people[hub.player]?.place || hub.start;
  return { packs, hub, places, people, items, edges, entries, skipped, start: [player, hub.start], at };
}

function graph(w) {
  const out = {}, und = {};
  for (const id of ids(w.places)) (out[id] = new Set()), (und[id] = new Set());
  for (const e of w.edges) out[e.from].add(e.to), und[e.from].add(e.to), und[e.to].add(e.from);
  return { out, und };
}

function reach(next, from, limit = Infinity) {
  const dist = new Map(from.map((f) => [f, 0]));
  const queue = [...from];
  while (queue.length) {
    const p = queue.shift();
    if (dist.get(p) >= limit) continue;
    for (const n of next[p] || []) if (!dist.has(n)) dist.set(n, dist.get(p) + 1), queue.push(n);
  }
  return dist;
}

function bridgeLeaves(und) {
  const disc = {}, low = {}, onCycle = new Set();
  let time = 0;
  const dfs = (u, parent) => {
    disc[u] = low[u] = time++;
    for (const v of und[u]) {
      if (v === parent) continue;
      if (disc[v] === undefined) {
        dfs(v, u);
        low[u] = Math.min(low[u], low[v]);
        if (low[v] <= disc[u]) onCycle.add(u).add(v);
      } else if (disc[v] < disc[u]) (low[u] = Math.min(low[u], disc[v])), onCycle.add(u).add(v);
    }
  };
  ids(und).forEach((u) => disc[u] === undefined && dfs(u, null));
  return ids(und).filter((u) => !onCycle.has(u));
}

export const unconditional = (e) => !list(e?.requires).length && !e?.sealed && !e?.startsUsed;
export const whereIs = (w, id) =>
  w.places[id] ? id : w.items[id] ? whereIs(w, w.items[id].holder) : w.people[id]?.place;
export const allWants = (w) =>
  Object.values(w.people).flatMap((a) => wantsOf(a).map((want) => ({ a, want })));
export const lockList = (w) => [
  ...w.edges.filter((e) => e.gated && e.kind !== "board").map((e) => ({ id: `${e.from}>${e.to}`, pack: w.places[e.to].pack, packs: [w.places[e.from].pack, w.places[e.to].pack], items: itemRefs(e.gate), to: e.to })),
  ...Object.values(w.items).filter((i) => i.locked).map((i) => ({ id: i.id, pack: i.pack, items: new Set(list(i.locked.consumes)), to: whereIs(w, i.id) })),
];

export function uses(w, wants = allWants(w), locks = lockList(w)) {
  const wanted = new Set(wants.flatMap(({ want }) => [want.target, ...list(want.step?.items)]));
  Object.values(w.items).forEach((i) => list(i.locked?.consumes).forEach((c) => wanted.add(c)));
  const gating = new Set(locks.flatMap((l) => [...l.items]));
  Object.values(w.items).filter((i) => i.refuels).forEach((i) => gating.add(i.id));
  w.packs.flatMap((p) => list(p.choices)).forEach((c) => itemRefs(c.requires, gating));
  Object.values(w.people).forEach((a) => itemRefs([a.requires, a.sealed], gating));
  return { wanted, gating };
}

export function lintWorld(w) {
  const { out, und } = graph(w);
  const reached = new Set(reach(out, w.start.filter((s) => w.places[s])).keys());
  const live = (p) => reached.has(p);
  const where = (id) => whereIs(w, id);
  const findings = [];
  const flag = (rule, text, list = [], bad = list.length > 0) => findings.push({ rule, text, list, bad });
  const people = Object.values(w.people).filter((a) => live(a.place));
  const wants = allWants(w).filter(({ a }) => live(a.place));
  const locks = lockList(w);
  const { wanted, gating } = uses(w, wants, locks);
  const valued = new Set(Object.values(w.people).flatMap((a) => ids(a.values)));

  flag("L1 Loop", "places on no loop", bridgeLeaves(und).filter(live));
  const entryPacks = Object.entries(w.hub.packEntries || {});
  flag("L2 Entries", "packs with fewer than 2 entries or only hub entries",
    entryPacks.filter(([, e]) => e.length < 2 || e.every((x) => x.joins === "hub")).map(([p]) => p));
  const jumps = w.edges.filter((e) => {
    const [a, b] = [w.places[e.from], w.places[e.to]];
    return a.pack !== b.pack && !a.hub && !b.hub && !w.entries.has(e.from);
  });
  flag("L3 Jump", jumps.length ? `${jumps.length} links skip a pack (ok)` : "no link joins one pack's deep place to another pack", [], !jumps.length);
  flag("L4 Midpoint", "lost characters whose home is a leaf",
    people.filter((a) => a.home && a.home !== a.place && w.places[a.home] && und[a.home].size < 2).map((a) => a.id));
  flag("L5 No short circuit", "locks you can walk around in 2 hops", locks.filter((l) => l.id.includes(">")).filter((l) => {
    const [from, to] = l.id.split(">");
    const open = {};
    for (const e of w.edges) if (!e.gated && `${e.from}>${e.to}` !== l.id) (open[e.from] ||= []).push(e.to);
    return reach(open, [from], 2).has(to);
  }).map((l) => l.id));
  const keyLocks = {};
  locks.forEach((l) => l.items.forEach((i) => (keyLocks[i] ||= []).push(l)));
  flag("L6 Master key", "keys that open several locks all in one pack",
    ids(keyLocks).filter((k) => keyLocks[k].length > 1 && new Set(keyLocks[k].map((l) => l.pack)).size < 2));
  flag("L7 Leads out", "reachable places with no way out", [...reached].filter((p) => !out[p].size).sort());

  const named = (id) => (w.places[id] || w.items[id] || w.people[id])?.name;
  const topics = w.packs.flatMap((p) => list(p.topics));
  const paths = {};
  for (const { a, want } of wants) {
    const t = want.target, name = named(t) || t, src = new Map();
    const at = where(t);
    if (at && live(at)) src.set(`seen:${at}`, unconditional(w.items[t] || w.people[t] || w.places[t]));
    topics.filter((x) => x.text?.includes(name)).forEach((x) => src.set(`topic:${x.id}`, !list(x.requires).length));
    wants.filter((o) => o.a.id !== a.id && o.want.target === t).forEach((o) => src.set(`wants:${o.a.id}`, unconditional(o.a)));
    locks.filter((l) => l.items.has(t)).forEach((l) => src.set(`lock:${l.id}`, false));
    paths[`${a.id}>${t}`] = { count: src.size, core: [...src.values()].some(Boolean) };
  }
  const pathList = ids(paths);
  flag("Three paths", `want targets with fewer than 3 discovery paths (${pathList.length} wants checked)`,
    pathList.filter((k) => paths[k].count < 3).map((k) => `${k}:${paths[k].count}`));
  flag("L8 Core lead", "wants with no lead that is always there", pathList.filter((k) => !paths[k].core));
  flag("L9 Seal relevance", "locks that ask for another pack's items", locks.flatMap((l) =>
    [...l.items].filter((i) => w.items[i] && ![...(l.packs || [l.pack]), "hub"].includes(w.items[i].pack)).map((i) => `${l.id} needs ${i}`)));
  const stock = w.packs.map((p) => {
    const mine = (o) => Object.values(o).filter((x) => x.pack === p.id);
    const its = mine(w.items), folk = mine(w.people), pl = mine(w.places);
    const exits = new Set(w.edges.filter((e) => w.places[e.from].pack === p.id && w.places[e.to].pack !== p.id).map((e) => e.to));
    const miss = [
      its.some((i) => wanted.has(i.id)) || "worth taking",
      folk.some((a) => a.temperament || a.standoffs !== false) || "danger",
      exits.size >= 2 || "two exits",
      folk.length > 0 || "resident",
      its.some((i) => gating.has(i.id) && !wanted.has(i.id)) || "unclear use",
      [...its, ...folk, ...pl].some((x) => !unconditional(x)) || "hidden card",
    ].filter((m) => m !== true);
    return miss.length ? `${p.id}: ${miss.join(", ")}` : null;
  });
  flag("L10 Region stock", "packs missing a stock kind", stock.filter(Boolean));
  const visible = {};
  Object.values(w.items).filter((i) => w.places[i.holder] && unconditional(i)).forEach((i) => (visible[i.holder] ||= []).push(i.id));
  const cap = (p) => (w.places[p].hub || w.entries.has(p) ? 3 : 2);
  flag("L11 Density", "places over the visible item cap at start",
    ids(visible).filter((p) => live(p) && visible[p].length > cap(p)).map((p) => `${p}:${visible[p].length}`));
  const wantable = (i) => wanted.has(i) || valued.has(i);
  flag("L11 Density", "places over the visible wantable item cap at start",
    ids(visible).filter((p) => live(p) && visible[p].filter(wantable).length > cap(p)).map((p) => `${p}:${visible[p].filter(wantable).length}`));
  const holding = ids(visible).filter((p) => live(p) && visible[p].some(wantable)).length;
  flag("L11 Density", `${holding} of ${reached.size} reachable places show a wantable item (target about 1 in 4)`);
  flag("Dead items", "items wanted by nobody that gate nothing",
    ids(w.items).filter((i) => !wanted.has(i) && !gating.has(i) && live(where(i))));
  flag("Own wants", "wants that point at the resident's own place or held item",
    wants.filter(({ a, want }) => !list(want.step?.items).length && (want.target === a.place || w.items[want.target]?.holder === a.id))
      .map(({ a, want }) => `${a.id}>${want.target}`));
  const met = wants.filter(({ want }) => live(where(want.target)));
  flag("L12 Some reachable", met.length ? `${met.length} wants have a reachable target (ok)` : "no want target is reachable from the start", [], !met.length);
  flag("L13 Map scale", "places with more than 3 links", ids(und).filter((p) => live(p) && und[p].size > 3).map((p) => `${p}:${und[p].size}`));
  return { findings, reached: reached.size };
}

export function report(w, { findings, reached }, show = 6) {
  const head = [
    "Card world lint. It flags only and never fails the build.",
    `It checks what live play can reach at the start: ${reached} of ${ids(w.places).length} live places from ${w.start[0]}.`,
    `Unreleased content is left out, as live play hides it: ${w.skipped.places} places, ${w.skipped.people} residents, ${w.skipped.items} items. Retired places fold into their ends.`,
    "",
  ];
  const lines = findings.map(({ rule, text, list: l, bad }) =>
    `${bad ? "FLAG" : " ok "} ${rule}: ${l.length ? `${l.length} ${text}: ${l.slice(0, show).join(", ")}${l.length > show ? ` (+${l.length - show})` : ""}` : text}`);
  return [...head, ...lines].join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const read = (f) => JSON.parse(readFileSync(new URL(`../card-game/${f}`, import.meta.url), "utf8"));
  const w = liveWorld(read("packs.json"), read("forest.json"));
  console.log(report(w, lintWorld(w), process.argv.includes("--all") ? Infinity : 6));
}
