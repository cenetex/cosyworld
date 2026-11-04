// A world's packs switch off and on mid-world (rules 97; owner, 2026-11-03:
// "mid world and all avatars and items from other worldpacks in the
// worldpack's locations are scattered"). `enabledPacks` lists the hub's
// `switchable` packs that are on, the Reflected Shore among them; one stays
// on. A pack switched off goes dormant: its places, people and things keep
// their state, unseen and unreachable (`entityEnabled`), until it is on
// again. Each pack's declared entries (the hub's `entries` and
// `packEntries`) say where it is entered. docs/design/rules-97-pack-toggle.md
import {
  entityActive,
  hub,
  packIdOf,
  packOn,
  SWITCHED,
  transports,
} from "./pack-registry.mjs";
import { sendShipHome } from "./pack-transport.mjs";

const NAMES = hub.switchable;
const ALL = [...SWITCHED].sort();
// Where each pack is entered: the hub's own entries, or the inner end of a
// pack's. `WAYS` are the places outside a pack its entries come from.
const ENTRIES = { ...hub.packEntries, [hub.id]: hub.entries };
const WAYS = Object.fromEntries(
  Object.entries(hub.packEntries).map(([id, l]) => [id, l.map((e) => e.from)]),
);

// Every world gets the field, all packs on; a save keeps its own.
export function installEnabledPacks(s) {
  if (!Array.isArray(s.enabledPacks)) s.enabledPacks = [...ALL];
}
export const validEnabledPacks = (list) =>
  list === undefined ||
  (Array.isArray(list) &&
    list.length > 0 &&
    list.every((id, i) => ALL.includes(id) && (!i || list[i - 1] < id)));

// Where arrivals and scattered things land: the awake entry places of the
// first pack that is on, in the hub's fixed order. A pack whose entries all
// come from a pack switched off stays on; it is entered only from inside
// until that pack returns, and its own entry places still take arrivals.
export function landingPlaces(s) {
  for (const id of SWITCHED) {
    const spots = packOn(s, id)
      ? [...new Set(ENTRIES[id].map((e) => e.to))].filter((p) =>
          entityActive(s, p),
        )
      : [];
    if (spots.length) return spots;
  }
  return [];
}

// Why the pack `id` may not switch now, or null.
export function packToggleBlock(s, id) {
  if (s.sharedVersion) return "Shared worlds keep every pack for now";
  if (!SWITCHED.includes(id)) return "Only a world pack switches off";
  const on = s.enabledPacks?.includes(id) ?? true;
  if (on && (s.enabledPacks ?? ALL).length === 1)
    return "One world pack stays on";
  return null;
}

// What a quest names: its target and its step's places.
const names = (w) => [w?.target, w?.step?.to, w?.step?.at].filter(Boolean);

// The play: { kind: "pack", pack, enable }. `api` lends the world's rules:
// closeStandoff, setAside (a want), questsOf, player and hash.
export function togglePack(s, action, api) {
  const id = action?.pack,
    block = packToggleBlock(s, id);
  if (block) return { error: `${block}.` };
  installEnabledPacks(s);
  const on = s.enabledPacks.includes(id);
  if (action.enable === on)
    return { error: `${NAMES[id]} is ${on ? "on" : "off"} already.` };
  if (!on) {
    s.enabledPacks = [...s.enabledPacks, id].sort();
    return { text: `${NAMES[id]} returns as it was.` };
  }
  s.enabledPacks = s.enabledPacks.filter((p) => p !== id);
  const spots = landingPlaces(s);
  if (!spots.length)
    return { error: "No other pack is awake to take them in." };
  scatter(s, id, spots, api);
  return {
    text: `${NAMES[id]} goes quiet. Everyone and everything from elsewhere there is scattered.`,
  };
}

function scatter(s, pack, spots, api) {
  const mine = (x) => packIdOf(x) === pack;
  // Players come out where the pack's first awake entry comes from.
  const back = (WAYS[pack] || []).find((p) => entityActive(s, p)) ?? spots[0];
  let next = api.hash(`scatter:${pack}:${s.revision}`) % spots.length;
  const spot = () => spots[next++ % spots.length];
  // People from elsewhere: players' avatars to the way back, the rest spread.
  for (const [id, a] of Object.entries(s.actors).sort(([x], [y]) =>
    x < y ? -1 : 1,
  ))
    if (!mine(id) && mine(a.place)) {
      a.place = api.player(id) ? back : spot();
      delete a.sleeping;
    }
  // Things from elsewhere held in the pack, by a place, a person or a thing:
  // to whoever carries the holder, else spread.
  const root = (id) => {
    let holder = s.items[id].holder;
    for (let i = 0; i < 32 && s.items[holder]; i++)
      holder = s.items[holder].holder;
    return holder;
  };
  for (const [id, item] of Object.entries(s.items).sort(([x], [y]) =>
    x < y ? -1 : 1,
  ))
    if (!mine(id) && mine(item.holder)) {
      const top = root(id);
      item.holder = !mine(top) && s.actors[top] ? top : spot();
    }
  // Fights there, or with its people, end; everyone keeps the peace a while.
  for (const c of [...(s.standoffs || [])])
    if (mine(c.location) || mine(c.challenger) || mine(c.defender))
      api.closeStandoff(s, c);
  // Its own ships lie still where they are; another ship at or bound for
  // one of its docks puts in at home, everyone aboard ashore (rules 95).
  for (const [ship, t] of Object.entries(transports)) {
    const state = s.transports[ship];
    if (t.packId === pack)
      Object.assign(state, {
        phase: "docked",
        destination: null,
        riders: [],
        recall: null,
        since: s.turn,
      });
    else if ((mine(state.dock) || mine(state.destination)) && !mine(t.at))
      sendShipHome(s, ship);
  }
  // A quest naming the pack's places, people or things is set aside.
  for (const id of Object.keys(s.actors))
    for (let n = mine(id) ? 0 : api.questsOf(s, id).length; n > 0; n--)
      if (names(s.actors[id].want).some(mine)) api.setAside(s, id);
}
