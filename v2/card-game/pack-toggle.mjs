// A world's packs switch off and on mid-world (rules 97; owner, 2026-11-03:
// "mid world and all avatars and items from other worldpacks in the
// worldpack's locations are scattered"). `enabledPacks` lists the packs on;
// the Reflected Shore and the packs that hang on it are always on. A pack
// switched off goes dormant: its places, people and things keep their state,
// unseen and unreachable (`entityEnabled`), until it is on again.
// docs/design/rules-97-pack-toggle.md
import {
  entityActive,
  hub,
  packDefinition,
  packEntity,
  SWITCHED,
  transports,
} from "./pack-registry.mjs";
import { sendShipHome } from "./pack-transport.mjs";

export const TOGGLE_PACKS = SWITCHED;
export const PACK_NAMES = {
  "greek-drama": "The Wine-Dark Sea",
  "hoppycat-archive": "Hoppy Cat Universe",
  "lonely-forest": "Cosy Cottage",
};

// Every world gets the field, all packs on; a save keeps its own.
export function installEnabledPacks(s) {
  if (!Array.isArray(s.enabledPacks)) s.enabledPacks = [...TOGGLE_PACKS];
}
export const validEnabledPacks = (list) =>
  list === undefined ||
  (Array.isArray(list) &&
    list.length > 0 &&
    list.every(
      (id, i) => TOGGLE_PACKS.includes(id) && (!i || list[i - 1] < id),
    ));

// Why `actor` may not switch `id` now, or null.
export function packToggleBlock(s, id) {
  if (s.sharedVersion) return "Shared worlds keep every pack for now";
  if (!TOGGLE_PACKS.includes(id)) return "The Reflected Shore is always here";
  const on = s.enabledPacks?.includes(id) ?? true;
  if (on && (s.enabledPacks ?? TOGGLE_PACKS).length === 1)
    return "One world pack stays on";
  return null;
}

const mine = (pack, id) => packEntity(id)?.packId === pack.id;
// What a quest names: its target and its step's places.
const names = (w) => [w?.target, w?.step?.to, w?.step?.at].filter(Boolean);

// The play: { kind: "pack", pack, enable }. `api` lends the world's rules:
// closeStandoff, setAside (a want), questsOf and hash.
export function togglePack(s, action, api) {
  const id = action?.pack,
    block = packToggleBlock(s, id);
  if (block) return { error: `${block}.` };
  installEnabledPacks(s);
  const on = s.enabledPacks.includes(id);
  if (action.enable === on)
    return { error: `${PACK_NAMES[id]} is ${on ? "on" : "off"} already.` };
  if (!on) {
    s.enabledPacks = [...s.enabledPacks, id].sort();
    return { text: `${PACK_NAMES[id]} returns as it was.` };
  }
  s.enabledPacks = s.enabledPacks.filter((p) => p !== id);
  scatter(s, packDefinition(id), api);
  return {
    text: `${PACK_NAMES[id]} goes quiet. Everyone and everything from elsewhere there is scattered.`,
  };
}

function scatter(s, pack, api) {
  const gone = (place) => mine(pack, place);
  // The shore end of the pack's own crossings first, then the shore.
  const spots = [
    ...new Set([
      ...pack.crossings
        .flatMap((c) => [c.from, c.to])
        .filter((p) => hub.places.includes(p)),
      ...hub.places,
    ]),
  ].filter((p) => entityActive(s, p));
  let next = api.hash(`scatter:${pack.id}:${s.revision}`) % spots.length;
  const spot = () => spots[next++ % spots.length];
  // People from elsewhere: players' avatars to the way back, the rest spread.
  for (const [id, a] of Object.entries(s.actors).sort(([x], [y]) =>
    x < y ? -1 : 1,
  ))
    if (!mine(pack, id) && gone(a.place)) {
      a.place = api.player(id) ? spots[0] : spot();
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
    if (!mine(pack, id) && mine(pack, item.holder)) {
      const top = root(id);
      item.holder = !mine(pack, top) && s.actors[top] ? top : spot();
    }
  // Fights there, or with its people, end; everyone keeps the peace a while.
  for (const c of [...(s.standoffs || [])])
    if (gone(c.location) || mine(pack, c.challenger) || mine(pack, c.defender))
      api.closeStandoff(s, c);
  // Its own ships lie still where they are; another ship at or bound for
  // one of its docks puts in at home, everyone aboard ashore (rules 95).
  for (const [ship, t] of Object.entries(transports)) {
    const state = s.transports[ship];
    if (t.packId === pack.id)
      Object.assign(state, {
        phase: "docked",
        destination: null,
        riders: [],
        recall: null,
        since: s.turn,
      });
    else if ((gone(state.dock) || gone(state.destination)) && !gone(t.at))
      sendShipHome(s, ship);
  }
  // A quest naming the pack's places, people or things is set aside.
  for (const id of Object.keys(s.actors))
    for (let n = mine(pack, id) ? 0 : api.questsOf(s, id).length; n > 0; n--)
      if (names(s.actors[id].want).some((x) => mine(pack, x)))
        api.setAside(s, id);
}
