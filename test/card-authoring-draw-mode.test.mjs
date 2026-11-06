import { expect, it } from "vitest";
import { createCharacterDraw } from "../v2/card-game/authoring-draw.mjs";
const idea = {
  name: "Dino",
  specialAbility: "Braveheart",
  description: "A bright dinosaur.",
  aliases: [],
  suggested: true,
};

it("labels idea characters, keeps accepted fields and uses grounded extraction by default", async () => {
  const requests = [];
  let values = [idea, null];
  const draw = createCharacterDraw({
    randomSeed: () => 1,
    generate: async (input) => {
      requests.push(input);
      return values.shift();
    },
  });
  expect(draw.state.mode).toBe("extract");
  draw.setMode("idea");
  draw.setText("A woodland island.");
  await draw.find();
  expect(requests.every((request) => request.mode === "idea")).toBe(true);
  draw.select(draw.state.cards[0].id);
  expect(draw.chosen()).toEqual([idea]);
  draw.clear();
  expect(draw.state.mode).toBe("extract");
  draw.setText("Dino waits in the woods.");
  values = [idea];
  await draw.find();
  expect(requests.at(-1)).not.toHaveProperty("mode");
  expect(draw.state.cards).toEqual([]);
  expect(draw.state.error).toMatch(/evidence/);
});

it("cancels a pending idea when the author changes mode", async () => {
  let resolve;
  const draw = createCharacterDraw({
    randomSeed: () => 1,
    generate: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  draw.setText("Dino waits in the woods.");
  draw.setMode("idea");
  const pending = draw.find();
  draw.setMode("extract");
  resolve(idea);
  await pending;
  expect(draw.state).toMatchObject({ mode: "extract", cards: [], busy: false });
  expect(() => draw.setMode("other")).toThrow(/World idea or Story text/);
});
