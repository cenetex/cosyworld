import { humanAvatarIds } from "../human-cast.mjs";
import { homeOf } from "../resident-home.mjs";
import { sanctuaries } from "./catalog.mjs";

export { homeOf };

/**
 * Whether a rest in `place` rests this avatar: a sanctuary rests anyone, and a
 * human avatar's own home rests it. Residents keep the sanctuary rule alone.
 */
export const restsAt = (actor, place) =>
  sanctuaries.includes(place) ||
  (Boolean(place) &&
    humanAvatarIds.includes(actor) &&
    homeOf(actor) === place);
