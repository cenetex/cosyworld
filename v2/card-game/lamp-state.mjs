import { heldItem } from "./held-item.mjs";
import { itemPlace, rootHolder } from "./world/items.mjs";
import {
  filledLampRoomFuel,
  roomFuelFromTurns,
  settleLampRoomFuel,
  validLampRoomFuel,
} from "./lamp-room-fuel.mjs";

// The old fuel field remains a fraction-of-tank projection for authored rules.
// Historical observations and released bundles keep their original turn fuel.
export function installLampFuel(world) {
  const lamp = world.items.lamp;
  if (
    !["fuelRooms", "fuelPlace", "fuelVisit"].some((key) =>
      Object.hasOwn(lamp, key),
    )
  )
    Object.assign(lamp, roomFuelFromTurns(lamp.fuel, itemPlace(world, "lamp")));
  if (!validLampRoomFuel(lamp)) throw new Error("Invalid lamp room fuel.");
}
export function fillLampFuel(world) {
  Object.assign(world.items.lamp, filledLampRoomFuel(itemPlace(world, "lamp")));
  world.items.lamp.fuel = 12;
}
export function settleLamp(world) {
  installLampFuel(world);
  const lamp = world.items.lamp,
    owner = rootHolder(world, "lamp");
  Object.assign(
    lamp,
    settleLampRoomFuel(lamp, {
      place: itemPlace(world, "lamp"),
      held: Boolean(world.actors[owner] && heldItem(world, owner) === "lamp"),
      grounded: !world.actors[owner],
    }),
  );
  lamp.fuel = lamp.fuelRooms * 4;
}
