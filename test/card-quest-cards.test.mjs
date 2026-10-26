import { describe, expect, it } from "vitest";
import {
  createWorld,
  play,
  legalActions,
  encodeSave,
  decodeSave,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import {
  QUEST_CARD,
  playerQuest,
  fulfilledPlayerQuest,
  questHand,
} from "../v2/card-game/quest-cards.mjs";
const fresh = () =>
  enableMotives(createWorld({ opening: true }), {
    questPrograms: true,
    personalQuests: true,
  });
const act = (world, kind) => {
  const result = play(
    world,
    legalActions(world).find((action) => action.kind === kind),
  );
  expect(result.ok).toBe(true);
  return result.state;
};
describe("Vale's quest cards", () => {
  it("puts an evocative wish after Vale and all carried items", () => {
    const world = fresh();
    expect(playerQuest(world)).toMatchObject({
      title: "First light",
      purpose: "A little warmth might wake this empty room.",
      art: "lamp",
    });
    expect(questHand(world, playerQuest(world))).toEqual([
      "attic",
      "vale",
      "lamp",
      QUEST_CARD,
    ]);
    world.items.oil.holder = "vale";
    world.items.cloth.holder = "lamp";
    const hand = questHand(world, playerQuest(world));
    expect(hand.indexOf(QUEST_CARD)).toBeGreaterThan(hand.indexOf("oil"));
    expect(hand.indexOf(QUEST_CARD)).toBeGreaterThan(hand.indexOf("cloth"));
  });
  it("keeps the same card through a save and ordinary turns", () => {
    const world = fresh();
    expect(playerQuest(decodeSave(encodeSave(world)))).toEqual(
      playerQuest(world),
    );
    expect(playerQuest(act(world, "wait"))).toEqual(playerQuest(world));
  });
  it("uses the completion receipt and rests after the first light", () => {
    const before = fresh(),
      after = act(before, "light");
    expect(fulfilledPlayerQuest(before, after)).toEqual(playerQuest(before));
    expect(playerQuest(after)).toBeNull();
    expect(questHand(after, null)).not.toContain(QUEST_CARD);
    expect(fulfilledPlayerQuest(before, act(before, "wait"))).toBeNull();
  });
  it("keeps a later player's purpose separate from NPC progress", () => {
    const world = fresh();
    world.actors.vale.progress.program = 1;
    const quest = playerQuest(world);
    expect(quest.title).toBe("Along the shore");
    expect(quest.purpose).not.toMatch(/station|carry|lamp|steps/i);
    world.actors.moth.progress.program++;
    expect(playerQuest(world)).toEqual(quest);
    expect(quest.key).not.toBe(playerQuest(fresh()).key);
  });
  it("gives generated quests a stable identity and authored card copy", () => {
    const world = fresh();
    world.actors.vale.progress.program = 20;
    world.actors.vale.progress.current = {
      id: "generated-vale-21",
      name: "Exact steps",
      purpose: "Take the bell to the pond",
      steps: [],
      generated: { turn: 80, situation: "answer" },
    };
    const quest = playerQuest(world);
    expect(quest.title).toBe("An answer in the quiet");
    expect(quest.purpose).not.toMatch(/bell|pond|take/i);
    world.actors.vale.progress.step++;
    expect(playerQuest(world)).toEqual(quest);
    world.life.actors.vale.phase = "content";
    expect(playerQuest(world)).toBeNull();
    world.life.actors.vale.phase = "active";
    expect(playerQuest(world)).toEqual(quest);
  });
});
