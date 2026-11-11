// Homes away from the pond, and an unlocked avatar's homecoming (#1936).
// Every world picks, from its seed, which authored place each home's door
// opens at (`doors`). A world opened for an unlocked avatar (`homecoming` on
// create) also leaves that avatar outside and scatters its belonging to a
// seeded spot it can reach without Vale's lamp. The quest to bring the
// belonging home is the avatar's to take at its home's door, a locked box
// (`questOffers`, world/offers.mjs); nothing is pushed. The host passes only
// the avatar; the seeded world records the rest, so replay never reads a
// server table.
import forest from "./forest.json" with { type: "json" };
import { humanAvatar, lamplessPlaces, visitors } from "./human-cast.mjs";
import {
  crossings,
  hub,
  packDefinitions,
  packPlaces,
  transports,
} from "./pack-registry.mjs";
import { seedHash } from "./pack-specials.mjs";
import { hidingPlaces } from "./hidden-avatar.mjs";

// A homecoming avatar starts at the pond, where every world begins.
const START = "pond";
const pick = (list, key) => list[seedHash(key) % list.length];
const lampless = (list) => {
  const open = list.filter((place) => lamplessPlaces.includes(place));
  return open.length ? open : list;
};
// A place has at most three links (the map rule), so a door opens only where
// one is left in this world. A ship has no cap.
const LINK_CAP = 3;
const homes = new Set(visitors.map((a) => a.home.id));
const ships = new Set(Object.values(transports).map((t) => t.place));
const linked = new Map();
const link = (from, to) =>
  homes.has(to) || linked.set(from, (linked.get(from) || new Set()).add(to));
for (const [id, p] of Object.entries({ ...forest.places, ...packPlaces }))
  for (const to of p.exits || []) link(id, to);
for (const r of forest.reflectionRoutes || []) link(r.from, r.to);
for (const pack of packDefinitions)
  for (const r of pack.routes || []) link(r.from, r.to);
for (const c of crossings)
  if (!c.retired)
    link(c.from, c.transport ? transports[c.transport].place : c.to);

// Homes with one door first, then the homecoming avatar's, then the rest,
// each at a seeded place with a link to spare.
export function placeDoors(s, own = null) {
  const seed = s.run?.seed ?? 0,
    used = {},
    doors = {};
  const order = [
    ...visitors.filter((a) => a.home.doors.length === 1),
    ...visitors.filter((a) => a.id === own && a.home.doors.length > 1),
    ...visitors.filter((a) => a.id !== own && a.home.doors.length > 1),
  ];
  for (const a of order) {
    const wanted = a.id === own ? lampless(a.home.doors) : a.home.doors;
    const free = wanted.filter(
      (p) =>
        ships.has(p) || (linked.get(p)?.size ?? 0) + (used[p] || 0) < LINK_CAP,
    );
    const door = pick(free.length ? free : wanted, `${seed}:door:${a.home.id}`);
    used[door] = (used[door] || 0) + 1;
    doors[a.home.id] = door;
  }
  s.doors = Object.fromEntries(
    visitors.map((a) => [a.home.id, doors[a.home.id]]),
  );
  return s;
}

export function homecoming(world, actor) {
  if (actor == null) return world;
  const avatar = humanAvatar(actor);
  if (!avatar || actor === "vale")
    throw new Error("Choose whose world this is.");
  placeDoors(world, actor);
  const spots = [...hidingPlaces(world), ...hub.places].filter(
    (place) => place !== START && lamplessPlaces.includes(place),
  );
  const seed = world.run?.seed ?? 0;
  world.actors[actor].place = START;
  world.items[avatar.item.id].holder = pick(spots, `${seed}:item:${actor}`);
  return world;
}

export const validDoors = (s) =>
  s.doors === undefined ||
  (Boolean(s.doors) &&
    Object.keys(s.doors).length === visitors.length &&
    visitors.every((a) => a.home.doors.includes(s.doors[a.home.id])));
