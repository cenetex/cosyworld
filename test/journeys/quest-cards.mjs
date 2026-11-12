import "../helpers/still-cast.mjs";
import { createWorld } from "../../v2/card-game/world.mjs";

// A fresh world to the first level, every quest held at once (rules 134):
// put the lamp out (the Black pond opens, 1 XP), carry the lamp to Pip and
// Talk (his quest is held as the Talk ends), meet it (1 XP, and 1 for helping
// him), reach the threshold of level 2 (the level-up quest is held), go home
// to the attic and sleep there. The sleep pays no XP and the level rises.
export const questCards = {
  name: "quest-cards",
  start: () => createWorld({ opening: true, seed: 17 }),
  steps: [
    { hold: null },
    { at: "opened" },
    { kind: "move", item: "lamp", target: "pond" },
    { kind: "talk", target: "moth" },
    { at: "told" },
    { at: "accepted" },
    { kind: "give", item: "lamp", target: "moth" },
    { at: "met" },
    { at: "sleepQuest" },
    { kind: "move", target: "attic" },
    { kind: "wait" },
    { kind: "wait", sleep: true },
    { at: "levelled" },
  ],
};
