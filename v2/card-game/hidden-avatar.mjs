// One hidden avatar per world (#1936). The host picks, from the creating
// passkey's locked avatars, one to hide (`hidden`) and the rest to leave out
// (`absent`), and passes both on `create`; the rules never read an unlock
// table. The hidden one stands in a seeded hiding place from pack data and
// lives there as a resident. A human's first Talk with it journals an
// `unlock` line naming it; the host unlocks it for that person's passkey.
import { humanAvatar } from "./human-cast.mjs";
import { packDefinitions } from "./pack-registry.mjs";
import { seedHash } from "./pack-specials.mjs";
import { newWant, pushQuest, questsOf } from "./want.mjs";

const avatarList = (value) =>
  Array.isArray(value) &&
  value.length <= 8 &&
  new Set(value).size === value.length &&
  value.every((id) => humanAvatar(id));

// The world's hiding places: each installed pack's `hiding` pool, in pack
// order. Depth (plain sight, behind a door, a night path) is the place's own.
export const hidingPlaces = (world) =>
  packDefinitions
    .filter((pack) => world.packs?.[pack.id] && pack.hiding)
    .flatMap((pack) => pack.hiding.pool.map((entry) => entry.id));

// Leave the absent avatars out and put the hidden one in its hiding place.
export function hideAvatar(world, { hidden, absent } = {}) {
  if (hidden == null && absent == null) return world;
  const out = absent ?? [];
  if (
    !avatarList(out) ||
    (hidden != null && (!humanAvatar(hidden) || out.includes(hidden))) ||
    [hidden, ...out].includes("vale")
  )
    throw new Error("Choose which avatars this world hides.");
  if (out.length) world.absent = [...out].sort();
  if (hidden == null) return world;
  const pool = hidingPlaces(world);
  const place = pool.length
    ? pool[seedHash(`${world.run?.seed ?? 0}:hidden:${hidden}`) % pool.length]
    : world.actors[hidden].place;
  world.actors[hidden].place = place;
  world.hidden = { actor: hidden, place, met: [] };
  return world;
}

// An absent avatar arrives when someone claims it.
export function arrive(world, actor) {
  if (!world.absent?.includes(actor)) return;
  world.absent = world.absent.filter((id) => id !== actor);
  if (!world.absent.length) delete world.absent;
}

// The first committed Talk by a human with the hidden avatar meets it. The
// line to journal, or null.
export function meetHidden(world, action, human) {
  const h = world.hidden;
  if (
    !h ||
    action.kind !== "talk" ||
    action.target !== h.actor ||
    !human ||
    h.met.includes(action.actor)
  )
    return null;
  h.met.push(action.actor);
  return { unlock: h.actor, by: action.actor };
}

// "+ Find Mara": the player takes the quest to talk to the hidden avatar.
export function seekHidden(world, actor) {
  const target = world.hidden?.actor;
  if (!target || target === actor || world.hidden.met.includes(actor))
    throw new Error("Nobody is hidden here for you to find.");
  if (
    !questsOf(world, actor).some(
      (w) => w.kind === "person" && w.target === target && !w.step,
    )
  )
    pushQuest(world, actor, newWant("person", target, world.turn));
  return world;
}

export function validHidden(world) {
  const h = world.hidden;
  if (
    world.absent !== undefined &&
    (!avatarList(world.absent) ||
      !world.absent.length ||
      world.absent.includes("vale"))
  )
    return false;
  return (
    h === undefined ||
    (Boolean(h) &&
      Object.keys(h).sort().join() === "actor,met,place" &&
      Boolean(humanAvatar(h.actor)) &&
      !world.absent?.includes(h.actor) &&
      typeof h.place === "string" &&
      avatarList(h.met) &&
      !h.met.includes(h.actor))
  );
}
