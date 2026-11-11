// A discoverable secret waits in the location's ordinary item stack. This
// is presentation custody only: a boxed resident is not an inventory item,
// and a boxed destination is not a traversable exit. Only already-authored
// locks count; absence, disabled packs and personal avatar discovery do not.
import { isLockedBox } from "./locked-box.mjs";
import { cardType } from "./cards.mjs";
import { currentActor, rootHolder, things } from "./world.mjs";

export function tableHolder(world, id) {
  if (isLockedBox(world, id)) return world.actors[currentActor(world)].place;
  return things[id] ? rootHolder(world, id) : null;
}

// All mysteries have the same silhouette until the committed rules reveal
// their contents. On opening, their original type and holder take over.
export function tableType(world, id) {
  return isLockedBox(world, id) ? "item" : cardType(id);
}
