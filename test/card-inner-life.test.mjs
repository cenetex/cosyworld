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
  it("keeps the authored identity, evolving persona and dreams distinct", () => {
    const chain = innerLifeChain(reflective(), "vale");
    expect(chain.im).toBe("I'm Vale. The Lamplighter.");
    // One current intention: the newest grounded thought.
    expect(chain.becoming).toEqual([
      "Hm. The Lamp's already mine, and the mirror's still empty.",
    ]);
    expect(chain.dreams).toEqual(["A vast void. I wake. An echo."]);
    expect(chain.name).toBe("Vale");
    expect(chain.description).toContain("A traveller");
    expect(chain.persona).toBe("I turn the unlit lamp in my hand and study the empty mirror.");
    expect(chain.memories).toEqual([]);
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
    expect(chain).toMatchObject({ becoming: [], dreams: [], persona: "" });
    expect(chain.im).toBe("I'm Vale. The Lamplighter.");
  });

  it("hides narration, broken quotes and invented items (#1850)", () => {
    const world = createWorld();
    world.memories.vale.innerLife = {
      persona: "I am becoming a lamplighter who listens.",
      thoughts: [
        { turn: 1, text: "Myrto, the shipmaster, is a practical sort." },
        { turn: 2, text: "Signal Jetty first,\u201d she called. I go." },
        { turn: 3, text: "The map's right here. My compass is ready." },
      ],
      dreams: [
        { turn: 1, text: "The quays need a compass, and I hold none." },
        { turn: 2, text: "I dream of the Bell under water." },
      ],
    };
    const chain = innerLifeChain(world, "vale");
    expect(chain.becoming).toEqual([
      "I am becoming a lamplighter who listens.",
    ]);
    expect(chain.dreams).toEqual(["I dream of the Bell under water."]);
  });

  it("keeps only the selected avatar's retained events missing from the visit log", () => {
    const world = reflective();
    const present = world.log.at(-1).seq;
    const remembered = { seq: present + 1, kind: "event", text: "A remembered gift." };
    world.memories.vale.events = [
      { seq: present, kind: "event", text: "Already in the visits." },
      remembered,
      { seq: present + 2, kind: "expression", text: "Generated aside." },
    ];
    world.memories.vale.landmarks = [remembered];
    world.memories.mara.events = [{ seq: present + 3, kind: "event", text: "Mara's private memory." }];
    expect(innerLifeChain(world, "vale").memories).toEqual(["A remembered gift."]);
    expect(innerLifeChain(world, "mara").memories).toEqual(["Mara's private memory."]);
    expect(innerLifeChain(world, "vale", (text) => text.replace("gift", "thing")).memories)
      .toEqual(["A remembered thing."]);
  });

  it("names a cast member without a title plainly", () => {
    expect(innerLifeChain(createWorld(), "keeper").im).toMatch(/^I'm [^.]+\.$/);
  });
});
