// A world's packs switch off and on mid-world by the hub's `switchable`
// groups; `disabledPacks` names the groups off, and one stays on. A pack
// off sleeps with its state kept (`entityEnabled`), and everyone and
// everything from elsewhere in it comes out at its declared entries.
// docs/design/rules-98-pack-toggle.md
import {
  crossings,
  entityActive,
  GROUPS,
  groupAwake,
  hub,
  packDefinition,
  packGroup,
  packIdOf,
  packOn,
  transports,
} from "./pack-registry.mjs";
import { sendShipHome } from "./pack-transport.mjs";
import { humanAvatarIds } from "./human-cast.mjs";
import {
  mergeSanctuaryQuests,
  allQuestsOf,
  QUEST_LIMIT,
  restStep,
  setQuests,
} from "./want.mjs";

const ORDER = Object.keys(GROUPS);
const rank = (id) => (ORDER.indexOf(packGroup(id)) + 1 || 99) - 1;
// Each pack's entries, by the group order of the side they join; the hub's
// are its packs' hub entries seen from the other side.
const sides = Object.entries(hub.packEntries);
const mirror = sides.flatMap(([id, list]) =>
  list
    .filter((e) => e.joins === "hub")
    .map((e) => ({ joins: id, at: e.arrive })),
);
const ENTRIES = Object.fromEntries(
  [...sides, ["hub", mirror]].map(([id, list]) => [
    id,
    [...list].sort((a, b) => rank(a.joins) - rank(b.joins)),
  ]),
);
const startOf = (packId) =>
  packId === "hub" ? hub.start : packDefinition(packId).entry;

export const validDisabledPacks = (list) =>
  list === undefined ||
  (Array.isArray(list) &&
    list.length > 0 &&
    ORDER.some((g) => groupAwake(list, g)) &&
    list.every((g, i) => ORDER.includes(g) && (!i || list[i - 1] < g)));
export const groupOn = (s, g) => groupAwake(s.disabledPacks, g);

// Where arrivals land with nowhere declared: the start of the first pack on.
export function firstStart(s) {
  for (const g of ORDER)
    for (const p of GROUPS[g].packs)
      if (packOn(s, p) && entityActive(s, startOf(p))) return startOf(p);
  return null;
}

// Why `actor` may not switch the group `id` now (the button's reason).
export function packToggleBlock(s, id, actor) {
  if (s.sharedVersion) return "Shared worlds keep every pack for now";
  if (!GROUPS[id]) return "Only a world pack switches off";
  // Anyone in a fight's `resolve` is in it, joiners too (as standoffFor).
  if ((s.standoffs || []).some((c) => Object.hasOwn(c.resolve || {}, actor)))
    return "Not during a fight";
  const off = s.disabledPacks || [],
    via = GROUPS[id].reachedBy;
  if (off.includes(via)) return `Reached by ${GROUPS[via].name}`;
  if (off.includes(id)) return null;
  if (!ORDER.some((g) => groupAwake([...off, id], g)))
    return "One world pack stays on";
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
  // It, and any group reached only by it, goes quiet.
  for (const g of ORDER)
    if (groupAwake(off, g) && !groupAwake(next, g))
      for (const pack of GROUPS[g].packs) scatter(s, pack, api);
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
    let top = s.items[id].holder;
    for (let i = 0; i < 32 && s.items[top]; i++) top = s.items[top].holder;
    return top;
  };
  // Its things carried by people from elsewhere are set down where they
  // stand, to sleep there and take no carry slot (F6).
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
  // A signal in progress breaks once no player is left where it is made, as
  // walking away breaks it (rules 99).
  for (const c of crossings) {
    const state = s.crossings[c.id];
    if (
      c.signal &&
      state.phase > 0 &&
      !Object.keys(s.actors).some(
        (id) => api.want.player(id) && s.actors[id].place === c.from,
      )
    )
      state.phase = 0;
  }
  // Things from elsewhere held in the pack: to whoever from elsewhere
  // carries the holder, or where its person stands outside it (F10), else
  // spread.
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
  // Its own ships lie still, keeping their own crew (F9); another ship at
  // or bound for one of its docks puts in at home, everyone ashore (rules 95).
  for (const [ship, t] of Object.entries(transports)) {
    const state = s.transports[ship];
    if (t.packId === pack) {
      const crew = state.riders.filter(mine);
      Object.assign(state, {
        phase: crew.length ? "arrived" : "docked",
        ...{ destination: null, riders: crew, recall: null, since: s.turn },
      });
    } else if ((mine(state.dock) || mine(state.destination)) && !mine(t.at))
      sendShipHome(s, ship);
  }
  // Quests naming it go to the bottom of the stack as they are; a sanctuary
  // in it is forgotten, and a rest step there turns to an awake one (F5).
  for (const [id, a] of byId(s.actors)) {
    if (mine(id)) continue;
    if (mine(a.sanctuary)) delete a.sanctuary;
    const list = mergeSanctuaryQuests(
      allQuestsOf(s, id).map((w) =>
        w.step?.verb === "rest" && mine(w.target)
          ? restStep(s, id, api.want, w.quest)
          : w,
      ), humanAvatarIds.includes(id),
    );
    const named = (w) => names(w).some(mine);
    const count = humanAvatarIds.includes(id) ? QUEST_LIMIT : list.length;
    const active = list.slice(0, count);
    const order = [...active.filter((w) => !named(w)), ...active.filter(named), ...list.slice(count)];
    if (order.length) setQuests(a, order);
  }
}
