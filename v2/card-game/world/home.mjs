// Home and rest (rules 133). Each avatar has its own home: a human avatar's
// from the cast (Vale's is the Mirror attic), a resident's from its pack when
// it levels there. A sanctuary rests anyone; a human avatar's home rests it.
import { humanAvatar, humanAvatarIds } from "../human-cast.mjs";
import { tastes } from "../motives.mjs";
import { packPeople } from "../pack-registry.mjs";
import { sanctuaries } from "./catalog.mjs";

export const homeOf = (id) =>
  (packPeople[id]?.levelAtHome && packPeople[id].home) ||
  tastes[id]?.home ||
  humanAvatar(id)?.home?.id ||
  null;

/**
 * Whether a rest in `place` rests this avatar: a sanctuary rests anyone, and a
 * human avatar's own home rests it. Residents keep the sanctuary rule alone.
 */
export const restsAt = (actor, place) =>
  sanctuaries.includes(place) ||
  (Boolean(place) &&
    humanAvatarIds.includes(actor) &&
    homeOf(actor) === place);
