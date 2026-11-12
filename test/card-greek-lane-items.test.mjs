// Sea lanes past the Wine-Dark Harbor open while a named thing is aboard:
// the Travel Provisions for Piraeus. The herald's truce, which Theseus trades
// for the mothers' petition, opens no lane.
import { describe, expect, it } from "vitest";
import { entityActive } from "../v2/card-game/pack-registry.mjs";
import { learnLane, transportExits } from "../v2/card-game/pack-transport.mjs";
import { openDoorStart, traveler } from "./helpers/open-door.mjs";
import { stowProvisions } from "./helpers/provisions.mjs";

const BRANCH = "greek-olive-branch";
// The docks one lane from `dock`, as Vale would see them.
const courses = (s, dock) => transportExits(s, "greek-ship", dock, "vale");

function pleaWorld() {
  const t = traveler(openDoorStart());
  t.move("eleusis").take("burial-petition").move("athens").waitFor("theseus");
  t.trade("burial-petition", "theseus", BRANCH);
  return t.s;
}

describe("lanes that open with a thing aboard", () => {
  it("Theseus trades the herald's truce; the provisions open Piraeus", () => {
    const s = pleaWorld();
    expect(s.items[BRANCH].holder).toBe("vale");
    expect(entityActive(s, BRANCH)).toBe(true);
    stowProvisions(s, "greek-harbor");
    // Ashore in Vale's hands, the truce opens nothing at sea.
    expect(courses(s, "greek-harbor")).not.toContain("greek-piraeus");
    // The provisions aboard open Piraeus; the way home is always open to a
    // traveler who has sailed it.
    learnLane(s, "vale", "greek-piraeus", "greek-harbor");
    expect(courses(s, "greek-piraeus")).toContain("greek-harbor");
    stowProvisions(s, "greek-ship");
    expect(courses(s, "greek-harbor")).toContain("greek-piraeus");
  });
});
