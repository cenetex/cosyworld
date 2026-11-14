import { selectLamp } from "./fixtures/card-attic-opening.mjs";
import { expect, it } from "vitest";
import { beginPipJourney, createPipWorld, pipEntry, talkToPip } from "../v2/card-game/pip-landing.mjs";
import { openTableSession } from "../v2/card-game/table-session.mjs";
import { SAVE_BASE } from "../v2/card-game/avatar-world.mjs";
import { decodeSave, encodeSave, legalActions, play, questOffers } from "../v2/card-game/world.mjs";
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

it.each([0, 17, 4294967295])("holds Pip's quest as his Talk ends and carries it into Vale's opening for seed %s", (seed) => {
  const prelude = createPipWorld(seed);
  expect(prelude.items.lamp.holder).toBe("station");
  expect(decodeSave(encodeSave(prelude))).toEqual(prelude);
  const talk = cardPlay(prelude, ["moth"]);
  expect(talk.action).toMatchObject({ kind: "talk", target: "moth" });
  expect(play(prelude, talk.action).ok).toBe(true);
  const talked = talkToPip(prelude);
  expect(talked.actors.vale.heard).toEqual({ moth: "item:lamp" });
  const quest = { kind: "item", target: "lamp", step: { verb: "give", to: "moth" } };
  expect(talked.actors.vale.want).toMatchObject({ ...quest, from: "quest:from:moth" });
  expect(legalActions(talked).some((a) => a.kind === "take" && a.offer)).toBe(false);
  let world = beginPipJourney(seed);
  expect(world.opening).toBeDefined();
  expect(world.actors.vale.place).toBe("attic");
  expect(world.actors.vale.want).toMatchObject(quest);
  world = selectLamp(world);
  const move = legalActions(world).find((a) => a.kind === "move" && a.target === "pond");
  expect(move).toBeDefined();
  world = decodeSave(encodeSave(play(world, move).state));
  expect(questOffers(world).map((o) => o.id)).not.toContain("quest:from:moth");
  expect(world.actors.vale.under?.some((w) => w.from === "quest:from:moth") ?? false).toBe(false);
  const held = (w) => [w.actors.vale.want, ...(w.actors.vale.under ?? [])];
  expect(held(world).filter((w) => w?.target === "lamp")).toHaveLength(1);
  world = selectLamp(world, "lamp");
  const give = legalActions(world).find((a) => a.kind === "give" && a.target === "moth");
  expect(give).toBeDefined();
  const result = play(world, give);
  expect(result.ok).toBe(true);
  world = decodeSave(encodeSave(result.state));
  expect(world.items.lamp.holder).toBe("moth");
  expect(held(world).some((w) => w?.target === "lamp")).toBe(false);
  // One for meeting the quest, one for helping Pip meet his own want, and one
  // for each box the walk opened (rules 133). The mirror back to the attic
  // pays nothing: Vale has already stood there.
  expect(Object.keys(world.opened ?? {}).sort()).toEqual(["pond"]);
  expect(world.actors.vale.closed["quest:from:moth"][1]).toContain("lamp");
});

it("carries the quest held at Pip's card into the opening as the same quest", () => {
  const prelude = talkToPip(createPipWorld(17));
  const quest = { kind: "item", target: "lamp", step: { verb: "give", to: "moth" } };
  expect(prelude.actors.vale.want).toMatchObject(quest);
  const world = decodeSave(encodeSave(beginPipJourney(17, prelude)));
  expect(world.opening).toBeDefined();
  expect(world.actors.vale.place).toBe("attic");
  expect(world.actors.vale.want).toMatchObject(quest);
  expect(world.actors.vale.want.since).toBe(world.turn);
});
