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
import { enableMotives } from "../v2/card-game/motives.mjs";
import { questCards } from "../v2/card-game/quest-cards.mjs";
import { boardyPack, boardyFacts } from "../v2/card-game/boardyai.mjs";

const view = (world, present = ["vale", "mara"], actor = "vale") =>
  dispatchShared({
    op: "view",
    world,
    actor,
    claimed: ["vale", "mara", "ash", "nell"],
    present,
  });
const fresh = () =>
  dispatchShared({
    op: "create",
    save: encodeSave(enableMotives(createWorld(), { personalQuests: true })),
  }).world;

describe("BoardyAI's quests and home", () => {
  it("appears for two connected humans and keeps his physical place", () => {
    const world = fresh();
    for (const present of [[], ["vale"]])
      expect(entityActive(view(world, present).world, "boardyai")).toBe(false);
    expect(entityActive(view(world).world, "boardyai")).toBe(true);
    expect(view(world).world.actors.boardyai.place).toBe("boardyai-parlour");
    world.actors.vale.place = "boardyai-parlour";
    expect(availableCards(view(world).world)).toContain("boardyai");
  });

  it("keeps the same position and search state across readers and reloads", () => {
    const world = fresh();
    world.actors.boardyai.place = "pond";
    const before = encodeSave(world);
    const a = view(world);
    const b = view(world, ["mara", "vale"], "mara");
    expect(a.world.actors.boardyai).toEqual(b.world.actors.boardyai);
    expect(a.world.actors.boardyai.place).toBe("pond");
    expect(encodeSave(world)).toBe(before);
    expect(view(decodeSave(before)).world.actors.boardyai.place).toBe("pond");
  });

  it("keeps human locations out of his facts until he has seen them", () => {
    const world = fresh();
    world.actors.boardyai.place = "station";
    const context = view(world).world;
    expect(boardyFacts(context, nameOf).join(" ")).toContain(
      "I have yet to find Mara",
    );
    expect(boardyFacts(context, nameOf).join(" ")).not.toContain(
      "Paper theatre",
    );
  });

  it("keeps a guest's carried items with his visible presence", () => {
    const world = fresh();
    world.items.cloth.holder = "boardyai";
    expect(entityActive(view(world).world, "cloth")).toBe(true);
    expect(entityActive(view(world, ["vale"]).world, "cloth")).toBe(false);
  });

  it("opens his home from Empty station with his calling card and keeps the return door", () => {
    let world = fresh();
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
    world.items["boardyai-calling-card"].holder = "station";
    act("take", "item", "boardyai-calling-card");
    act("move", "target", "boardyai-parlour");
    expect(world.actors.vale.place).toBe("boardyai-parlour");
    expect(world.items["boardyai-calling-card"].holder).toBe("vale");
    expect(view(decodeSave(encodeSave(world)), ["vale"]).exits).toContain(
      "station",
    );
    act("move", "target", "station");
    expect(world.actors.vale.place).toBe("station");
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
