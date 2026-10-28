import { describe, it, expect } from "vitest";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  nameOf,
} from "../v2/card-game/world.mjs";
import { availableCards } from "../v2/card-game/cards.mjs";
import {
  entityActive,
  validatePackDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { questCards } from "../v2/card-game/quest-cards.mjs";
import {
  boardyPack,
  boardyFacts,
  boardyGathering,
} from "../v2/card-game/boardyai.mjs";

const view = (world, present = ["vale", "mara"], actor = "vale") =>
  dispatchShared({
    op: "view",
    world,
    actor,
    claimed: ["vale", "mara", "ash", "nell"],
    present,
  });
const fresh = () =>
  dispatchShared({ op: "create", save: encodeSave(createWorld()) }).world;

describe("BoardyAI's lasting quest", () => {
  it("uses connected humans to decide when he appears", () => {
    const world = fresh();
    expect(entityActive(createWorld(), "boardyai")).toBe(false);
    for (const present of [[], ["vale"]]) {
      const result = view(world, present);
      expect(entityActive(result.world, "boardyai")).toBe(false);
      expect(availableCards(result.world)).not.toContain("boardyai");
      expect(result.actions.some((a) => a.target === "boardyai")).toBe(false);
    }
    const result = view(world);
    expect(availableCards(result.world)).toContain("boardyai");
    expect(
      result.actions.some((a) => a.kind === "talk" && a.target === "boardyai"),
    ).toBe(true);
    expect(result.world.actors.boardyai.place).toBe(world.actors.vale.place);
  });

  it("gives every reader the same gathering and follows the largest human group", () => {
    const world = fresh();
    world.actors.mara.place = world.actors.ash.place = "pond";
    const present = ["vale", "mara", "ash"];
    const vale = view(world, present);
    const mara = view(world, [...present].reverse(), "mara");
    expect(vale.world.actors.boardyai.place).toBe("pond");
    expect(mara.world.actors.boardyai).toEqual(vale.world.actors.boardyai);
    expect(boardyGathering(mara.world).humans).toEqual(["mara", "ash"]);
    expect(availableCards(mara.world)).toContain("boardyai");
    for (const id of ["vale", "mara", "ash", "nell"])
      world.actors[id].place = "pond";
    expect(
      availableCards(view(world, ["vale", "mara", "ash", "nell"]).world),
    ).toContain("boardyai");
  });

  it("keeps the same quest through shared plays, reloads, meetings and departures", () => {
    let world = fresh();
    const originalPlaces = Object.fromEntries(
      ["vale", "mara"].map((id) => [id, world.actors[id].place]),
    );
    const quest = questCards(view(world).world, "boardyai")[0];
    expect(quest).toMatchObject({
      key: "boardyai:together",
      purpose: "Bring two human players together.",
      status: "active",
      ongoing: true,
    });
    for (let turn = 0; turn < 12; turn++) {
      const v = view(world);
      world = dispatchShared({
        op: "play",
        world,
        actor: "vale",
        claimed: ["vale", "mara"],
        present: ["vale", "mara"],
        action: v.actions.find((a) => a.kind === "wait"),
      }).world;
      expect(
        questCards(view(decodeSave(encodeSave(world))).world, "boardyai"),
      ).toEqual([quest]);
    }
    for (const [id, place] of Object.entries(originalPlaces))
      expect(world.actors[id].place).toBe(place);
    world.actors.mara.place = world.actors.vale.place;
    expect(boardyFacts(view(world).world, nameOf).join(" ")).toContain(
      "Two human players are together here",
    );
    expect(questCards(view(world).world, "boardyai")).toEqual([quest]);
    const absent = view(world, ["vale"]);
    expect(availableCards(absent.world)).not.toContain("boardyai");
    expect(questCards(view(absent.world).world, "boardyai")).toEqual([quest]);
  });

  it("gives dialogue the connected humans and their real meeting places", () => {
    const world = fresh();
    const result = view(world);
    const response = dispatchShared({
      op: "play",
      world,
      actor: "vale",
      claimed: ["vale", "mara"],
      present: ["vale", "mara"],
      action: result.actions.find(
        (a) => a.kind === "talk" && a.target === "boardyai",
      ),
    });
    expect(response.ok).toBe(true);
    const boardy = response.context.entities.find((e) => e.id === "boardyai");
    expect(boardy.facts.join(" ")).toContain(
      "Mara is a connected human at Paper theatre",
    );
    expect(boardy.facts.join(" ")).toContain(
      `Invite the humans to meet at ${nameOf(world.actors.vale.place)}`,
    );
    expect(boardy.facts.join(" ")).toContain(
      "My active purpose is Two humans together",
    );
    expect(boardy.facts.join(" ")).toContain(
      "My calling card opens its door at Black pond",
    );
  });

  it("keeps a guest's carried items with his visible presence", () => {
    const world = fresh();
    world.items.cloth.holder = "boardyai";
    expect(entityActive(view(world).world, "cloth")).toBe(true);
    expect(entityActive(view(world, ["vale"]).world, "cloth")).toBe(false);
  });

  it("opens his home from Black pond with his calling card and keeps the return door", () => {
    let world = fresh();
    world.actors.vale.place = "pond";
    const act = (kind, field, value) => {
      const action = view(world).actions.find(
        (a) => a.kind === kind && a[field] === value,
      );
      expect(action).toBeDefined();
      const result = dispatchShared({
        op: "play",
        world,
        actor: "vale",
        claimed: ["vale", "mara"],
        present: ["vale", "mara"],
        action,
      });
      expect(result.ok).toBe(true);
      world = result.world;
    };
    expect(availableCards(view(world).world)).toContain(
      "boardyai-calling-card",
    );
    expect(view(world).exits).toContain("boardyai-parlour");
    world.items["boardyai-calling-card"].holder = "mara";
    expect(view(world).exits).not.toContain("boardyai-parlour");
    world.items["boardyai-calling-card"].holder = "pond";
    act("take", "item", "boardyai-calling-card");
    act("move", "target", "boardyai-parlour");
    expect(world.actors.vale.place).toBe("boardyai-parlour");
    expect(world.items["boardyai-calling-card"].holder).toBe("vale");
    expect(view(decodeSave(encodeSave(world)), ["vale"]).exits).toContain(
      "pond",
    );
    act("move", "target", "pond");
    expect(world.actors.vale.place).toBe("pond");
    expect(view(world).exits).toContain("boardyai-parlour");
  });

  it("validates his home and bounded human presence conditions", () => {
    expect(validatePackDefinition(boardyPack)).toBe(boardyPack);
    for (const minimum of [0, 9, 1.5, "2"]) {
      const invalid = structuredClone(boardyPack);
      invalid.avatars.boardyai.requires[0].minimum = minimum;
      expect(() => validatePackDefinition(invalid)).toThrow();
    }
    const invalid = structuredClone(boardyPack);
    invalid.avatars.boardyai.place = "missing-home";
    expect(() => validatePackDefinition(invalid)).toThrow();
  });
});
