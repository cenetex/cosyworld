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

describe("the Greek pack carries no card prose", () => {
  it("names its places, residents and things without describing them", () => {
    for (const kind of ["places", "avatars", "items"])
      for (const [id, entity] of Object.entries(greek[kind])) {
        expect(entity.text, `${kind} ${id}`).toBeUndefined();
        expect(entity.name, `${kind} ${id}`).toBeTruthy();
      }
    for (const [id, avatar] of Object.entries(greek.avatars)) {
      expect(avatar.seed, id).toBeTruthy();
      expect(avatar.tastes.likes, id).toBeTruthy();
      expect(avatar.tastes.sore, id).toBeTruthy();
      expect(avatar.tastes.reason, id).toBeUndefined();
    }
    for (const c of greek.choices)
      for (const field of ["text", "textTemplate", "summary", "label"])
        expect(c[field], `${c.id} ${field}`).toBeUndefined();
  });

  it("tells each kind of choice plainly from what it is", () => {
    expect(choiceText(choice("greek-anoint-polynices"), "vale")).toBe(
      "Vale gives the Funeral Oil to Antigone at Polynices' Hollow.",
    );
    expect(choiceText(choice("greek-hear-polynices"), "vale")).toBe(
      "Vale talks with Polynices' Shade at The Exposed Battlefield.",
    );
    expect(choiceText(choice("greek-meet-patroclus"), "vale")).toBe(
      "Vale meets Patroclus at Piraeus Quays.",
    );
    expect(choiceText(choice("greek-ajax-prepare-grave"), "vale")).toBe(
      "Vale waits at Ajax’s Grave.",
    );
    expect(choiceText(choice("greek-hear-decree"), null)).toBe(
      "An earlier traveler meets The Gate Guard at Theban City Gate.",
    );
  });

  it("records the burial as plain lines that name who did it", () => {
    const world = funeralJourney().buried;
    const rite = world.log.filter(
      (e) => e.verb === "give" && e.targetId === "greek-antigone",
    );
    expect(rite.map((e) => e.text)).toEqual([
      "Vale gives the Funeral Oil to Antigone at Polynices' Hollow.",
      "Vale gives the Black cloth to Antigone at Polynices' Hollow.",
      "Vale gives the Burial Shovel to Antigone at Polynices' Hollow.",
    ]);
    expect(world.items["greek-shovel"].history.at(-1)).toBe(rite[2].text);
    expect(packFacts(world, "greek-antigone")).toEqual(rite.map((e) => e.text));
    expect(packSceneFacts(world, "greek-polynices-hollow")).toEqual(
      rite.slice(1).map((e) => e.text),
    );
  });
});
