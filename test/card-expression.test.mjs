import { afterEach, describe, expect, it } from "vitest";
import {
  emojiParts,
  expressionOf,
  expressionLabel,
  validExpression,
} from "../v2/card-game/expression.mjs";
import { packDefinitions, hub } from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import { profiles } from "../v2/card-game/memory.mjs";
import {
  people,
  createWorld,
  encodeSave,
  decodeSave,
} from "../v2/card-game/world.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../v2/card-game/narrative.mjs";
import { isSceneText } from "../v2/card-game/scene.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";

afterEach(() => {
  delete profiles.moth.expression;
  delete people.moth.expression;
});

describe("authored character expression", () => {
  it("accepts the three authored types and keeps speech as the default", () => {
    expect(expressionOf({})).toBe("speech");
    for (const expression of ["speech", "movement", "emoji"]) {
      const pack = structuredClone(packDefinitions[0]);
      pack.avatars.badger.expression = expression;
      expect(packProblems(pack, hub)).toEqual([]);
    }
    const pack = structuredClone(packDefinitions[0]);
    pack.avatars.badger.expression = "anything";
    expect(packProblems(pack, hub).join(" ")).toContain("expression needs");
  });

  it("gives emoji replies the exact English names of their visible symbols", () => {
    const profile = { name: "Whiskerwind", expression: "emoji" };
    expect(emojiParts("🌧️ 🐾🏠☕")).toEqual(["🌧️", "🐾", "🏠", "☕"]);
    expect(expressionLabel(profile, "🌧️🐾🏠☕")).toBe(
      "Whiskerwind shows rain, paw prints, a house, a warm cup.",
    );
    for (const text of ["hello 🌳", "🌳", "🌳👀🏠☕🌙⭐", "🌳<script>"])
      expect(validExpression(profile, text)).toBe(false);
  });

  it("keeps a physical reply as narration through local generation and reload", () => {
    profiles.moth.expression = people.moth.expression = "movement";
    const world = createWorld();
    world.actors.moth.place = world.actors.vale.place = "station";
    const context = narrativeContext(world);
    context.speakers = ["vale", "moth"];
    const response = {
      revision: context.revision,
      model: "fixture",
      entries: context.entities.map(({ id }) => ({
        id,
        text:
          id === "moth"
            ? "Pip tilts his head toward the lamp."
            : "I am glad to be here.",
      })),
    };
    const next = applyGeneratedText(world, context, response);
    const line = next.log.findLast(
      (entry) => entry.generated && entry.actorId === "moth",
    );
    expect(line.kind).toBe("narration");
    expect(isSceneText(line)).toBe(true);
    expect(expressionLabel(profiles.moth, line.text)).toBe(line.text);
    const loaded = decodeSave(encodeSave(next));
    expect(loaded.log.find((entry) => entry.seq === line.seq)).toEqual(line);
    response.entries.find((entry) => entry.id === "moth").text =
      "I will tell you.";
    expect(() => applyGeneratedText(world, context, response)).toThrow(
      "incomplete",
    );
  });

  it("checks shared replies against the trusted profile and preserves their form", () => {
    profiles.moth.expression = "emoji";
    const world = dispatchShared({ op: "create" }).world;
    world.actors.moth.place = world.actors.vale.place = "station";
    const request = {
      op: "speech",
      actor: "vale",
      claimed: ["vale"],
      present: ["vale"],
      world,
      lines: [
        { actorId: "vale", text: "I see the tree." },
        { actorId: "moth", text: "🌳👀", expression: "speech" },
      ],
    };
    const result = dispatchShared(request);
    expect(result.lines[1]).toMatchObject({
      actorId: "moth",
      text: "🌳👀",
      kind: "dialogue",
    });
    request.lines[1].text = "I see it too.";
    expect(() => dispatchShared(request)).toThrow("clear text");
    profiles.moth.expression = "movement";
    request.lines[1].text = "Pip lowers his head.";
    expect(dispatchShared(request).lines[1].kind).toBe("narration");
  });
});
