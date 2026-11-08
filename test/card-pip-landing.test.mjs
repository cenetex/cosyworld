import { expect, it } from "vitest";
import { createPipWorld, pipEntry } from "../v2/card-game/pip-landing.mjs";
import { openTableSession } from "../v2/card-game/table-session.mjs";
import { SAVE_BASE } from "../v2/card-game/avatar-world.mjs";
import { decodeSave, encodeSave, play } from "../v2/card-game/world.mjs";
import { cardPlay } from "../v2/card-game/cards.mjs";
import { titleIntroAllowed } from "../v2/card-game/title-intro.mjs";
import { worldLogoKey } from "../v2/card-game/title-logo.mjs";

it("opens the physical card in its own slot without the title intro", async () => {
  for (const path of [
    "/pip",
    "/pip/",
    "/pip?utm_source=card",
    "/pip?intro=1",
  ]) {
    const href = `https://lonelyforest.com${path}`;
    expect(pipEntry(href)).toBe(true);
    expect(await openTableSession(href)).toMatchObject({
      startingPip: true,
      saveKey: `${SAVE_BASE}.entry.pip`,
      sharedSession: null,
    });
    expect(titleIntroAllowed({ href })).toBe(false);
    expect(worldLogoKey(href)).toBe("entry:pip");
  }
  for (const path of [
    "/",
    "/piper",
    "/pip?world=w",
    "/pip?table=night",
    "/pip?pack=greek-drama",
  ])
    expect(pipEntry(`https://lonelyforest.com${path}`)).toBe(false);
  expect((await openTableSession("https://lonelyforest.com/")).saveKey).toBe(
    SAVE_BASE,
  );
  expect(
    (await openTableSession("https://lonelyforest.com/pip?table=night"))
      .saveKey,
  ).toBe(`${SAVE_BASE}.night`);
});

it.each([0, 17, 4294967295])(
  "keeps Pip's gift through save restore for seed %s",
  (seed) => {
    const world = createPipWorld(seed);
    expect(world.actors.vale).toMatchObject({
      place: "pond",
      visited: ["pond"],
      heldItem: "lamp",
    });
    expect(world.log).toHaveLength(1);
    expect(world.log[0]).toMatchObject({
      locationId: "pond",
      cast: ["vale", "moth"],
      light: true,
    });
    expect(decodeSave(encodeSave(world))).toEqual(world);
    const choice = cardPlay(world, ["lamp", "moth"]);
    expect(choice.action).toMatchObject({
      kind: "give",
      item: "lamp",
      target: "moth",
    });
    const result = play(world, choice.action);
    expect(result.ok).toBe(true);
    const restored = decodeSave(encodeSave(result.state));
    expect(restored.items.lamp.holder).toBe("moth");
    expect(restored.actors.moth.xp).toBe(1);
    expect(restored.turn).toBe(1);
  },
);
