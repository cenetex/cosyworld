import "../helpers/still-cast.mjs";
import { createWorld } from "../../v2/card-game/world.mjs";

export const questCards = {
  name: "quest-cards",
  start: () => createWorld({ opening: true, seed: 17 }),
  steps: [
    { hold: null },
    { at: "opened" },
    { kind: "move", item: "lamp", target: "pond" },
    { kind: "talk", target: "moth" },
    { at: "told" },
    { kind: "give", item: "lamp", target: "moth" },
    { at: "met" },
    { at: "sleepQuest" },
    { kind: "move", target: "attic" },
    { kind: "wait" },
    { kind: "wait", sleep: true },
    { at: "levelled" },
  ],
};
