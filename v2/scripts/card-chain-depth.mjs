#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { liveWorld } from "./card-world-lint.mjs";

const list = (v) => (Array.isArray(v) ? v : []);
const FREE = { t: "free" };
const all = (...x) => ({ t: "all", x });
const any = (...x) => ({ t: "any", x });
const ref = (id) => ({ t: "ref", id });
const lost = (why) => ({ t: "lost", why });
const ITEM_KINDS = new Set(["holding", "item", "item_present", "item_near", "item_at", "light", "in_hand", "pack_item_present", "home_item_present"]);

export function chainDepth(packsJson, forest) {
  const w = liveWorld(packsJson, forest);
  const open = (pack, id) => !pack.release || list(pack.release.choices).includes(id);
  const choices = w.packs.flatMap((p) => list(p.choices).filter((c) => open(p, c.id)).map((c) => ({ ...c, pack: p.id })));
  const choiceById = Object.fromEntries(choices.map((c) => [c.id, c]));
  const nodes = new Map();
  const boxes = [];
  const edgeNeeds = [];

  const setters = (cond) =>
    choices.filter((c) =>
      list(c.effects).some((e) => e.key === cond.key && e.value === cond.value && e.kind === (cond.kind === "choice" ? "choose" : "set_flag")));
  const expr = (cond) => {
    if (!cond || typeof cond !== "object") return FREE;
    if (cond.kind === "any") return list(cond.conditions).length ? any(...list(cond.conditions).map(expr)) : FREE;
    if (ITEM_KINDS.has(cond.kind) && typeof cond.item === "string")
      return w.items[cond.item] ? ref(`item:${cond.item}`) : lost(`${cond.item} is not in the live world`);
    if (cond.kind === "flag" || cond.kind === "choice") {
      if (cond.value === false) return FREE;
      const found = setters(cond);
      return found.length ? any(...found.map((c) => ref(`choice:${c.id}`))) : lost(`${cond.kind} ${cond.key}=${cond.value} has no setter`);
    }
    return FREE;
  };
  const needs = (conds) => all(...list(conds).map(expr));

  const placeIn = new Map();
  w.edges.forEach((e, i) => {
    const box = e.gated && e.kind !== "board";
    const gate = needs([...e.gate, ...list(w.places[e.to].requires)]);
    const id = `edge:${i}`;
    nodes.set(id, { kind: box ? "box" : "free", label: `${e.from}>${e.to}`, pack: w.places[e.to].pack, expr: box ? gate : FREE });
    (placeIn.get(e.to) || placeIn.set(e.to, []).get(e.to)).push({ from: e.from, id });
    if (box) boxes.push(id);
  });
  const starts = new Set([...w.start, ...w.entries].filter((p) => w.places[p]));
  for (const p of Object.values(w.places))
    nodes.set(`place:${p.id}`, { kind: "place", pack: p.pack, into: starts.has(p.id) ? null : placeIn.get(p.id) || [] });

  const holderOf = (h) => (w.places[h] ? `place:${h}` : w.people[h] ? `person:${h}` : w.items[h] ? `item:${h}` : null);
  for (const a of Object.values(w.people)) {
    const sealed = a.sealed && list(a.requires).length;
    const id = `person:${a.id}`;
    if (sealed) {
      nodes.set(`box:${id}`, { kind: "box", label: id, pack: a.pack, expr: needs(a.requires) });
      boxes.push(`box:${id}`);
    }
    nodes.set(id, { kind: "hold", pack: a.pack, at: [a.place && w.places[a.place] ? `place:${a.place}` : null, sealed ? `box:${id}` : null].filter(Boolean) });
  }
  for (const it of Object.values(w.items)) {
    const id = `item:${it.id}`;
    const gate = it.locked ? needs(list(it.locked.consumes).map((c) => ({ kind: "item", item: c }))) : it.sealed && list(it.requires).length ? needs(it.requires) : null;
    if (gate) {
      nodes.set(`box:${id}`, { kind: "box", label: id, pack: it.pack, expr: gate });
      boxes.push(`box:${id}`);
    }
    nodes.set(id, { kind: "hold", pack: it.pack, at: [holderOf(it.holder), gate ? `box:${id}` : null].filter(Boolean) });
  }
  for (const c of choices) nodes.set(`choice:${c.id}`, { kind: "hold", pack: c.pack, own: needs(c.requires), at: [w.places[c.at] ? `place:${c.at}` : null].filter(Boolean) });

  const val = new Map([...nodes.keys()].map((k) => [k, Infinity]));
  const ev = (x) => {
    if (x.t === "free") return 0;
    if (x.t === "lost") return Infinity;
    if (x.t === "ref") return val.has(x.id) ? val.get(x.id) : Infinity;
    const v = x.x.map(ev);
    return x.t === "all" ? Math.max(0, ...v) : Math.min(...v);
  };
  const calc = (n) => {
    if (n.kind === "free") return 0;
    if (n.kind === "box") return 1 + ev(n.expr);
    if (n.kind === "place")
      return n.into === null ? 0 : Math.min(Infinity, ...n.into.map((e) => Math.max(val.get(`place:${e.from}`), val.get(e.id))));
    return Math.max(0, n.own ? ev(n.own) : 0, ...n.at.map((k) => val.get(k)));
  };
  for (let moved = true; moved; ) {
    moved = false;
    for (const [k, n] of nodes) {
      const v = calc(n);
      if (v < val.get(k)) val.set(k, v), (moved = true);
    }
  }

  const leaves = (x, out = []) => (x.t === "ref" || x.t === "lost" ? out.push(x) : x.x?.forEach((y) => leaves(y, out)), out);
  const deps = (k) => {
    const n = nodes.get(k);
    if (n.kind === "box") return leaves(n.expr).filter((l) => l.t === "ref").map((l) => l.id);
    if (n.kind === "place") return (n.into || []).flatMap((e) => [`place:${e.from}`, e.id]);
    return [...(n.own ? leaves(n.own).filter((l) => l.t === "ref").map((l) => l.id) : []), ...(n.at || [])];
  };
  const lostIn = (k) => nodes.get(k).kind === "box" && leaves(nodes.get(k).expr).some((l) => l.t === "lost");
  const lostWhy = (k) => leaves(nodes.get(k).expr).find((l) => l.t === "lost").why;
  const stuck = (k) => val.get(k) === Infinity;
  const classify = (k) => {
    if (lostIn(k)) return "mystery";
    const seen = new Set([k]), todo = [k];
    let behind = false, cycle = false;
    while (todo.length) {
      const cur = todo.pop();
      for (const d of deps(cur).filter(stuck)) {
        if (d === k) cycle = true;
        if (seen.has(d)) continue;
        seen.add(d);
        todo.push(d);
        if (lostIn(d)) behind = true;
      }
    }
    return behind ? "behind mystery" : cycle ? "cycle" : "unreached";
  };

  const trail = (k, seen = new Set()) => {
    if (seen.has(k) || !nodes.has(k) || stuck(k)) return [];
    seen.add(k);
    const n = nodes.get(k);
    const mine = n.kind === "box" ? [n.label] : [];
    const want = n.kind === "box" ? val.get(k) - 1 : val.get(k);
    const next = deps(k).filter((d) => !seen.has(d) && val.get(d) <= want).sort((a, b) => val.get(b) - val.get(a));
    const pick = n.kind === "box" || n.kind === "hold" ? next[0] : next.find((d) => val.get(d) === want) || next[0];
    return [...trail(pick, seen), ...mine];
  };

  const rows = boxes.map((k) => {
    const n = nodes.get(k);
    const mine = leaves(n.expr).filter((l) => l.t === "ref").map((l) => nodes.get(l.id)?.pack);
    return {
      id: n.label,
      pack: n.pack,
      depth: val.get(k),
      locked: leaves(n.expr).length > 0,
      cross: mine.filter((p) => p && p !== n.pack && p !== "hub").length,
      why: stuck(k) ? classify(k) : null,
      detail: stuck(k) && lostIn(k) ? lostWhy(k) : null,
      path: stuck(k) ? [] : trail(k),
    };
  });
  const sum = (name, group) => {
    const locked = group.filter((r) => r.locked);
    const done = group.filter((r) => r.depth < Infinity);
    const top = done.reduce((a, r) => (!a || r.depth > a.depth ? r : a), null);
    const spread = {};
    done.forEach((r) => (spread[r.depth] = (spread[r.depth] || 0) + 1));
    const cls = (c) => group.filter((r) => r.why === c).map((r) => r.id);
    return {
      pack: name,
      boxes: group.length,
      locked: locked.length,
      longest: top ? top.depth : 0,
      path: top ? top.path : [],
      spread,
      mystery: cls("mystery"),
      behind: cls("behind mystery"),
      cycle: cls("cycle"),
      unreached: cls("unreached"),
      cross: group.reduce((a, r) => a + r.cross, 0),
    };
  };
  const names = [...new Set(["hub", ...w.packs.map((p) => p.id)])];
  const packsOut = names.map((n) => sum(n, rows.filter((r) => r.pack === n))).filter((s) => s.boxes);
  return { packs: packsOut, all: sum("all", rows), rows };
}

export function depthReport(out, show = 5) {
  const cut = (l) => (l.length ? `${l.length}: ${l.slice(0, show).join(", ")}${l.length > show ? ` (+${l.length - show})` : ""}` : "0");
  const spread = (s) => Object.entries(s).map(([d, n]) => `${d}:${n}`).join(" ") || "-";
  const head = [
    "Card lock chain depth. It reports only and never fails the build.",
    "Depth counts boxes opened in turn: a box with free needs is 1. A gated way, a locked or sealed item, and a sealed resident are boxes.",
    "Start places and pack entries are open. A flag or choice needs the pack choice that sets it. Time, weather and social conditions are free.",
    "",
    "pack | boxes | locked | longest | spread | mystery | behind mystery | cycle | unreached | cross-pack",
  ];
  const lines = [...out.packs, out.all].map((s) =>
    [s.pack, s.boxes, s.locked, s.longest, spread(s.spread), s.mystery.length, s.behind.length, s.cycle.length, s.unreached.length, s.cross].join(" | "));
  const tail = [...out.packs, out.all].flatMap((s) => [
    "",
    `${s.pack}: longest chain ${s.path.length ? s.path.join(" -> ") : "none"}`,
    `  mystery ${cut(s.mystery)}`,
    `  behind mystery ${cut(s.behind)}`,
    `  cycle ${cut(s.cycle)}`,
  ]);
  return [...head, ...lines, ...tail].join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const read = (f) => JSON.parse(readFileSync(new URL(`../card-game/${f}`, import.meta.url), "utf8"));
  console.log(depthReport(chainDepth(read("packs.json"), read("forest.json")), process.argv.includes("--all") ? Infinity : 5));
}
