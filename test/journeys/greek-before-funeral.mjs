import "../helpers/still-cast.mjs";
import { createWorld } from "../../v2/card-game/world.mjs";

// The traveller steps ashore at the Wine-Dark Harbor with the ship signal
// already seen and the lamp out. Getting here has its own journey tests
// (card-ship-ritual, card-greek-drama), so this start is the world they
// leave, as `funeralJourney` in test/helpers/greek-funeral.mjs also starts.
export const ashore = () => {
  const world = createWorld();
  world.crossings["pond-greek-harbor"].discovered = true;
  world.actors.vale.place = "greek-harbor";
  world.actors.vale.visited.push("pond", "greek-harbor");
  // She carries the lamp, out; the cloth lies where she left it at the harbor.
  world.items.lamp.holder = "vale";
  world.items.lamp.lit = false;
  world.items.cloth.holder = "greek-harbor";
  return world;
};

const toCourtyard = [{ walk: "courtyard" }, { at: "arrival" }];

// Dione's water jar, her bread, the gate guard's decree, Creon's writ and the
// open gate: the errands that come before the funeral, on today's rules.
export const greekBeforeFuneral = {
  name: "greek-before-funeral",
  start: ashore,
  steps: [
    ...toCourtyard,
    { walk: "well" },
    { kind: "take", item: "greek-water-jar" },
    { walk: "courtyard" },
    { at: "waterOffer" },
    { kind: "give", item: "greek-water-jar", target: "greek-baker" },
    { at: "water" },
    { walk: "gate" },
    { at: "decree" },
    { walk: "courtyard" },
    { kind: "take", item: "greek-bread" },
    { walk: "gate" },
    { kind: "trade", item: "greek-bread", receive: "greek-decree" },
    { at: "traded" },
    { walk: "palace" },
    { kind: "trade", item: "greek-decree", receive: "greek-creon-writ" },
    { at: "writ" },
    { walk: "gate" },
    { kind: "give", item: "greek-creon-writ", target: "greek-guard" },
    { at: "opened" },
  ],
};

// The traveller who skips Dione's water goes straight to the gate.
export const greekBeforeFuneralDry = {
  name: "greek-before-funeral-dry",
  start: ashore,
  steps: [...toCourtyard, { walk: "gate" }, { at: "decree" }],
};
