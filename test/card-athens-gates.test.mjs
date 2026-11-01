import { describe, expect, it } from "vitest";
import { decodeSave, encodeSave, exits } from "../v2/card-game/world.mjs";
import {
  openDoorStart,
  openDoorWalk,
  playOpenDoor,
} from "./helpers/open-door.mjs";

// Athens has two gates, each a live condition in pack data. The Sacred Way
// leads from Eleusis into the city while the mothers' petition is at Eleusis
// or in the Agora. The Long Walls lead from the Agora to Piraeus while the
// herald's truce is in the Agora. Each blocks only the way out; the way
// back is always open.
const reload = (s) => decodeSave(encodeSave(s));
const SACRED = "greek-road-athens-eleusis",
  WALLS = "greek-road-athens-piraeus";
const opens = (s, from, road) => exits(s, from, "vale").includes(road);

describe("the Athenian gates", () => {
  it("opens the Sacred Way with the petition and the Long Walls with the truce", () => {
    // A ship traveler walks in from Piraeus: both ways back are open.
    let s = openDoorWalk(openDoorStart(), "harbor", "athens");
    expect(opens(s, "greek-piraeus", WALLS)).toBe(true);
    expect(opens(s, "greek-athens", SACRED)).toBe(true);
    expect(opens(s, "greek-eleusis", SACRED)).toBe(false);
    expect(opens(s, "greek-athens", WALLS)).toBe(false);
    // Meeting the mothers brings their petition: the Sacred Way opens.
    s = openDoorWalk(s, "eleusis");
    expect(opens(s, "greek-eleusis", SACRED)).toBe(true);
    s = playOpenDoor(s, "take", { item: "greek-burial-petition" });
    s = openDoorWalk(s, "athens");
    s = playOpenDoor(s, "give", {
      item: "greek-burial-petition",
      target: "greek-theseus",
    });
    // The petition and the herald's truce rest in the Agora.
    expect(s.items["greek-burial-petition"].holder).toBe("greek-athens");
    expect(s.items["greek-olive-branch"].holder).toBe("greek-athens");
    expect(opens(reload(s), "greek-eleusis", SACRED)).toBe(true);
    expect(opens(reload(s), "greek-athens", WALLS)).toBe(true);
    // The truce leaves the Agora: the walls close behind it.
    s = playOpenDoor(s, "take", { item: "greek-olive-branch" });
    s = openDoorWalk(s, "piraeus");
    expect(s.items["greek-olive-branch"].holder).toBe("vale");
    expect(opens(reload(s), "greek-athens", WALLS)).toBe(false);
    expect(opens(s, "greek-piraeus", WALLS)).toBe(true);
    // The petition taken away from the Agora closes the Sacred Way.
    s.items["greek-burial-petition"].holder = "greek-colonus";
    expect(opens(reload(s), "greek-eleusis", SACRED)).toBe(false);
  });
});
