import { describe, expect, it } from "vitest";
import { characterSheet } from "../v2/card-game/character-sheet.mjs";
import { createWorld, decodeSave, encodeSave, legalActions, play } from "../v2/card-game/world.mjs";
import { createPipWorld } from "../v2/card-game/pip-landing.mjs";

describe("character sheet", () => {
  it("keeps initial collection distinct from the Fool's later quest", () => {
    let s = createWorld();
    s.actors.vale.arcana = { proved: [], did: [], need: ["arcanum-0"],
      spread: [{ card: "arcanum-0", face: "down", base: { visited: s.actors.vale.visited.length } }] };
    expect(characterSheet(s).slots[0]).toEqual({ state: "locked", art: "./assets/arcana/tarot-back-locked.png" });
    expect(characterSheet(s).slots.slice(1)).toEqual(Array(21).fill({ state: "unknown" }));
    const turn = legalActions(s).find((a) => a.label === "Turn over");
    s = play(s, turn, s.revision).state;
    expect(characterSheet(s).cards).toEqual([]);
    expect(characterSheet(s).slots[0]).toEqual({ state: "unlocked", art: "./assets/arcana/tarot-back.png" });
    const revealed = characterSheet(s, { known: (id) => id === "tarot:vale:arcanum-0" });
    expect(revealed.slots[0]).toMatchObject({ state: "reward", name: "The Fool" });
    expect(revealed.cards).toEqual([]);
    expect(characterSheet(s).quests[0].words).not.toContain("The Fool");
    const action = legalActions(s).find((a) => a.label === "Collect");
    s = play(s, action, s.revision).state;
    const before = encodeSave(s), sheet = characterSheet(s);
    expect(sheet.cards.map((card) => card.name)).toEqual(["The Fool"]);
    expect(sheet.slots).toEqual([{ ...sheet.cards[0], state: "collected" }, ...Array(21).fill({ state: "unknown" })]);
    expect(sheet.level).toBe(1);
    expect(s.actors.vale.arcana.proved).toEqual([]);
    expect(characterSheet(decodeSave(before)).slots).toEqual(sheet.slots);
    expect(encodeSave(s)).toBe(before);
  });

  it("reads only the current player's deck in numeric order", () => {
    const s = createWorld();
    s.actors.vale.upgrades = ["arcanum-10", "scarf", "arcanum-2", "arcanum-0"];
    s.actors.mara.upgrades = ["arcanum-1"];
    const sheet = characterSheet(s);
    expect(sheet.cards.map((card) => card.id)).toEqual(["arcanum-0", "arcanum-2", "arcanum-10"]);
    expect(sheet.cards.every((card) => card.art && card.name)).toBe(true);
    expect(sheet.slots).toHaveLength(22);
    expect(sheet.slots.flatMap((card, i) => card.id ? [i] : [])).toEqual([0, 2, 10]);
    expect(sheet.slots[1]).toEqual({ state: "unknown" });
    expect(sheet.slots[21]).toEqual({ state: "unknown" });
    s.playerActorId = "mara";
    expect(characterSheet(s).cards.map((card) => card.id)).toEqual(["arcanum-1"]);
    expect(characterSheet(s).slots.flatMap((card, i) => card.id ? [i] : [])).toEqual([1]);
    expect(characterSheet(s).name).toBe("Mara");
  });

  it("projects the active spread ahead of collection ownership", () => {
    const s = createWorld();
    s.actors.vale.upgrades = ["arcanum-0", "arcanum-1"];
    s.actors.vale.arcana = { proved: [], did: [], level: 2, spread: [
      { card: "arcanum-0", face: "up" },
      { card: "arcanum-1", face: "locked" },
      { card: "arcanum-2", face: "locked" },
    ] };
    const sheet = characterSheet(s, { known: () => true });
    expect(sheet.cards).toHaveLength(2);
    expect(sheet.slots.slice(0, 4)).toEqual([
      { ...sheet.cards[0], state: "active" },
      { state: "locked", art: "./assets/arcana/tarot-back-locked.png" },
      { state: "locked", art: "./assets/arcana/tarot-back-locked.png" },
      { state: "unknown" },
    ]);
    s.actors.vale.arcana.spread = [];
    expect(characterSheet(s).slots[1]).toMatchObject({ state: "collected", id: "arcanum-1" });
    expect(characterSheet(s).slots[2]).toEqual({ state: "unknown" });
  });

  it("hides undiscovered names while retaining owned art", () => {
    const s = createWorld();
    s.actors.vale.upgrades = ["arcanum-0"];
    s.items.lamp.holder = "vale";
    const sheet = characterSheet(s);
    expect(sheet.place).toBe("Somewhere unfamiliar");
    expect(sheet.home).toBe("Undiscovered");
    expect(sheet.items).toContain("An unrevealed item");
    expect(sheet.cards[0].name).toBe("The Fool");
    expect(sheet.condition).toBe("Awake");
    s.actors.vale.sleeping = { since: s.turn };
    expect(characterSheet(s).condition).toBe("Resting");
  });

  it("includes a learned request that stays on its resident", () => {
    let s = createPipWorld(23);
    const talk = legalActions(s).find((action) => action.kind === "talk" && action.target === "moth");
    s = play(s, talk, s.revision).state;
    expect(characterSheet(s, { known: () => true }).quests)
      .toContainEqual(expect.objectContaining({ heading: "Pip", words: expect.stringMatching(/Lamp/u) }));
    expect(characterSheet(s).quests.some((quest) => quest.heading === "Pip")).toBe(false);
  });
});
