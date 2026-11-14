import { describe, expect, it } from "vitest";
import { decodeSave, encodeSave, exits } from "../v2/card-game/world.mjs";
import { openDoorStart, traveler } from "./helpers/open-door.mjs";

// Athens has no gates (open-door-rework). The Sacred Way joins Eleusis and
// the Agora, and the Long Walls the Agora and Piraeus, open from both ends
// from the start: no petition, burial or truce is read by either road.
const reload = (s) => decodeSave(encodeSave(s));
const SACRED = "greek-road-athens-eleusis",
  WALLS = "greek-road-athens-piraeus";
const opens = (s, from, road) => exits(s, from, "vale").includes(road);
const ends = [
  ["greek-eleusis", SACRED],
  ["greek-athens", SACRED],
  ["greek-athens", WALLS],
  ["greek-piraeus", WALLS],
];

describe("the Athenian roads", () => {
  it("are open from every end, whatever is carried where", () => {
    const t = traveler(openDoorStart());
    for (const [from, road] of ends) expect(opens(t.s, from, road)).toBe(true);
    // Carry the petition to the Agora, trade it, take the truce to Piraeus.
    t.move("eleusis").take("burial-petition").move("athens").waitFor("theseus");
    t.trade("burial-petition", "theseus", "olive-branch").move("piraeus");
    expect(t.s.items["greek-olive-branch"].holder).toBe("vale");
    for (const [from, road] of ends)
      expect(opens(reload(t.s), from, road)).toBe(true);
    // The petition far from both ends changes nothing.
    t.s.items["greek-burial-petition"].holder = "greek-colonus";
    for (const [from, road] of ends)
      expect(opens(reload(t.s), from, road)).toBe(true);
  });
});
