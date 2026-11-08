import { expect, it } from "vitest";
import { createWorld, legalActions } from "../v2/card-game/world.mjs";
import { availableCards, cardPlay } from "../v2/card-game/cards.mjs";
import { isLockedBox, lockedQuest } from "../v2/card-game/locked-box.mjs";
import {
  entityActive,
  packDefinitions,
  packPeople,
  validatePackDefinition,
} from "../v2/card-game/pack-registry.mjs";

it.each([false, true])(
  "previews an inactive resident without interaction (shared: %s)",
  (shared) => {
    const avatar = packPeople.badger,
      before = { ...avatar };
    const reason = "Return the missing things to this room.";
    avatar.requires = [{ kind: "flag", key: "resident-returned", value: true }];
    avatar.sealed = { at: "clearing", reason };
    try {
      const world = createWorld();
    world.crossings["pond-clearing"].discovered = true;
      const actor = shared ? "mara" : "vale";
      if (shared)
        Object.assign(world, {
          sharedVersion: 1,
          playerActorId: actor,
          controlledActors: [actor],
          presentActors: [actor],
        });
      world.actors[actor].place = "clearing";
      const saved = JSON.stringify(world);
      expect(entityActive(world, "badger")).toBe(false);
      expect(availableCards(world)).toContain("badger");
      expect(isLockedBox(world, "badger")).toBe(true);
      expect(lockedQuest(world, "badger")).toEqual({ text: reason, cards: [] });
      expect(cardPlay(world, ["badger"])).toMatchObject({
        action: undefined,
        hint: reason,
      });
      expect(
        legalActions(world).filter((action) => action.target === "badger"),
      ).toEqual([]);
      expect(JSON.stringify(world)).toBe(saved);
      world.actors[actor].place = "pond";
      expect(availableCards(world)).not.toContain("badger");
      world.actors[actor].place = "clearing";
      world.packs["badger-forest"].flags = { "resident-returned": true };
      expect(entityActive(world, "badger")).toBe(true);
      expect(
        legalActions(world).some(
          (action) => action.kind === "talk" && action.target === "badger",
        ),
      ).toBe(true);
      expect(isLockedBox(world, "badger")).toBe(false);
      expect(
        availableCards(world).filter((id) => id === "badger"),
      ).toHaveLength(1);
      world.actors.badger.place = "pond";
      expect(availableCards(world)).not.toContain("badger");
    } finally {
      delete avatar.requires;
      delete avatar.sealed;
      Object.assign(avatar, before);
    }
  },
);

it("requires an authored place and activation rule for a sealed avatar", () => {
  const pack = structuredClone(
    packDefinitions.find((p) => p.id === "badger-forest"),
  );
  pack.avatars.badger.sealed = {
    at: "clearing",
    reason: "Return the missing things.",
  };
  expect(() => validatePackDefinition(pack)).toThrow(/sealed card/u);
  pack.avatars.badger.requires = [{ kind: "connected_humans", minimum: 2 }];
  expect(() => validatePackDefinition(pack)).not.toThrow();
  pack.avatars.badger.sealed.at = "elsewhere";
  expect(() => validatePackDefinition(pack)).toThrow(/sealed card/u);
});
