#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import "../card-game/pack-registry.mjs";
import { runHash } from "../card-game/pack-rules.mjs";
import { liveWorld, uses, unconditional, whereIs, wantsOf } from "./card-world-lint.mjs";

const RANKS = ["Troublesome", "Dangerous", "Formidable", "Epic"];
const KIND_OF = { serenity: "person", protection: "person", reputation: "person", knowledge: "item", equipment: "item", wealth: "item", comfort: "item", ability: "item", conquest: "item" };
const WEIGHTS = { item: 6, person: 5, place: 2 };

export function neverBackSet(w) {
  const gone = new Set(), back = new Set();
  for (const c of w.packs.flatMap((p) => p.choices || [])) {
    if (c.on === "depart") gone.add(c.subject);
    for (const e of c.effects || []) (e.kind === "retire_item" ? gone : e.kind === "place_item" ? back : new Set()).add(e.item);
  }
  return new Set([...gone].filter((id) => !back.has(id) && !(w.items[id]?.home && w.items[id]?.regrow)));
}

function pools(w, packs, tags) {
  return Object.fromEntries(packs.map((p) => {
    const t = tags[p] || {};
    const mine = (o, kind) => (t[kind] || Object.keys(o)).filter((id) => o[id]?.pack === p).sort();
    return [p, {
      residents: mine(w.people, "residents").filter((id) => id !== w.hub.player),
      things: mine(w.items, "things"),
      places: mine(w.places, "places").filter((id) => !w.places[id].road),
      motivations: t.motivations || {},
      crossings: (t.crossings || []).filter((c) => packs.includes(c)),
    }];
  }));
}

export function generateChains(w, { seed, packs, depth = 2, count = 3, tags = {} }) {
  const s = { run: { seed } };
  const pick = (arr, key) => (arr.length ? arr[runHash(s, key) % arr.length] : null);
  const pool = pools(w, packs, tags);
  const gone = neverBackSet(w);
  const { wanted, gating } = uses(w);
  const busy = new Set(Object.values(w.people).filter((a) => wantsOf(a).length).map((a) => a.id));
  const boxed = new Set();
  const name = (id) => (w.items[id] || w.people[id] || w.places[id])?.name || id;
  const entity = (id) => w.items[id] || w.people[id] || w.places[id];
  const ok = (id, chain) => !gone.has(id) && !chain.used.has(id) && unconditional(entity(id));
  const from = (chain, kind) => chain.lines.flatMap((p) => pool[p]?.[kind] || []);
  const wantable = (x, chain) => ok(x, chain) && !wanted.has(x) && whereIs(w, x);
  const freeThing = (x, chain) => wantable(x, chain) && !gating.has(x);

  function lead(t, chain) {
    const r2 = pick(from(chain, "residents").filter((q) => ok(q, chain) && w.people[q].place !== whereIs(w, t)), `rumour:${chain.root}:${t}`);
    if (!r2) return;
    chain.leads.push({ speaker: r2, at: w.people[r2].place, subject: t, text: `${name(r2)} has heard of ${name(t)}.` });
    chain.steps.push({ verb: "talk", person: r2, learn: t });
  }

  function get(x, d, chain) {
    const holder = w.items[x].holder;
    if (d > 0 && w.people[holder] && !busy.has(holder) && ok(holder, chain)) {
      chain.used.add(holder);
      chain.steps.push({ verb: "exchange", item: x, from: holder });
      const y = want(holder, d, chain);
      if (y) return void chain.locks.push({ box: x, by: holder, key: y, lock: `${name(holder)} will part with ${name(x)} for ${name(y)}.` });
    }
    if (d > 0 && w.places[holder] && !boxed.has(holder) && !gating.has(x)) {
      const k = pick(from(chain, "things").filter((t) => freeThing(t, chain)), `quest:${chain.root}:box:${x}`);
      if (k) {
        boxed.add(holder), chain.used.add(k), gating.add(k);
        chain.locks.push({ box: x, at: holder, key: k, lock: `${name(holder)} keeps ${name(x)} until ${name(k)} is laid here.` });
        chain.steps.push({ verb: "open box", item: x, at: holder, with: k });
        return get(k, d - 1, chain);
      }
    }
    chain.steps.push({ verb: w.people[holder] ? "exchange" : "take", item: x, at: whereIs(w, x), ...(w.people[holder] && { from: holder }) });
  }

  const kinds = {
    item(r, d, chain) {
      const here = w.people[r].place;
      const x = pick(from(chain, "things").filter((t) => wantable(t, chain) && w.items[t].holder !== r && whereIs(w, t) !== here), `want:${r}:item`);
      if (!x) return null;
      chain.used.add(x), wanted.add(x);
      chain.steps.push({ verb: "want", who: r, item: x });
      get(x, d - 1, chain);
      return x;
    },
    person(r, d, chain) {
      const q = pick(from(chain, "residents").filter((p) => p !== r && ok(p, chain) && w.people[p].place !== w.people[r].place), `want:${r}:person`);
      if (!q) return null;
      chain.used.add(q);
      chain.steps.push({ verb: "want", who: r, person: q });
      if (d > 1 && !busy.has(q)) want(q, d - 1, chain);
      else if (d > 1) lead(q, chain);
      chain.steps.push({ verb: "talk", person: q, at: w.people[q].place });
      return q;
    },
    place(r, d, chain) {
      const p = pick(from(chain, "places").filter((p) => p !== w.people[r].place && ok(p, chain)), `want:${r}:place`);
      if (!p) return null;
      chain.used.add(p);
      chain.steps.push({ verb: "want", who: r, place: p });
      if (d > 1) lead(p, chain);
      chain.steps.push({ verb: "goto", place: p });
      return p;
    },
  };

  function want(r, d, chain) {
    busy.add(r);
    const motive = pool[w.people[r].pack]?.motivations[r];
    const weights = { ...WEIGHTS, ...(motive && { [KIND_OF[motive]]: WEIGHTS[KIND_OF[motive]] * 3 }) };
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    let roll = runHash(s, `want:${r}:kind`) % total;
    const first = Object.keys(weights).find((k) => (roll -= weights[k]) < 0);
    for (const kind of [first, ...Object.keys(weights).filter((k) => k !== first)]) {
      const target = kinds[kind](r, d, chain);
      if (!target) continue;
      chain.wants[r] = { kind, target, ...(motive && { motivation: motive }) };
      return target;
    }
    return null;
  }

  const chains = [];
  for (let i = 0; i < count; i++) {
    const roots = packs.flatMap((p) => pool[p].residents).filter((r) => !busy.has(r) && !gone.has(r) && unconditional(w.people[r]));
    const root = pick(roots, `quest:root:${i}`);
    if (!root) break;
    const pack = w.people[root].pack;
    const chain = { root, lines: [pack, ...(pool[pack]?.crossings || [])], used: new Set([root]), steps: [], wants: {}, locks: [], leads: [] };
    if (!want(root, depth, chain)) continue;
    const touched = [...new Set([...chain.used].map((id) => entity(id).pack))].sort();
    chains.push({
      id: `quest:${root}`,
      rank: RANKS[Math.min(depth, 4) - 1],
      packs: touched,
      ...(depth >= 4 && touched.length < 3 && { flag: `Epic needs 3 packs; this chain touches ${touched.length}` }),
      steps: chain.steps.map((step, n) => ({ key: `quest:${root}:${n}`, ...step })),
      wants: chain.wants,
      locks: chain.locks,
      leads: chain.leads,
    });
  }
  return { seed, packs, depth, note: "Draft for owner review. Nothing here is shipped.", chains };
}

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const read = (f) => JSON.parse(readFileSync(f, "utf8"));
  const w = liveWorld(read(path.join(here, "../card-game/packs.json")), read(path.join(here, "../card-game/forest.json")));
  const tagsFile = arg("tags", path.join(here, "card-chain-tags.json"));
  const out = path.resolve(arg("out", "output/card-chains"));
  if (out.startsWith(path.resolve(here, ".."))) throw new Error("Write drafts outside v2/.");
  const seed = Number(arg("seed", 1));
  const draft = generateChains(w, {
    seed,
    packs: arg("packs", [...w.packs.map((p) => p.id), "hub"].join(",")).split(","),
    depth: Number(arg("depth", 2)),
    count: Number(arg("count", 3)),
    tags: existsSync(tagsFile) ? read(tagsFile) : {},
  });
  mkdirSync(out, { recursive: true });
  const file = path.join(out, `chains-seed-${seed}.json`);
  writeFileSync(file, `${JSON.stringify(draft, null, 2)}\n`);
  for (const c of draft.chains) console.log(`${c.id} (${c.rank}, ${c.packs.join("+")}): ${c.steps.map((x) => [x.verb, x.who, x.item || x.person || x.place, x.from, x.with && `with ${x.with}`].filter(Boolean).join(" ")).join(" > ")}`);
  console.log(`Wrote ${path.relative(process.cwd(), file)}`);
}
