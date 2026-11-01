import { describe, it, expect } from "vitest";
import { createWorld, addLog, people } from "../v2/card-game/world.mjs";
import { humanAvatarIds, humanAvatars } from "../v2/card-game/human-cast.mjs";
import { packPeople } from "../v2/card-game/pack-registry.mjs";
import { portrait, sceneStaging } from "../v2/card-game/scene.mjs";
import {
  nativePortraitFacing,
  flipStagePortrait,
  portraitFraming,
} from "../v2/card-game/portrait-facing.mjs";

describe("stage portrait art directions", () => {
  it("uses the plain picker portraits on stage, including Vale", () => {
    for (const avatar of humanAvatars) {
      expect(avatar.image).toBe(`assets/shared/characters/${avatar.id}.png`);
      for (const facing of ["left", "right"])
        expect(portrait(avatar.id, facing)).toBe(`./${avatar.image}`);
      expect(nativePortraitFacing(avatar.image)).toBe("right");
      expect(
        nativePortraitFacing(`assets/shared/characters/${avatar.id}-scarf.png`),
      ).toBe("right");
    }
  });

  it("frames broad forest animals on phones and keeps the other figures at their usual size", () => {
    for (const name of ["skull", "whiskerwind"]) {
      const path = `assets/lonely-forest/${name}.png`;
      expect(portraitFraming(`./${path}`)).toBe("wide");
      expect(nativePortraitFacing(path)).toBe("right");
      expect(flipStagePortrait(path, "left")).toBe(true);
    }
    for (const path of [
      "assets/lonely-forest/rati.png",
      "assets/shared/characters/vale.png",
    ])
      expect(portraitFraming(path)).toBe("standard");
  });

  it("describes every avatar image, both Keeper cutouts, and portrait variant", () => {
    const images = Object.keys(people).flatMap((id) => [
      portrait(id, "left"),
      portrait(id, "right"),
      ...Object.values(packPeople[id]?.variants || {})
        .filter((variant) => variant.portrait)
        .map((variant) => variant.portrait),
    ]);
    for (const image of new Set(images))
      expect(nativePortraitFacing(image), image).toMatch(
        /^(left|right|front)$/,
      );
    for (const actor of humanAvatarIds)
      expect(nativePortraitFacing(portrait(actor)), actor).toBe("right");
    expect(nativePortraitFacing(portrait("greek-baker"))).toBe("left");
  });

  it.each(humanAvatarIds)(
    "faces Dione from both sides for shared %s",
    (actor) => {
      for (const from of ["greek-harbor", "greek-well"]) {
        const world = createWorld();
        world.sharedVersion = 1;
        world.playerActorId = actor;
        world.controlledActors = [actor];
        world.presentActors = [actor];
        world.actors[actor].place = "greek-courtyard";
        world.crossings["pond-greek-harbor"].discovered = true;
        addLog(world, actor, "The traveler arrives.", {
          kind: "action",
          verb: "move",
          actorId: actor,
          fromLocationId: from,
          locationId: "greek-courtyard",
        });
        const stage = sceneStaging(world, { cast: [actor, "greek-baker"] });
        expect(stage.focalId).toBe(actor);
        for (const figure of stage.actors) {
          const target = stage.actors.find(
            (other) => other.id === figure.gazeTargetId,
          );
          expect(target).toBeDefined();
          const desired = target.x > figure.x ? "right" : "left";
          expect(figure.facing).toBe(desired);
          const native = figure.id === actor ? "right" : "left";
          const rendered = flipStagePortrait(figure.cutout, figure.facing)
            ? native === "right"
              ? "left"
              : "right"
            : native;
          expect(rendered, `${actor} from ${from}: ${figure.id}`).toBe(desired);
        }
      }
    },
  );

  it("keeps the directional Keeper cutouts and frontal Badger poses", () => {
    for (const path of [
      "assets/moth.png",
      "assets/keeper.png",
      "assets/keeper-right.png",
    ])
      expect(portraitFraming(path)).toBe("wide");
    for (const direction of ["left", "right"])
      expect(flipStagePortrait(portrait("keeper", direction), direction)).toBe(
        false,
      );
    for (const variant of ["sleeping", "grumpy"])
      for (const direction of ["left", "right"])
        expect(
          flipStagePortrait(
            `assets/badger-forest/badger-${variant}.png`,
            direction,
          ),
        ).toBe(false);
  });
});
