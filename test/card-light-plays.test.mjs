import { describe, expect, it } from "vitest";
import {
  createWorld,
  knownActors,
  willingToGive,
} from "../v2/card-game/world.mjs";
import { DAY_TURNS } from "../v2/card-game/resident-home.mjs";
import { lifeWorld, reload, wait, waitUntil } from "./helpers/world-life.mjs";

const DUSK = DAY_TURNS + DAY_TURNS / 2;
const JAR = "greek-water-jar";
const want = (s, kind, target) => ({
  kind,
  target,
  since: s.turn,
  refusals: 0,
});

function unmetPair(seed, setup) {
  const s = createWorld({ opening: true, seed });
  s.turn = s.revision = DUSK - 1;
  s.items[JAR].holder = "greek-elder";
  s.actors["greek-baker"].place = "greek-well";
  s.actors["greek-baker"].want = want(s, "item", JAR);
  setup?.(s);
  return reload(s);
}

describe("residents play at dawn and dusk where no player is", () => {
  it("walks one step toward a want and keeps going at the next light change", () => {
    let s = lifeWorld({ turn: 2 * DAY_TURNS - 1, place: "greek-harbor" });
    s.actors["greek-creon"].want = want(s, "place", "greek-courtyard");
    s = wait(reload(s));
    expect(s.actors["greek-creon"].place).toBe("greek-well");
    s = waitUntil(s, 2 * DAY_TURNS + DAY_TURNS / 2 - 1);
    expect(s.actors["greek-creon"].place).toBe("greek-well");
    s = wait(s);
    expect(s.actors["greek-creon"].place).toBe("greek-courtyard");
  });

  it("asks a resident the player has not met, and the usual rules decide", () => {
    for (const keeps of [false, true]) {
      let s = unmetPair(7, (w) => {
        if (keeps) w.actors["greek-elder"].want = want(w, "item", JAR);
      });
      expect(knownActors(s)).not.toContain("greek-elder");
      const gives = willingToGive(s, "greek-elder", JAR, "greek-baker");
      expect(gives).toBe(!keeps);
      s = wait(s);
      expect(s.items[JAR].holder).toBe(gives ? "greek-baker" : "greek-elder");
      if (!gives) expect(s.actors["greek-baker"].want.refusals).toBe(1);
    }
  });

  it("writes no log line for a play nobody sees", () => {
    const s = unmetPair(7);
    const after = wait(s);
    expect(after.items[JAR].holder).toBe("greek-baker");
    const fresh = after.log.filter((e) => e.seq > s.eventSeq);
    expect(fresh.some((e) => e.actorId === "greek-baker")).toBe(false);
    expect(fresh.some((e) => e.locationId === "greek-well")).toBe(false);
  });

  it("gives the same world from the same seed and plays", () => {
    const run = () => wait(unmetPair(11), DAY_TURNS + 2);
    expect(run()).toEqual(run());
  });
});
