import { describe, expect, it } from "vitest";
import { createWorld, decodeSave, encodeSave, legalActions, play } from "../v2/card-game/world.mjs";
import { learningFacts } from "../v2/card-game/learning.mjs";
import { inCharacter, innerLifeChain, subjectMemories } from "../v2/card-game/inner-life.mjs";

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
    expect(chain.memories.some((m) => m.kind === "location")).toBe(true);
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

  it("summarizes witnessed items, places and people without repeating the transcript", () => {
    const world = reflective();
    const entry = { seq: 10, turn: 3, kind: "action", verb: "give", actorId: "moth",
      targetId: "vale", itemId: "cloth", accepted: true, locationId: "station",
      cast: ["vale", "moth"], items: [{ id: "cloth", holder: "vale" }],
      speaker: "World", text: "A raw journal sentence that must not appear." };
    world.log = [entry, { ...entry, seq: 11, turn: 4, generated: true,
      text: "A private generated aside." }, { ...entry, seq: 12, turn: 5,
      actorId: "mara", targetId: "keeper", cast: ["mara", "keeper"], itemId: "oil",
      items: [{ id: "oil", holder: "keeper" }] }];
    world.memories.vale.events = [{ seq: 10, turn: 3, kind: "event", text: `World: ${entry.text}` }];
    world.memories.vale.landmarks = [...world.memories.vale.events];
    const found = subjectMemories(world, "vale");
    const by = (id) => found.find((m) => m.id === id);
    const gift = "Received Black cloth from Pip at Empty station.";
    expect(by("cloth").summary).toContain(gift);
    expect(by("moth").summary).toContain(gift);
    expect(by("station").kind).toBe("location");
    expect(found.filter((m) => m.id === "cloth")).toHaveLength(1);
    expect(JSON.stringify(found)).not.toMatch(/raw journal|generated aside/u);
    expect(by("oil")).toBeUndefined();
    expect(subjectMemories(world, "vale", (id) => id !== "cloth").some((m) =>
      m.id === "cloth" || m.summary.includes("Black cloth"))).toBe(false);
    world.memories.vale.events = [{ seq: 10, turn: 3, kind: "event", text: "World: A new incarnation." }];
    world.memories.vale.landmarks = [];
    expect(subjectMemories(world, "vale").some((m) => m.summary.includes("Received Black cloth"))).toBe(false);
  });

  it("retains saved personal sightings and experiences after the log expires", () => {
    const world = createWorld();
    world.actors.vale.visited = ["station", "pond"];
    world.memories.vale.seen = { moth: { place: "pond", turn: 4, seq: 5 } };
    world.life.actors.vale.experiences = [{ kind: "gift", other: "moth", item: "cloth", place: "pond", turn: 4 }];
    world.log = [];
    world.actors.moth.place = "attic";
    world.items.cloth.holder = "keeper";
    const memories = subjectMemories(world, "vale");
    expect(memories.find((m) => m.id === "moth").summary).toContain("Last seen at Black pond.");
    expect(memories.find((m) => m.id === "cloth").summary).toContain("Received Black cloth from Pip at Black pond.");
    expect(memories.find((m) => m.id === "pond").summary).toContain("I have been here.");
    expect(JSON.stringify(memories)).not.toContain("Last seen at Mirror attic");
    expect(subjectMemories(world, "mara").some((m) => m.summary.includes("Received Black cloth"))).toBe(false);
  });

  it("projects the same summaries after saving a legal play, without changing state", () => {
    const world = createWorld();
    const action = legalActions(world).find((a) => a.kind === "wait");
    const result = play(world, action).state;
    const before = encodeSave(result);
    expect(subjectMemories(decodeSave(before), "vale")).toEqual(subjectMemories(result, "vale"));
    expect(encodeSave(result)).toBe(before);
  });

  it("names a cast member without a title plainly", () => {
    expect(innerLifeChain(createWorld(), "keeper").im).toMatch(/^I'm [^.]+\.$/);
  });
});
