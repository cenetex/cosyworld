import { entityActive } from "./pack-registry.mjs";
import { itemPlace, rootHolder } from "./world/items.mjs";

export const RADIO_ITEM = "ratiradio-portable-radio";
// Missing means off for saves made before this receiver existed. Do not
// repair an invalid saved switch value into an audible radio.
export function validRadioItem(world) {
  const item = world.items[RADIO_ITEM];
  return (
    !item ||
    !Object.hasOwn(item, "radioOn") ||
    typeof item.radioOn === "boolean"
  );
}
export function radioAudible(world, listener) {
  const item = world.items[RADIO_ITEM],
    actor = world.actors[listener];
  if (
    !item ||
    item.radioOn !== true ||
    !actor ||
    !entityActive(world, RADIO_ITEM) ||
    !entityActive(world, listener)
  )
    return false;
  const place = itemPlace(world, RADIO_ITEM),
    owner = rootHolder(world, RADIO_ITEM);
  return (
    entityActive(world, place) &&
    actor.place === place &&
    (!world.actors[owner] || entityActive(world, owner))
  );
}
