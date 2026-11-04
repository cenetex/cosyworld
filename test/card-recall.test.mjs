import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
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
    reunion: { place: "pond", turn: 2, visits: 2 },
    acts: [{ verb: "ask", by: "moth", item: "lamp", refused: true, turn: 1 }],
  });
  // M3: the gift Pip still keeps is told by the keepsake, not again here;
  // Vale, who has no keepsake of it, remembers giving it.
  expect(
    memory("M3 Pip after the gift", "moth").acts.map((a) => a.verb),
  ).toEqual(["ask"]);
  expect(
    memory("M3 Pip after the gift", "vale").acts.map((a) => a.verb),
  ).toEqual(["ask", "give"]);
  // M2: met again and again, and the topic of their last talk.
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

it("remembers the same on the server as in the browser", () => {
  // Shared play asks the narrator bundle; it must build the same scene,
  // memory included.
  const sandbox = {};
  runInNewContext(
    readFileSync(
      new URL(
        "../v2/orchestrator-rust/src/card_shared/narrator.js",
        import.meta.url,
      ),
      "utf8",
    ),
    sandbox,
  );
  for (const { name, state, context } of scenes) {
    const told = JSON.parse(
      sandbox.cardNarrator(
        JSON.stringify({
          world: state,
          actor: "vale",
          claimed: ["vale"],
          present: ["vale"],
        }),
      ),
    );
    expect(told.ok, name).toBe(true);
    expect(told.context, name).toEqual(context);
  }
});
