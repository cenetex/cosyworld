import { humanPresent } from "./human-cast.mjs";
import { gone } from "./item-use.mjs";
import { nameOf } from "./world/catalog.mjs";
import { giveUpForGood } from "./world/for-good.mjs";

export const STATION_LANTERN = "station-lantern";
const WICK = "station-lantern-wick";
const STATION = "station";

export function stationLanternAction(world, actor, offer) {
  const lantern = world.items[STATION_LANTERN];
  if (world.actors[actor]?.place !== STATION || !humanPresent(world, actor) || lantern.lit)
    return null;
  const who = nameOf(actor);
  if (lantern.repaired)
    return {
      ...offer("use", actor, STATION_LANTERN, null,
        `${who} lights the station lantern. Its beam reaches across Black Pond.`, [STATION_LANTERN]),
      label: "Light lantern",
    };
  if (world.items[WICK].holder !== actor || gone(world, WICK)) return null;
  return {
    ...offer("use", actor, WICK, STATION_LANTERN,
      `${who} fits a fresh wick in the station lantern. It is ready to light.`, [WICK, STATION_LANTERN]),
    label: "Repair lantern",
  };
}

export function useStationLantern(world, action) {
  const lantern = world.items[STATION_LANTERN];
  if (action.item === STATION_LANTERN) lantern.lit = true;
  else if (action.target === STATION_LANTERN) {
    giveUpForGood(world, WICK);
    lantern.repaired = true;
    lantern.fuel = 1;
  } else return false;
  return true;
}

export function validStationLantern(world) {
  const lantern = world.items[STATION_LANTERN];
  const stationSignal = world.crossings?.["pond-greek-harbor"]?.method === STATION_LANTERN;
  return lantern?.holder === STATION && !gone(world, STATION_LANTERN) &&
    typeof lantern.lit === "boolean" && typeof lantern.repaired === "boolean" &&
    lantern.fuel === Number(lantern.repaired) && (!lantern.lit || lantern.repaired) &&
    (!lantern.repaired || gone(world, WICK)) && (!stationSignal || lantern.lit);
}
