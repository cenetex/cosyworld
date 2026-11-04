// A world's packs switch off and on mid-world, by the hub's `switchable`
// groups (rules 97; owner, 2026-11-03: "mid world and all avatars and items
// from other worldpacks in the worldpack's locations are scattered").
// `disabledPacks` names the groups off; one stays on. A pack switched off
// sleeps: its places, people and things keep their state, unseen and
// unreachable (`entityEnabled`), until it is on again. Each pack's declared
// entries say where its travelers come out. docs/design/rules-97-pack-toggle.md
import {
  entityActive,
  GROUPS,
  hub,
  packDefinition,
  packGroup,
  packIdOf,
  packOn,
  transports,
} from "./pack-registry.mjs";
import { sendShipHome } from "./pack-transport.mjs";
import { questsOf, restStep } from "./want.mjs";

const ORDER = Object.keys(GROUPS);
const rank = (packId) => {
  const g = ORDER.indexOf(packGroup(packId));
  return g < 0 ? ORDER.length : g;
};
// Each pack's entries; the hub's are its packs' hub entries, seen from the
// other side. Sorted by the group order of the side they join.
const sides = Object.entries(hub.packEntries);
const ENTRIES = Object.fromEntries(
  [
    ...sides,
    [
      "hub",
      sides.flatMap(([id, list]) =>
        list
          .filter((e) => e.joins === "hub")
          .map((e) => ({ joins: id, at: e.arrive })),
      ),
    ],
  ].map(([id, list]) => [
    id,
    list
      .map((e, i) => [e, i])
      .sort(([a, i], [b, j]) => rank(a.joins) - rank(b.joins) || i - j)
      .map(([e]) => e),
  ]),
);
const startOf = (packId) =>
  packId === "hub" ? hub.start : packDefinition(packId).entry;

export const validDisabledPacks = (list) =>
  list === undefined ||
  (Array.isArray(list) &&
    list.length > 0 &&
    list.length < ORDER.length &&
    list.every((g, i) => ORDER.includes(g) && (!i || list[i - 1] < g)));

// Where arrivals land with nowhere declared: the start of the first pack on.
export function firstStart(s) {
  for (const g of ORDER)
    for (const p of GROUPS[g].packs)
      if (packOn(s, p) && entityActive(s, startOf(p))) return startOf(p);
  return null;
}

// Why `actor` may not switch the group `id` now, or null. The reason is the
// context button's label.
export function packToggleBlock(s, id, actor) {
  if (s.sharedVersion) return "Shared worlds keep every pack for now";
  if (!GROUPS[id]) return "Only a world pack switches off";
  if (
    (s.standoffs || []).some((c) => [c.challenger, c.defender].includes(actor))
  )
    return "Not during a fight";
  const off = s.disabledPacks || [];
  if (off.includes(id)) return null;
  if (off.length === ORDER.length - 1) return "One world pack stays on";
  if (GROUPS[id].packs.includes("hub") && s.opening && !s.opening.crossed)
    return "Not before the first crossing";
  return null;
}

// What a quest names: its target and its step's places.
const names = (w) => [w?.target, w?.step?.to, w?.step?.at].filter(Boolean);

// The play: { kind: "pack", pack: group, enable }. `api` lends the world's
// rules: closeStandoff, want (the want rules' api) and hash.
export function togglePack(s, action, actor, api) {
  const id = action?.pack,
    block = packToggleBlock(s, id, actor);
  if (block) return { error: `${block}.` };
  const off = s.disabledPacks || [],
    name = GROUPS[id].name;
  if (action.enable === !off.includes(id))
    return { error: `${name} is ${action.enable ? "on" : "off"} already.` };
  const next = action.enable
    ? off.filter((g) => g !== id)
    : [...off, id].sort();
  if (next.length) s.disabledPacks = next;
  else delete s.disabledPacks;
  if (action.enable) return { text: `${name} returns as it was.` };
  for (const pack of GROUPS[id].packs) scatter(s, pack, api);
  return {
    text: `${name} goes quiet. Everyone and everything from elsewhere there is scattered.`,
  };
}

const byId = (o) => Object.entries(o).sort(([x], [y]) => (x < y ? -1 : 1));

function scatter(s, pack, api) {
  const mine = (x) => packIdOf(x) === pack;
  // Out at the entries joining packs still on, else the first pack's start.
  const at = ENTRIES[pack]
    .filter((e) => packOn(s, e.joins) && entityActive(s, e.at))
    .map((e) => e.at);
  const spots = at.length ? [...new Set(at)] : [firstStart(s)];
  let next = api.hash(`scatter:${pack}:${s.revision}`) % spots.length;
  const spot = () => spots[next++ % spots.length];
  const root = (id) => {
    let holder = s.items[id].holder;
    for (let i = 0; i < 32 && s.items[holder]; i++)
      holder = s.items[holder].holder;
    return holder;
  };
  // Its things carried by people from elsewhere are set down where they
  // stand, to sleep there.
  for (const [id, item] of byId(s.items)) {
    const top = root(id);
    if (mine(id) && s.actors[top] && !mine(top))
      item.holder = s.actors[top].place;
  }
  // People from elsewhere: players to the first way out, the rest spread.
  for (const [id, a] of byId(s.actors))
    if (!mine(id) && mine(a.place)) {
      a.place = api.want.player(id) ? spots[0] : spot();
      delete a.sleeping;
    }
  // Things from elsewhere held in the pack: to whoever from elsewhere
  // carries the holder, or where its person stands outside it, else spread.
  for (const [id, item] of byId(s.items)) {
    if (mine(id) || !mine(item.holder)) continue;
    const top = root(id),
      place = s.actors[top]?.place;
    item.holder =
      s.actors[top] && !mine(top)
        ? top
        : place && !mine(place) && entityActive(s, place)
          ? place
          : spot();
  }
  // Fights there, or with its people, end; everyone keeps the peace a while.
  for (const c of [...(s.standoffs || [])])
    if (mine(c.location) || mine(c.challenger) || mine(c.defender))
      api.closeStandoff(s, c);
  // Its own ships lie still, keeping their own crew; another ship at or
  // bound for one of its docks puts in at home, everyone ashore (rules 95).
  for (const [ship, t] of Object.entries(transports)) {
    const state = s.transports[ship];
    if (t.packId === pack) {
      const crew = state.riders.filter(mine);
      Object.assign(state, {
        phase: crew.length ? "arrived" : "docked",
        destination: null,
        riders: crew,
        recall: null,
        since: s.turn,
      });
    }
    else if ((mine(state.dock) || mine(state.destination)) && !mine(t.at))
      sendShipHome(s, ship);
  }
  // Quests naming it go to the bottom of the stack as they are; a rest
  // step at one of its sanctuaries turns to an awake one.
  for (const [id, a] of byId(s.actors)) {
    if (mine(id)) continue;
    if (mine(a.sanctuary)) delete a.sanctuary;
    const list = questsOf(s, id).map((w) =>
      w.step?.verb === "rest" && mine(w.target)
        ? restStep(s, id, api.want, w.quest)
        : w,
    );
    const named = (w) => names(w).some(mine);
    const order = [...list.filter((w) => !named(w)), ...list.filter(named)];
    if (!order.length) continue;
    a.want = order[0];
    if (order.length > 1) a.under = order.slice(1);
  }
}
