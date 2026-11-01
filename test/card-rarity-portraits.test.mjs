import { describe, expect, it } from "vitest";
import {
  decodeSave,
  encodeSave,
  legalActions,
  nameOf,
  play,
} from "../v2/card-game/world.mjs";
import {
  createLandingWorld,
  landingPack,
} from "../v2/card-game/pack-landing.mjs";
import { portrait, sceneScript, sceneStaging } from "../v2/card-game/scene.mjs";
import { combatPortrait } from "../v2/card-game/combat-portraits.mjs";
import {
  crossedPortraitTier,
  rarityForms,
} from "../v2/card-game/rarity-portraits.mjs";
import { levelOf, newWant } from "../v2/card-game/want.mjs";
import { sceneVideoContext } from "../v2/card-game/scene-video-context.mjs";
import {
  flipStagePortrait,
  portraitFraming,
} from "../v2/card-game/portrait-facing.mjs";

const fresh = () =>
  createLandingWorld(landingPack("https://hoppy.lonelyforest.com"));
describe("earned Hoppy Cat portraits", () => {
  it.each(Object.entries(rarityForms))(
    "transforms %s on earned XP and keeps that form after a save",
    (id, form) => {
      let world = fresh();
      const base = portrait(id),
        threshold = (form.level * (form.level - 1)) / 2;
      expect(portrait(id, null, world)).toBe(base);
      world.turn = 1000;
      world.revision = world.turn;
      world.actors[id].xp = threshold - 1;
      world.actors.vale.place = world.actors[id].place;
      world.packs["hoppycat-archive"].met[id] = world.turn;
      world.actors[id].want = newWant("person", "vale", world.turn);
      expect(portrait(id, null, world)).toBe(base);
      const result = play(
        world,
        legalActions(world).find(
          (action) => action.kind === "talk" && action.target === id,
        ),
      );
      expect(result.ok, result.error).toBe(true);
      world = decodeSave(encodeSave(result.state));
      expect(levelOf(world, id)).toBe(form.level);
      expect(
        world.log.some(
          (event) => event.actorId === id && event.verb === "want_met",
        ),
      ).toBe(true);
      for (const facing of [null, "left", "right"])
        expect(portrait(id, facing, world)).toBe(`./${form.portrait}`);
      expect(
        sceneStaging(world, { cast: [id] }).actors.find(
          (actor) => actor.id === id,
        ).cutout,
      ).toBe(`./${form.portrait}`);
      expect(
        sceneScript(world).avatars.find((actor) => actor.id === id)
          .facingCutouts,
      ).toEqual({ left: `./${form.portrait}`, right: `./${form.portrait}` });
      expect(
        sceneScript(world).avatars.find((actor) => actor.id === id)
          .nativeFacing,
      ).toBe(form.facing);
      expect(
        sceneVideoContext(world, {
          locationId: world.actors[id].place,
        }).people.find((person) => person.name === nameOf(id)).appearance,
      ).toBe(form.appearance);
      world.actors[id].xp += 1000;
      expect(portrait(id, null, decodeSave(encodeSave(world)))).toBe(
        `./${form.portrait}`,
      );
    },
  );

  it.each(Object.entries(rarityForms))(
    "keeps %s in the earned outfit through every combat pose",
    (id, form) => {
      for (const pose of ["attack", "hit", "guard"]) {
        expect(combatPortrait(id, pose, portrait(id), "right")).toBe(
          `./assets/combat/${id}-${pose}.webp`,
        );
        const source = combatPortrait(id, pose, `./${form.portrait}`, "left");
        expect(source).toBe(`./${form.combat}-${pose}.webp`);
        expect(combatPortrait(id, "guard", source, "right")).toBe(
          `./${form.combat}-guard.webp`,
        );
        expect(portraitFraming(source)).toBe("wide");
        expect(flipStagePortrait(source, "left")).toBe(true);
      }
    },
  );

  it.each(Object.entries(rarityForms))(
    "animates %s only at its first observed tier crossing",
    (id, form) => {
      expect(crossedPortraitTier(id, form.level - 1, form.level)).toBe(true);
      expect(crossedPortraitTier(id, form.level - 2, form.level + 1)).toBe(
        true,
      );
      expect(crossedPortraitTier(id, undefined, form.level)).toBe(false);
      expect(crossedPortraitTier(id, form.level, form.level)).toBe(false);
      expect(crossedPortraitTier(id, form.level, form.level + 1)).toBe(false);
      expect(crossedPortraitTier(id, form.level, form.level - 1)).toBe(false);
    },
  );
});
