import { DAYLIGHT_TURNS, runHash } from "../pack-rules.mjs";

export const HEARD_FROM = "quest:heard";
export const RUMOURS_HELD = 3;
export const TELL_FAILS = 2;
export const STALE_DAYS = 5;
export const RESTLESS_DAYS = 7;
const KINDS = ["item", "place", "person", "gone"];
const WANTED = ["item", "place", "person"];
const FIELDS = "at,day,holder,hops,kind,subject,teller";

export const dayOf = (s) => Math.floor(s.turn / (2 * DAYLIGHT_TURNS));
const trustIn = (s, id, other) => (other && s.actors[id]?.trust?.[other]) || 0;
const keyOf = (kind, target) => `${kind}:${target}`;
export const restless = (s, id) =>
  (dayOf(s) + runHash(s, `restless:${id}`)) % RESTLESS_DAYS === 0;

function root(s, id) {
  let holder = s.items[id]?.holder;
  const seen = new Set([id]);
  while (s.items[holder] && !seen.has(holder)) {
    seen.add(holder);
    holder = s.items[holder].holder;
  }
  return holder;
}
const placeOf = (s, id) => s.actors[id]?.place ?? (s.items[id] ? placeOf(s, root(s, id)) : id);

function importance(s, id, r) {
  const want = s.actors[id]?.want;
  if (
    want?.target === r.subject ||
    trustIn(s, id, r.holder) >= 2 ||
    trustIn(s, id, r.teller) >= 2
  )
    return 3;
  return want?.kind === r.kind ? 2 : 1;
}
const fit = (s, id, r) => importance(s, id, r) * Math.min(3, r.hops);
const ranked = (s, id, list) =>
  list.sort(
    (a, b) =>
      importance(s, id, b) - importance(s, id, a) ||
      b.day - a.day ||
      a.hops - b.hops ||
      (a.subject < b.subject ? -1 : 1),
  );
const knows = (s, id, r) =>
  (s.actors[id].rumours || []).some(
    (q) => q.subject === r.subject && q.kind === r.kind,
  );

export function hear(s, id, r) {
  const a = s.actors[id];
  if (!a || r.holder === id || r.subject === id) return;
  const kept = (a.rumours || []).filter(
    (q) => q.subject !== r.subject || q.kind !== r.kind,
  );
  a.rumours = ranked(s, id, [...kept, r]).slice(0, RUMOURS_HELD);
}
function retold(s, r, teller) {
  const { fails: _fails, ...rest } = r;
  return { ...rest, teller, hops: Math.min(3, r.hops + 1), day: dayOf(s) };
}
function tell(s, teller, listener, r, gossip) {
  if (knows(s, listener, r)) {
    if (gossip) r.fails = (r.fails || 0) + 1;
    return;
  }
  const told = retold(s, r, teller);
  if (gossip && fit(s, listener, told) < 3) return;
  hear(s, listener, told);
  r.day = dayOf(s);
}

export function noteRumours(was, s, api, wasApi) {
  const day = dayOf(s);
  const facts = [];
  const fact = (subject, kind, holder, at, valued = false) =>
    facts.push([
      { subject, kind, at: at ?? null, holder: holder ?? null, teller: null, hops: 0, day },
      valued,
    ]);
  const since = was.eventSeq ?? was.log.length;
  for (let i = s.log.length - 1; i >= 0 && s.log[i].seq > since; i--) {
    const e = s.log[i];
    if (e.verb === "want_met" && WANTED.includes(e.wantMet?.kind))
      fact(e.wantMet.target, e.wantMet.kind, e.actorId, s.actors[e.actorId]?.place);
  }
  for (const id of Object.keys(s.items)) {
    const to = root(s, id);
    if (to !== root(was, id) && s.actors[to] && !api.player(to))
      fact(id, "item", to, s.actors[to].place, true);
  }
  for (const id of Object.keys(s.opened || {}))
    if (!was.opened?.[id] && api.kindOf(id))
      fact(id, api.kindOf(id), null, s.actors[s.opened[id][0]]?.place);
  for (const id of [...Object.keys(s.items), ...Object.keys(s.actors)])
    if (api.gone(id) && !wasApi.gone(id)) fact(id, "gone", null, placeOf(was, id));
  for (const [r, valued] of facts)
    for (const id of Object.keys(s.actors).sort())
      if (
        s.actors[id].place === r.at &&
        api.active(id) &&
        (!valued || api.player(id) || api.valueOf(id, r.subject) > 1)
      )
        hear(s, id, { ...r });
}

export function dailyRumours(s, api) {
  const day = dayOf(s);
  for (const a of Object.values(s.actors)) {
    if (!a.rumours) continue;
    a.rumours = a.rumours.filter(
      (r) => day - r.day < STALE_DAYS || r.subject === a.want?.target,
    );
    if (!a.rumours.length) delete a.rumours;
  }
  const hash = (id) => runHash(s, `gossip:${day}:${id}`);
  const order = Object.keys(s.actors)
    .filter((id) => !api.player(id) && api.active(id))
    .sort((x, y) => hash(x) - hash(y) || (x < y ? -1 : 1));
  for (const teller of order) {
    const r = s.actors[teller].rumours?.find((q) => (q.fails || 0) < TELL_FAILS);
    for (const listener of order) {
      if (!r || (r.fails || 0) >= TELL_FAILS) break;
      if (listener !== teller && s.actors[listener].place === s.actors[teller].place)
        tell(s, teller, listener, r, true);
    }
  }
}

export function talkRumours(s, player, them) {
  const top = s.actors[them].rumours?.[0];
  const best = (s.actors[player].rumours || [])
    .filter((r) => !knows(s, them, r))
    .map((r) => [fit(s, them, retold(s, r, player)), runHash(s, `pass:${them}:${r.subject}:${s.turn}`), r])
    .sort((x, y) => y[0] - x[0] || x[1] - y[1])[0]?.[2];
  if (best) tell(s, player, them, best, false);
  if (top) tell(s, them, player, top, false);
}

export function heardWant(s, id, api, skip = [], roams = true) {
  const a = s.actors[id],
    day = dayOf(s);
  if (a.heardOn === day || restless(s, id)) return null;
  const world = api.worldOf(id);
  const peers = Object.keys(s.actors).filter(
    (o) => o !== id && !api.player(o) && api.active(o),
  );
  const near = peers.filter((o) => api.worldOf(o) === world);
  const scores = new Map(),
    wanters = new Map();
  const offer = (kind, target, n) =>
    scores.set(keyOf(kind, target), Math.max(scores.get(keyOf(kind, target)) || 0, n));
  for (const o of peers) {
    const w = s.actors[o].want,
      t = trustIn(s, id, o);
    if (!WANTED.includes(w?.kind)) continue;
    if (t === 3) offer(w.kind, w.target, 4);
    if (!near.includes(o) || t < 1) continue;
    if (t === 2 && w.kind === "item") offer(w.kind, w.target, 3);
    const count = (wanters.get(keyOf(w.kind, w.target)) || 0) + 1;
    wanters.set(keyOf(w.kind, w.target), count);
    if (count >= 2) offer(w.kind, w.target, 3);
  }
  const famed = near.reduce(
    (best, o) => ((s.actors[o].xp || 0) > (s.actors[best].xp || 0) ? o : best),
    id,
  );
  const thick = api.thick?.(id)?.kind;
  for (const r of a.rumours || []) {
    if (r.kind === "gone" || trustIn(s, id, r.teller) < 1) continue;
    if (r.kind === "item" && r.day === day && r.holder && root(s, r.subject) === r.holder)
      offer(r.kind, r.subject, 3);
    offer(r.kind, r.subject, 2 + (thick === r.kind) + (r.teller === famed && famed !== id));
  }
  const cap = Math.ceil((near.length + 1) / 3);
  const thin = (key) =>
    near.filter(
      (o) => s.actors[o].want?.from === HEARD_FROM && keyOf(s.actors[o].want.kind, s.actors[o].want.target) === key,
    ).length;
  const open = (kind, target) =>
    target !== id &&
    !skip.includes(target) &&
    api.active(target) &&
    !api.gone(target) &&
    (kind === "item"
      ? Object.hasOwn(s.items, target) && root(s, target) !== id
      : kind === "person"
        ? Object.hasOwn(s.actors, target)
        : roams && api.kindOf(target) === "place" && target !== a.place);
  const hash = (key) => runHash(s, `heard:${id}:${key}:${day}`);
  const pick = [...scores]
    .map(([key, n]) => [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1), n, key])
    .filter(([kind, target, , key]) => open(kind, target) && thin(key) < cap)
    .sort((x, y) => y[2] - x[2] || hash(x[3]) - hash(y[3]))[0];
  if (!pick) return null;
  a.heardOn = day;
  return { kind: pick[0], target: pick[1], since: s.turn, refusals: 0, from: HEARD_FROM };
}

export function rumourWords(s, r, names) {
  const name = names.name(r.subject);
  const line =
    r.kind === "gone"
      ? `${name} is gone for good.`
      : r.hops === 0 && r.holder
        ? `${names.name(r.holder)} has ${name}${r.at && r.at !== r.subject ? ` at ${names.name(r.at)}` : ""}.`
        : r.hops <= 1 && r.at && r.at !== r.subject
          ? `${name} is at ${names.name(r.at)}.`
          : r.hops <= 2 && names.world(r.at ?? r.subject)
            ? `${name} is somewhere in ${names.world(r.at ?? r.subject)}.`
            : (names.legend(r.subject) ?? `People speak of ${name}.`);
  return r.teller ? `${names.name(r.teller)} told me: ${line}` : line;
}

export function validRumours(s, id) {
  const a = s.actors[id],
    day = dayOf(s),
    list = a.rumours;
  const ref = (x) => x === null || typeof x === "string";
  return (
    (a.heardOn === undefined ||
      (Number.isSafeInteger(a.heardOn) && a.heardOn >= 0 && a.heardOn <= day)) &&
    (list === undefined ||
      (Array.isArray(list) &&
        list.length >= 1 &&
        list.length <= RUMOURS_HELD &&
        new Set(list.map((r) => keyOf(r?.kind, r?.subject))).size === list.length &&
        list.every(
          (r) =>
            r &&
            Object.keys(r).filter((k) => k !== "fails").sort().join() === FIELDS &&
            (r.fails === undefined || (Number.isInteger(r.fails) && r.fails >= 1 && r.fails <= TELL_FAILS)) &&
            KINDS.includes(r.kind) &&
            typeof r.subject === "string" &&
            r.subject.length <= 80 &&
            ref(r.at) &&
            ref(r.holder) &&
            ref(r.teller) &&
            [0, 1, 2, 3].includes(r.hops) &&
            Number.isSafeInteger(r.day) &&
            r.day >= 0 &&
            r.day <= day,
        )))
  );
}
