import { describe, expect, it } from "vitest";
import { questing } from "./helpers/first-quest.mjs";
import { createWorld, legalActions, play } from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { besideOwners, tableQuests } from "../v2/card-game/quest-hand.mjs";

const talk = (s, target) =>
  play(
    s,
    legalActions(s).find((a) => a.kind === "talk" && a.target === target),
  ).state;

describe("the quest card behind a resident", () => {
  it("lies face down until a Talk teaches it, then face up", () => {
    let s = enableMotives(questing(createWorld()));
    for (const id of ["vale", "moth", "keeper"]) s.actors[id].place = "station";
    s.items.lamp.holder = "vale";
    s.actors.vale.want = null;
    s.actors.keeper.want = null;
    const table = () => tableQuests(s, "vale", ["vale", "moth", "keeper"]);
    expect(table()).toEqual([{ id: "offer:moth", owner: "moth", quest: null }]);
    s = talk(s, "moth");
    expect(table()).toMatchObject([
      {
        id: "offer:moth",
        owner: "moth",
        quest: { offer: "moth", target: "lamp" },
      },
    ]);
    expect(besideOwners(["vale", "lamp", "moth", "cloth", "keeper"], table(), s)).toEqual([
      "vale",
      "lamp",
      "moth",
      "cloth",
      "offer:moth",
      "keeper",
    ]);
  });
});
