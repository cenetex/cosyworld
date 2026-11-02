import { describe, expect, it } from "vitest";
import { decodeSave, encodeSave, exits } from "../v2/card-game/world.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { openingFixture } from "./helpers/greek-opening.mjs";

// The Cithaeron road leads from the battlefield to Eleusis once a Theban
// account of the burial is at the battlefield or on Dione's table in the
// courtyard, and stays open after: the
// Burial Account, Creon's Writ or the Guard's Tablet. The way back from
// Eleusis is always open.
const reload = (s) => decodeSave(encodeSave(s));
const ROAD = "greek-cithaeron";
const out = (s) => exits(reload(s), "greek-battlefield", "vale").includes(ROAD);

describe("the Cithaeron road", () => {
  it("opens with a Theban account at the battlefield or with Dione", () => {
    const fixture = openingFixture("burial");
    // Before the rite the account lies unseen at the battlefield. After it,
    // the road still waits for the Open Door, which Dione's report opens.
    expect(out(fixture.beforeRite)).toBe(false);
    expect(out(fixture.buried)).toBe(false);
    const s = fixture.closed;
    expect(s.items["greek-burial-account"].holder).toBe("greek-courtyard");
    expect(out(s)).toBe(true);
    // Taken from Dione's table, it leaves the road open.
    const opened = reload(s);
    opened.items["greek-burial-account"].holder = "greek-well";
    expect(out(opened)).toBe(true);
    // Creon's Writ and the Guard's Tablet open it the same way.
    const gates = packDefinition("greek-drama").routes.filter(
      (r) => r.to === ROAD,
    );
    expect(gates.map((r) => r.requires.at(-1).conditions[0].item)).toEqual([
      "greek-burial-account",
      "greek-creon-writ",
      "greek-guard-tablet",
    ]);
    // The way back is always open.
    expect(exits(reload(s), "greek-eleusis", "vale")).toContain(ROAD);
    expect(exits(reload(s), ROAD, "vale")).toEqual([
      "greek-battlefield",
      "greek-eleusis",
    ]);
  });
});
