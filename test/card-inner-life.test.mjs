import { describe, expect, it } from "vitest";
import { createWorld } from "../v2/card-game/world.mjs";
import { learningFacts } from "../v2/card-game/learning.mjs";
import { inCharacter, innerLifeChain } from "../v2/card-game/inner-life.mjs";

function reflective() {
  const world = createWorld();
  world.memories.vale.innerLife = {
    persona: "I turn the unlit lamp in my hand and study the empty mirror.",
    thoughts: [
      { turn: 3, text: "The keeper keeps the oil close." },
      {
        turn: 9,
        text: "Hm. The Lamp's already mine, and the mirror's still empty.",
      },
    ],
    dreams: [
      { turn: 4, text: "It sounds like you're outlining a scene for Vale." },
      { turn: 9, text: "A vast void. I wake. An echo." },
    ],
  };
  world.memories.vale.learning = [
    { goal: "attic", action: "invite", outcome: "reached", turn: 9 },
  ];
  return world;
}

describe("inner life panel", () => {
  it("shows I'm, I'm becoming and I dream, closed by the name", () => {
    const chain = innerLifeChain(reflective(), "vale");
    expect(chain.im).toBe("I'm Vale. The Lamplighter.");
    expect(chain.becoming).toEqual([
      "I turn the unlit lamp in my hand and study the empty mirror.",
      "Hm. The Lamp's already mine, and the mirror's still empty.",
      "The keeper keeps the oil close.",
    ]);
    expect(chain.dreams).toEqual(["A vast void. I wake. An echo."]);
    expect(chain.name).toBe("Vale");
    expect(Object.keys(chain)).toEqual(["name", "im", "becoming", "dreams"]);
  });

  it("keeps measured attempts out of the panel", () => {
    const world = reflective();
    const shown = JSON.stringify(innerLifeChain(world, "vale"));
    for (const fact of learningFacts(world, "vale", (id) => id))
      expect(shown).not.toContain(fact);
    expect(shown).not.toMatch(/measured|attempt/i);
  });

  it("hides assistant talk and needs no reflection to name the avatar", () => {
    expect(inCharacter("Let's see what the mirror holds.")).toBe(true);
    expect(inCharacter("It seems Vale is looking for a path.")).toBe(false);
    expect(inCharacter("  ")).toBe(false);
    const chain = innerLifeChain(createWorld(), "vale");
    expect(chain).toMatchObject({ becoming: [], dreams: [] });
    expect(chain.im).toBe("I'm Vale. The Lamplighter.");
  });

  it("names a cast member without a title plainly", () => {
    expect(innerLifeChain(createWorld(), "keeper").im).toMatch(/^I'm [^.]+\.$/);
  });
});
