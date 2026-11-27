import { describe, expect, it } from "vitest";
import {
  choiceText,
  packDefinition,
  packFacts,
  packSceneFacts,
} from "../v2/card-game/pack-registry.mjs";
import { funeralJourney } from "./helpers/greek-funeral.mjs";

const greek = packDefinition("greek-drama");
const choice = (id) => greek.choices.find((c) => c.id === id);

describe("the Greek pack’s card and choice text", () => {
  it("names its cards and ties authored introductions to their Talks", () => {
    for (const kind of ["places", "avatars", "items"])
      for (const [id, entity] of Object.entries(greek[kind])) {
        if (kind === "avatars" && entity.text !== undefined) {
          const opening = greek.choices.find(
            (c) =>
              c.on === "talk" &&
              c.subject === id &&
              c.at === entity.place &&
              c.text?.startsWith(entity.text),
          );
          expect(opening, id).toBeDefined();
          expect(choiceText(opening, "vale")).toBe(opening.text);
        } else {
          expect(entity.text, `${kind} ${id}`).toBeUndefined();
        }
        expect(entity.persona, `${kind} ${id}`).toBeUndefined();
        expect(entity.name, `${kind} ${id}`).toBeTruthy();
        if (entity.seed !== undefined)
          expect(entity.seed.length, `${kind} ${id}`).toBeLessThanOrEqual(120);
      }
    for (const [id, avatar] of Object.entries(greek.avatars)) {
      expect(avatar.seed, id).toBeTruthy();
      expect(avatar.tastes.likes, id).toBeTruthy();
      expect(avatar.tastes.sore, id).toBeTruthy();
      expect(avatar.tastes.reason, id).toBeUndefined();
    }
  });

  it.each([
    [
      "greek-anoint-polynices",
      "vale",
      "Vale gives the Olive Oil to Antigone at Polynices' Hollow.",
    ],
    [
      "greek-hear-polynices",
      "vale",
      "Vale talks with Polynices' Shade at The Exposed Battlefield.",
    ],
    ["greek-meet-patroclus", "vale", "Vale meets Patroclus at Piraeus Quays."],
    ["greek-ajax-prepare-grave", "vale", "Vale waits at Ajax’s Grave."],
    [
      "greek-hear-decree",
      null,
      "An earlier traveler meets The Gate Guard at Theban City Gate.",
    ],
  ])("derives the text of %s from its action", (id, actor, expected) => {
    const c = choice(id);
    for (const field of ["text", "textTemplate", "summary", "label"])
      expect(c[field], `${id} ${field}`).toBeUndefined();
    expect(choiceText(c, actor)).toBe(expected);
  });

  it("records the burial as plain lines that name who did it", () => {
    const world = funeralJourney().buried;
    const rite = world.log.filter(
      (e) => e.verb === "give" && e.targetId === "greek-antigone",
    );
    expect(rite.map((e) => e.text)).toEqual([
      "Vale gives the Olive Oil to Antigone at Polynices' Hollow.",
      "Vale gives the Black cloth to Antigone at Polynices' Hollow.",
      "Vale gives the Burial Shovel to Antigone at Polynices' Hollow.",
    ]);
    expect(world.items["greek-shovel"].history.at(-1)).toBe(rite[2].text);
    expect(packFacts(world, "greek-antigone")).toEqual(rite.map((e) => e.text));
    expect(packFacts(world, "greek-burial-account")).toEqual(
      rite.map((e) => e.text),
    );
    expect(packSceneFacts(world, "greek-polynices-hollow")).toEqual(
      rite.slice(1).map((e) => e.text),
    );
  });
});
