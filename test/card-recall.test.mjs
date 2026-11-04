import { expect, it } from "vitest";
import { memoryScenes } from "./fixtures/card-voice-eval-cases.mjs";

const scenes = memoryScenes();
const memory = (name, id) =>
  scenes.find((s) => s.name === name).context.entities.find((e) => e.id === id)
    .recall;

it("remembers when the pair last met and what passed between them", () => {
  // M1: Pip asked Vale for the Lamp and Vale kept it; they parted and meet
  // again at the pond.
  expect(memory("M1 Pip again at the pond", "vale")).toEqual({
    reunion: { place: "pond", turn: 2, visits: 5 },
    acts: [{ verb: "ask", by: "moth", item: "lamp", refused: true, turn: 1 }],
  });
  // M3: the gift Pip still keeps is told by the keepsake, not again here.
  expect(
    memory("M3 Pip after the gift", "moth").acts.map((a) => a.verb),
  ).toEqual(["ask"]);
  // M2: many visits, and the topic of their last talk.
  const many = memory("M2 Pip after many visits", "vale");
  expect(many.reunion.visits).toBeGreaterThanOrEqual(3);
  expect(many.acts.map((a) => a.verb)).toEqual(["ask", "talk"]);
});

it("rests a memory on the moment after it was recalled", () => {
  // C1: the same pair a moment later. The reunion is over once Vale has
  // spoken, and the deeds M1 recalled wait a moment.
  expect(memory("C1 the next moment", "vale")).toBeUndefined();
  expect(memory("C1 the next moment", "moth")).toBeUndefined();
});
