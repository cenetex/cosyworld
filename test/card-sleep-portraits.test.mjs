import { describe, expect, it } from "vitest";
import { createWorld, legalActions, play } from "../v2/card-game/world.mjs";
import { humanAvatarIds } from "../v2/card-game/human-cast.mjs";
import { portrait, sceneStaging } from "../v2/card-game/scene.mjs";
import { scarfItemId } from "../v2/card-game/scarves.mjs";
import {
  sleepingPortrait,
  sleepPortraitAssets,
} from "../v2/card-game/sleep-portraits.mjs";
import {
  flipStagePortrait,
  portraitFraming,
} from "../v2/card-game/portrait-facing.mjs";
import { publicAssets } from "../v2/card-game/public-assets.mjs";

const wait = (world) =>
  play(
    world,
    legalActions(world).find((a) => a.kind === "wait"),
  ).state;

describe("sleeping art", () => {
  it("follows the shared sleep state until the committed waking Wait", () => {
    let world = createWorld();
    world.sharedVersion = 1;
    world.actors.vale.place = "attic";
    world = wait(world);
    expect(world.actors.vale.sleepUntil).toBeDefined();
    const file = "./assets/shared/characters/vale-sleeping.webp";
    expect(portrait("vale", null, world)).toBe(file);
    expect(sceneStaging(world, { cast: ["vale"] }).actors[0]).toMatchObject({
      id: "vale",
      cutout: file,
      pose: "sleep",
    });
    world.turn = world.revision = world.actors.vale.sleepUntil;
    expect(portrait("vale", null, world)).toBe(file);
    world = wait(world);
    expect(sleepingPortrait(world, "vale")).toBeNull();
    expect(portrait("vale", null, world)).toBe(
      "./assets/shared/characters/vale.png",
    );
  });

  it("keeps ordinary Waits and unsupported sleepers on their existing art", () => {
    const world = createWorld();
    world.actors.vale.place = "station";
    expect(sleepingPortrait(wait(world), "vale")).toBeNull();
    const before = portrait("greek-baker", null, world);
    world.actors["greek-baker"].sleepUntil = 24;
    expect(portrait("greek-baker", null, world)).toBe(before);
    expect(sleepingPortrait(null, "vale")).toBeNull();
    expect(sleepingPortrait(world, "unknown")).toBeNull();
  });

  it.each(humanAvatarIds)(
    "preserves %s's scarf custody and permanent upgrade",
    (id) => {
      const world = createWorld();
      world.actors[id].sleepUntil = 24;
      const plain = `assets/shared/characters/${id}-sleeping.webp`;
      const scarf = `assets/shared/characters/${id}-sleeping-scarf.webp`;
      expect(sleepingPortrait(world, id)).toBe(plain);
      world.items[scarfItemId(id)] = { holder: id };
      expect(sleepingPortrait(world, id)).toBe(scarf);
      world.items[scarfItemId(id)].holder = "station";
      expect(sleepingPortrait(world, id)).toBe(plain);
      world.actors[id].upgrades = ["scarf"];
      expect(sleepingPortrait(world, id)).toBe(scarf);
      delete world.actors[id].sleepUntil;
      expect(sleepingPortrait(world, id)).toBeNull();
      expect(portrait(id, null, world)).toBe(
        `./assets/shared/characters/${id}-scarf.png`,
      );
    },
  );

  it("publishes the complete pack and never mirrors the keeper's clock", () => {
    expect(sleepPortraitAssets).toHaveLength(18);
    const published = new Set(publicAssets.map(({ file }) => file));
    for (const file of sleepPortraitAssets) {
      expect(published.has(file), file).toBe(true);
      expect(portraitFraming(file), file).toBe("wide");
    }
    const world = createWorld();
    for (const id of ["moth", "keeper"]) {
      world.actors[id].sleepUntil = 24;
      expect(portrait(id, null, world)).toBe(
        `./assets/sleep/${id}-sleeping.webp`,
      );
    }
    for (const facing of ["left", "right"])
      expect(flipStagePortrait(portrait("keeper", facing, world), facing)).toBe(
        false,
      );
    expect(flipStagePortrait(portrait("moth", "right", world), "right")).toBe(
      true,
    );
  });
});
