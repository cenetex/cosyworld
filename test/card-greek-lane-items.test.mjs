// Sea lanes past the Wine-Dark Harbor open while a named thing is aboard:
// the Travel Provisions for Piraeus. The herald's truce, which appears in the
// Agora when the plea is registered, opens no lane.
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
    const plea = kind === "give" && fields.target === "greek-theseus";
    if (plea) expect(entityActive(world, BRANCH)).toBe(false);
    world = playOpenDoor(world, kind, fields);
    if (plea) return playOpenDoor(world, "take", { item: BRANCH });
  }
  throw new Error("The plea was never registered.");
}

describe("lanes that open with a thing aboard", () => {
  it("the plea brings the herald's truce; the provisions open Piraeus", () => {
    const s = pleaWorld();
    expect(s.items[BRANCH].holder).toBe("vale");
    expect(entityActive(s, BRANCH)).toBe(true);
    s.items["greek-provisions"].holder = "greek-harbor";
    // Ashore in Vale's hands, the truce opens nothing at sea.
    expect(courses(s, "greek-harbor")).not.toContain("greek-piraeus");
    // The provisions aboard open Piraeus; the way home is always open.
    expect(courses(s, "greek-piraeus")).toContain("greek-harbor");
    s.items["greek-provisions"].holder = "greek-ship";
    expect(courses(s, "greek-harbor")).toContain("greek-piraeus");
  });
});
