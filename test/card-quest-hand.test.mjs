import { describe, expect, it } from "vitest";
import { questing } from "./helpers/first-quest.mjs";
import { createWorld, legalActions, play } from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { besideOwners, notBehindOwners, tableQuests } from "../v2/card-game/quest-hand.mjs";
import { questCards } from "../v2/card-game/quest-card.mjs";

const talk = (s, target) =>
  play(
    s,
    legalActions(s).find((a) => a.kind === "talk" && a.target === target),
  ).state;

const station = () => {
  const s = enableMotives(questing(createWorld()));
  for (const id of ["vale", "moth", "keeper"]) s.actors[id].place = "station";
  s.items.lamp.holder = "vale";
  s.actors.vale.want = null;
  s.actors.keeper.want = null;
  return s;
};
const play1 = (s, pick) => play(s, legalActions(s).find(pick)).state;

describe("the quest card behind a resident", () => {
  it("stays with its owner while the want stands, taken or not, and goes once met", () => {
    const s = talk(station(), "moth");
    const taken = play1(s, (a) => a.kind === "accept" && a.target === "moth");
    expect(tableQuests(taken, "vale", ["moth"])).toMatchObject([
      { owner: "moth", quest: { offer: "moth", target: "lamp" } },
    ]);
    expect(notBehindOwners(questCards(taken, "vale"), () => tableQuests(taken, "vale", ["moth"]))).toEqual([]);
    expect(notBehindOwners(questCards(taken, "vale"), () => [])).toMatchObject([{ target: "lamp" }]);
    const met = play1(s, (a) => a.kind === "give" && a.item === "lamp" && a.target === "moth");
    expect(tableQuests(met, "vale", ["moth"])).toEqual([]);
  });

  it("lies face down until a Talk teaches it, then face up", () => {
    let s = station();
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
