import { expect, it } from "vitest";
import { beginPipJourney, createPipWorld, pipEntry } from "../v2/card-game/pip-landing.mjs";
import { openTableSession } from "../v2/card-game/table-session.mjs";
import { SAVE_BASE } from "../v2/card-game/avatar-world.mjs";
import { decodeSave, encodeSave, legalActions, play } from "../v2/card-game/world.mjs";
import { questRewardsOf } from "../v2/card-game/want.mjs";
import { cardPlay } from "../v2/card-game/cards.mjs";
import { titleIntroAllowed } from "../v2/card-game/title-intro.mjs";
import { worldLogoKey } from "../v2/card-game/title-logo.mjs";

it("keeps a pack hostname in its pack save", async () => {
  const hoppy = await openTableSession("https://hoppy.lonelyforest.com/pip");
  expect(hoppy.startingPip).toBe(false);
  expect(hoppy.saveKey).toBe(`${SAVE_BASE}.pack.hoppycat-archive`);
});

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

it.each([0, 17, 4294967295])("carries Pip's quest through Vale's opening for seed %s", (seed) => {
  const prelude = createPipWorld(seed);
  expect(prelude.items.lamp.holder).toBe("station");
  expect(decodeSave(encodeSave(prelude))).toEqual(prelude);
  const talk = cardPlay(prelude, ["moth"]);
  expect(talk.action).toMatchObject({ kind: "talk", target: "moth" });
  expect(play(prelude, talk.action).ok).toBe(true);
  let world = beginPipJourney(seed);
  const quest = { kind: "item", target: "lamp", story: true, step: { verb: "give", to: "moth" } };
  expect(world.opening).toBeDefined();
  expect(world.actors.vale.place).toBe("attic");
  expect(world.actors.vale.want).toMatchObject(quest);
  for (const [kind, target] of [["snuff"], ["move", "pond"], ["light"], ["give", "moth"]]) {
    const action = legalActions(world).find((a) => a.kind === kind && (!target || a.target === target));
    expect(action, kind).toBeDefined();
    const result = play(world, action);
    expect(result.ok, kind).toBe(true);
    world = decodeSave(encodeSave(result.state));
    if (kind !== "give") expect(world.actors.vale.want).toMatchObject(quest);
  }
  expect(world.items.lamp.holder).toBe("moth");
  expect(world.actors.vale.want).toBeNull();
  expect(questRewardsOf(world, "vale")[0]).toMatchObject({ want: quest, paid: false, xp: 1 });
});
