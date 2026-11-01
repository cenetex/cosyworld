// Sea lanes past the Wine-Dark Harbor open while a named thing is aboard:
// the Travel Provisions for Piraeus, the Suppliant's Olive Branch for Athens
// Harbor. The branch is handed over when the plea is registered at the Agora.
import { describe, expect, it } from "vitest";
import { entityActive } from "../v2/card-game/pack-registry.mjs";
import { transportExits } from "../v2/card-game/pack-transport.mjs";
import {
  openDoorStart,
  openDoorSteps,
  playOpenDoor,
} from "./helpers/open-door.mjs";

const BRANCH = "greek-olive-branch";
// The docks one lane from `dock`, as Vale would see them.
const courses = (s, dock) => transportExits(s, "greek-ship", dock, "vale");

function pleaWorld() {
  let world = openDoorStart();
  for (const { kind, ...fields } of openDoorSteps()) {
    if (fields.choiceId === "greek-open-door-register-plea")
      expect(entityActive(world, BRANCH)).toBe(false);
    world = playOpenDoor(world, kind, fields);
    if (fields.choiceId === "greek-open-door-register-plea") return world;
  }
  throw new Error("The plea was never registered.");
}

describe("lanes that open with a thing aboard", () => {
  it("the plea hands over the olive branch, which opens Athens Harbor only aboard", () => {
    const s = pleaWorld();
    expect(s.items[BRANCH].holder).toBe("vale");
    expect(entityActive(s, BRANCH)).toBe(true);
    s.items["greek-provisions"].holder = "greek-harbor";
    // Ashore in Vale's hands, the branch opens nothing at sea.
    expect(courses(s, "greek-harbor")).not.toContain("greek-piraeus");
    expect(courses(s, "greek-piraeus")).not.toContain("greek-athens-harbor");
    // The provisions aboard open Piraeus, and only Piraeus.
    s.items["greek-provisions"].holder = "greek-ship";
    expect(courses(s, "greek-harbor")).toContain("greek-piraeus");
    expect(courses(s, "greek-piraeus")).not.toContain("greek-athens-harbor");
    // The branch aboard opens Athens Harbor; taken ashore, it closes again.
    s.items[BRANCH].holder = "greek-ship";
    expect(courses(s, "greek-piraeus")).toContain("greek-athens-harbor");
    expect(courses(s, "greek-athens-harbor")).toContain("greek-piraeus");
    s.items[BRANCH].holder = "greek-athens";
    expect(courses(s, "greek-piraeus")).not.toContain("greek-athens-harbor");
  });
});
