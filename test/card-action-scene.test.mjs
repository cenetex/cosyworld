import { describe, expect, it } from "vitest";
import { actionScene } from "../v2/card-game/quest-screen.mjs";

const base = { actorId: "vale", locationId: "station" };
const visible = () => true;

describe("action scene art", () => {
  it("keeps both items and the recipient in an exchange", () => {
    const trade = {
      ...base,
      verb: "trade",
      itemId: "lamp",
      receiveId: "bell",
      targetId: "keeper",
    };
    expect(actionScene(trade, visible)).toMatchObject({
      actor: "vale",
      here: "station",
      kind: "item",
      items: ["lamp", "bell"],
      to: "keeper",
    });
  });

  it("keeps the defender and the disputed item in an NPC threat", () => {
    const threat = {
      ...base,
      actorId: "moth",
      verb: "threaten",
      itemId: "lamp",
      targetId: "vale",
    };
    expect(actionScene(threat, visible)).toMatchObject({
      actor: "moth",
      verb: "Threaten",
      items: ["lamp"],
      to: "vale",
    });
  });

  it("uses the resolved place for travel and the destination for course", () => {
    const move = { ...base, verb: "move", locationId: "pond" };
    expect(actionScene(move, visible)).toMatchObject({
      kind: "place",
      target: "pond",
    });
    const course = {
      ...base,
      verb: "course",
      targetId: "pond",
      locationId: "greek-ship",
    };
    expect(actionScene(course, visible)).toMatchObject({
      kind: "place",
      target: "pond",
    });
    expect(actionScene(course, (id) => id !== "pond").target).toBe("greek-ship");
  });

  it("keeps covered cards out of the view", () => {
    const give = {
      ...base,
      verb: "give",
      itemId: "lamp",
      targetId: "moth",
    };
    expect(actionScene(give, (id) => id === "vale")).toMatchObject({
      actor: "vale",
      kind: "place",
      items: [],
      target: undefined,
      to: null,
    });
    expect(actionScene(give, (id) => id !== "vale")).toBeNull();
  });
});
