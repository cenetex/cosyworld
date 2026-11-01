import { expect, it } from "vitest";
import {
  archiveLocal,
  avatarSlot,
  deleteLocal,
  createAvatarWorld,
  localWorldName,
} from "../v2/card-game/avatar-world.mjs";
import {
  decodeSave,
  encodeSave,
  legalActions,
} from "../v2/card-game/world.mjs";
import { worldName } from "../v2/card-game/world-name.mjs";
import { createLandingWorld } from "../v2/card-game/pack-landing.mjs";

it("starts another avatar's local world at its own home", () => {
  const world = decodeSave(encodeSave(createAvatarWorld("ash", 9)));
  expect(world.playerActorId).toBe("ash");
  expect(world.actors.ash.place).toBe("belfry");
  expect(world.items.float.holder).toBe("belfry");
  expect(legalActions(world, "ash").map((a) => a.key)).toContain(
    "take:ash:float:",
  );
});

it("keeps the lamp in Vale's hand and leaves it in the attic for others", () => {
  for (const world of [
    createLandingWorld(null, 9),
    createAvatarWorld("vale", 9),
  ])
    expect(world.items.lamp).toMatchObject({ holder: "vale", lit: true });
  for (const id of ["tavi", "ash"]) {
    const world = decodeSave(encodeSave(createAvatarWorld(id, 9)));
    expect(world.actors.vale.place).toBe("attic");
    expect(world.items.lamp).toMatchObject({
      holder: "attic",
      lit: true,
      fuel: 12,
    });
    expect(world.log[0].items).toContainEqual(
      expect.objectContaining({ id: "lamp", holder: "attic" }),
    );
    expect(world.log[0].text).not.toMatch(/holding/);
    expect(JSON.stringify(world.memories)).not.toMatch(/holding a lamp/);
  }
});

it("keeps Vale in the original slot and names each local world", () => {
  const store = new Map();
  const storage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
  expect(avatarSlot("vale")).toBe("cosyworld.reflected-shore.v1");
  expect(avatarSlot("ash")).toBe("cosyworld.reflected-shore.v1.avatar.ash");
  storage.setItem(avatarSlot("ash"), encodeSave(createAvatarWorld("ash", 9)));
  expect(localWorldName("ash", storage)).toBe(worldName(9));
  expect(localWorldName("mara", storage)).toBe(null);
  archiveLocal("ash", storage);
  expect(localWorldName("ash", storage)).toBe(null);
  expect(store.has(`${avatarSlot("ash")}.bak`)).toBe(true);
  storage.setItem(avatarSlot("ash"), encodeSave(createAvatarWorld("ash", 9)));
  deleteLocal("ash", storage);
  expect(localWorldName("ash", storage)).toBe(null);
  expect(store.has(`${avatarSlot("ash")}.bak`)).toBe(false);
});
