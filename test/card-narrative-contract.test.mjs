import { describe, expect, it } from "vitest";
import { addLog } from "../v2/card-game/world.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { profiles } from "../v2/card-game/memory.mjs";
import {
  hearFirstEcho,
  narrativeContractCases,
} from "./fixtures/card-narrative-contexts.mjs";

describe("browser dialogue history contract", () => {
  it("profiles describe a voice in prose, with no authored example lines", () => {
    // Characters speak from the world state (#1537), not from samples.
    for (const [id, profile] of Object.entries(profiles))
      expect(profile.lines, id).toBeUndefined();
  });

  it.each(narrativeContractCases())(
    "keeps avatar history valid after $name",
    ({ context }) => {
      const sent = JSON.parse(JSON.stringify(context));
      expect(sent.conversation.length).toBeLessThanOrEqual(4);
      for (const line of sent.conversation) {
        expect(typeof line.actorId).toBe("string");
        expect(profiles[line.actorId]?.kind).toBe("avatar");
      }
    },
  );

  it("sends each Give and Trade with its recorded answer", () => {
    const cards = Object.fromEntries(
      narrativeContractCases()
        .filter(({ name }) => /give|trade/.test(name))
        .map(({ name, context }) => [name, context.outcome.card]),
    );
    expect(cards["accepted give"]).toMatchObject({
      kind: "give",
      accepted: true,
    });
    expect(cards["refused give"]).toMatchObject({
      kind: "give",
      accepted: false,
    });
    expect(cards["refused trade"]).toMatchObject({
      kind: "trade",
      receive: "oil",
      accepted: false,
    });
  });

  it("keeps the authored echo in the save, without treating it as an avatar", () => {
    for (const { name, world, context } of narrativeContractCases().filter(
      ({ name }) => name.includes("echo") || name === "reload covered bell",
    )) {
      expect(
        world.log.find((entry) => entry.speaker === "echo"),
        name,
      ).toMatchObject({
        kind: "dialogue",
        text: "bong",
        actorId: null,
        turn: 8,
      });
      expect(
        context.conversation.some((line) => line.text === "bong"),
        name,
      ).toBe(false);
    }
  });

  it("selects the last four actual avatar lines before applying the history limit", () => {
    const world = hearFirstEcho();
    for (let i = 0; i < 5; i++) {
      addLog(world, "Vale", `Avatar line ${i}`, {
        kind: "dialogue",
        generated: true,
        actorId: "vale",
        locationId: "pond",
      });
      for (const actorId of [null, "echo", "pond"])
        addLog(world, "A sound", "A remembered sound.", {
          kind: "dialogue",
          generated: true,
          actorId,
          locationId: "pond",
        });
    }
    world.turn++;
    world.revision++;
    expect(narrativeContext(world).conversation).toEqual(
      [1, 2, 3, 4].map((i) => ({
        actorId: "vale",
        text: `Avatar line ${i}`,
        // Whoever is at the pond hears it; the cast follows its own wants.
        witnesses: expect.arrayContaining(["vale", "moth"]),
      })),
    );
  });
});
