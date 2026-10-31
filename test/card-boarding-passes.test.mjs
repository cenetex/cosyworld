import { describe, expect, it } from "vitest";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { entityActive } from "../v2/card-game/pack-registry.mjs";
import { openingFixture } from "./helpers/greek-opening.mjs";
import {
  givePass,
  openDoorStart,
  openDoorSteps,
  openDoorWalk,
  playOpenDoor,
} from "./helpers/open-door.mjs";

// Dione's invitation (the Open Door) yields the Piraeus boarding pass and the
// plea at the Agora the Athens Harbor pass. Given to Myrto, a pass sets its
// lane's flag for the whole world and goes back into her keeping.
const flags = (s) => s.packs["greek-drama"].flags;
const reload = (s) => decodeSave(encodeSave(s));

describe("boarding passes", () => {
  it("stay out of play before their story gates", () => {
    const s = openingFixture("refusal").closed;
    for (const id of ["greek-pass-piraeus", "greek-pass-athens-harbor"]) {
      expect(s.items[id].holder).toBe("greek-shipmaster");
      expect(entityActive(s, id)).toBe(false);
    }
  });

  it("go from the story gate to Vale, then into Myrto's keeping", () => {
    let s = openDoorStart("refusal", { pass: false });
    expect(s.items["greek-pass-piraeus"].holder).toBe("vale");
    expect(entityActive(s, "greek-pass-piraeus")).toBe(true);
    expect(flags(s)["greek-lane-piraeus-open"]).toBeUndefined();
    s = reload(givePass(openDoorWalk(s, "harbor"), "piraeus"));
    expect(s.items["greek-pass-piraeus"].holder).toBe("greek-shipmaster");
    expect(entityActive(s, "greek-pass-piraeus")).toBe(false);
    expect(flags(s)["greek-lane-piraeus-open"]).toBe(true);

    s = openDoorStart();
    for (const { kind, ...fields } of openDoorSteps()) {
      if (fields.item === "greek-pass-athens-harbor") break;
      s = playOpenDoor(s, kind, fields);
    }
    expect(s.items["greek-pass-athens-harbor"].holder).toBe("vale");
    expect(s.actors.vale.place).toBe("greek-harbor");
    s = reload(givePass(s, "athens-harbor"));
    expect(s.items["greek-pass-athens-harbor"].holder).toBe("greek-shipmaster");
    expect(flags(s)["greek-lane-athens-harbor-open"]).toBe(true);
  });
});
