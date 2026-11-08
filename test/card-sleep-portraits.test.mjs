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
  nativePortraitFacing,
  portraitFraming,
} from "../v2/card-game/portrait-facing.mjs";
import { publicAssets } from "../v2/card-game/public-assets.mjs";

const choose = (world, pick, actor = "vale") =>
  play(world, legalActions(world, actor).find(pick), world.revision, actor)
    .state;
const wait = (world, actor) => choose(world, (a) => a.kind === "wait", actor);
// Sleep is the Wait offered after a Wait.
const sleep = (world, actor) =>
  choose(wait(world, actor), (a) => a.sleep, actor);
// A shared world, where a sleeper sleeps on while other seats play.
const seated = (ids, place = "glasshouse") => {
  const world = createWorld();
  world.sharedVersion = 1;
  world.controlledActors = world.presentActors = world.heldActors = [...ids];
  for (const id of ids) world.actors[id].place = place;
  return world;
};

describe("sleeping art", () => {
  it("shows Dione's approved sleep art on the card and stage until she wakes", () => {
    let world = createWorld({ packScopes: { "greek-drama": "full" } });
    world.turn = world.revision = 91;
    world.actors.vale.place = "greek-courtyard";
    world.actors["greek-baker"].place = "greek-courtyard";
    world.packs["greek-drama"].met["greek-baker"] = 0;
    world.actors["greek-baker"].sleeping = {
      since: 90,
      place: "greek-courtyard",
      until: 96,
    };
    const art = "./assets/sleep/greek-baker-sleeping.png";
    expect(sleepingPortrait(world, "greek-baker")).toBe(art.slice(2));
    expect(portrait("greek-baker", null, world)).toBe(art);
    expect(
      sceneStaging(world, { cast: ["greek-baker"] }).actors[0],
    ).toMatchObject({ id: "greek-baker", cutout: art, pose: "sleep" });
    expect(sleepPortraitAssets).toContain(art.slice(2));
    expect(nativePortraitFacing(art)).toBe("left");
    expect(flipStagePortrait(art, "right")).toBe(true);

    world.turn = world.revision = 95;
    const awake = wait(world, "vale");
    expect(awake.turn).toBe(96);
    expect(awake.actors["greek-baker"].sleeping).toBeUndefined();
    expect(portrait("greek-baker", null, awake)).toBe(
      "./assets/greek-drama/chthonic-baker.png",
    );
    expect(
      sceneStaging(awake, { cast: ["greek-baker"] }).actors[0],
    ).toMatchObject({ cutout: "./assets/greek-drama/chthonic-baker.png" });
  });

  it("follows the committed sleep state until the sleeper wakes", () => {
    let world = sleep(seated(["vale"]), "vale");
    expect(world.actors.vale.sleeping).toBeDefined();
    const file = "./assets/shared/characters/vale-sleeping.webp";
    expect(portrait("vale", null, world)).toBe(file);
    expect(sceneStaging(world, { cast: ["vale"] }).actors[0]).toMatchObject({
      id: "vale",
      cutout: file,
      pose: "sleep",
    });
    // Sleeping on keeps the art; choosing a Wait wakes her first.
    world = choose(world, (a) => a.sleep);
    expect(portrait("vale", null, world)).toBe(file);
    world = choose(world, (a) => a.kind === "wait" && !a.sleep);
    expect(world.actors.vale.sleeping).toBeUndefined();
    expect(sleepingPortrait(world, "vale")).toBeNull();
    expect(portrait("vale", null, world)).toBe(
      "./assets/shared/characters/vale.png",
    );
  });

  it("keeps ordinary Waits and unsupported sleepers on their existing art", () => {
    const world = createWorld();
    world.actors.vale.place = "station";
    expect(sleepingPortrait(wait(world), "vale")).toBeNull();
    // Residents never Sleep; one marked asleep without art keeps its own.
    const before = portrait("greek-creon", null, world);
    world.actors["greek-creon"].sleeping = {
      since: 0,
      place: "x",
      present: [],
    };
    expect(portrait("greek-creon", null, world)).toBe(before);
    expect(sleepingPortrait(null, "vale")).toBeNull();
    expect(sleepingPortrait(world, "unknown")).toBeNull();
  });

  it.each(humanAvatarIds)(
    "preserves %s's scarf custody and permanent upgrade",
    (id) => {
      const world = sleep(seated([id]), id);
      expect(world.actors[id].sleeping).toBeDefined();
      const asleep = structuredClone(world);
      const plain = `assets/shared/characters/${id}-sleeping.webp`;
      const scarf = `assets/shared/characters/${id}-sleeping-scarf.webp`;
      expect(sleepingPortrait(world, id)).toBe(plain);
      world.items[scarfItemId(id)] = { holder: id };
      expect(sleepingPortrait(world, id)).toBe(scarf);
      world.items[scarfItemId(id)].holder = "station";
      expect(sleepingPortrait(world, id)).toBe(plain);
      world.actors[id].upgrades = ["scarf"];
      expect(sleepingPortrait(world, id)).toBe(scarf);
      // Choosing another play wakes the sleeper first.
      const awake = choose(asleep, (a) => a.kind === "move", id);
      expect(awake.actors[id].sleeping).toBeUndefined();
      awake.actors[id].upgrades = ["scarf"];
      expect(sleepingPortrait(awake, id)).toBeNull();
      expect(portrait(id, null, awake)).toBe(
        `./assets/shared/characters/${id}-scarf.png`,
      );
    },
  );

  it("publishes the complete pack and never mirrors the keeper's clock", () => {
    expect(sleepPortraitAssets).toHaveLength(19);
    const published = new Set(publicAssets.map(({ file }) => file));
    for (const file of sleepPortraitAssets) {
      expect(published.has(file), file).toBe(true);
      expect(portraitFraming(file), file).toBe("wide");
    }
    // Residents never Sleep under the rules; their art follows the same
    // committed state should a later rule let them.
    const world = createWorld();
    for (const id of ["moth", "keeper"]) {
      world.actors[id].sleeping = { since: 0, place: "attic", present: [] };
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
