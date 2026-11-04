import { describe, expect, it } from "vitest";
import {
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { DAYLIGHT_TURNS } from "../v2/card-game/pack-rules.mjs";
import { greekTravelTargets } from "./helpers/greek-travel.mjs";
import { openingFixture } from "./helpers/greek-opening.mjs";

// Thebes on rules 95: the burial rites use the funeral cloth and oil. Under
// rules 102 nothing regrows at dawn: a used thing goes straight back to its
// home at Eleusis or Colonus, or, while its home is out of reach, to where
// it started. The provisions, the bread and the gate are rules 102 now:
// card-thebes-bread.test.mjs.
const reload = (s) => decodeSave(encodeSave(s));
function act(s, kind, fields = {}) {
  const action = legalActions(s).find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  expect(action, `${kind} ${JSON.stringify(fields)}`).toBeTruthy();
  const result = play(s, action, s.revision);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}
const walk = (s, ...ids) =>
  ids.reduce(
    (w, id) =>
      greekTravelTargets(w.actors.vale.place, `greek-${id}`).reduce(
        (x, target) => act(x, "move", { target }),
        w,
      ),
    s,
  );
// The next light change of a kind, reached by Waiting through it.
function until(s, light) {
  let t = (Math.floor(s.turn / DAYLIGHT_TURNS) + 1) * DAYLIGHT_TURNS;
  if ((t / DAYLIGHT_TURNS) % 2 !== (light === "dawn" ? 0 : 1))
    t += DAYLIGHT_TURNS;
  s.turn = t - 1;
  s.revision = Math.max(s.revision, s.turn);
  return act(reload(s), "wait", { sleep: undefined });
}

describe("the burial supplies", () => {
  it("go back where they started after the defiant rite", () => {
    const f = openingFixture("burial");
    let s = f.buried;
    expect(s.usedUp).not.toContain("greek-funeral-cloth");
    expect(s.usedUp).not.toContain("greek-oil-flask");
    // Eleusis and Colonus are not yet in this world: back where they began.
    expect(s.items["greek-funeral-cloth"].holder).toBe("greek-sanctuary");
    expect(s.items["greek-oil-flask"].holder).toBe("greek-courtyard");
    // The shovel is a tool: it stays where it was used.
    s = f.closed;
    expect(s.items["greek-shovel"].holder).toBe("greek-battlefield");
    // Nothing moves them at dawn.
    s = until(s, "dawn");
    expect(s.items["greek-funeral-cloth"].holder).toBe("greek-sanctuary");
    expect(s.items["greek-oil-flask"].holder).toBe("greek-courtyard");
  });

  it("go straight home to Eleusis and Colonus after the permitted rite", () => {
    const s = openingFixture("concession").buried;
    expect(s.packs["greek-drama"].flags["greek-burial-performed"]).toBe(true);
    expect(s.usedUp).not.toContain("greek-funeral-cloth");
    expect(s.items["greek-funeral-cloth"].holder).toBe("greek-eleusis");
    expect(s.items["greek-oil-flask"].holder).toBe("greek-colonus");
  });

  it("stay on the grave through a dawn until the rite", () => {
    // Waiting on the battlefield would perform the rite, so wait at the gate.
    // The writ's road through the Open Door makes Eleusis and Colonus live.
    let s = walk(openingFixture("concession").beforeRite, "gate");
    expect(s.packs["greek-drama"].flags["greek-open-door-open"]).toBe(true);
    // The fixture's long errand may already have seen them there at a dawn;
    // take them as laid since the last dawn.
    delete s.astray;
    // Laid on the grave through a dawn, they are only noted, not swept home.
    s = until(s, "dawn");
    expect(s.items["greek-funeral-cloth"].holder).toBe("greek-battlefield");
    expect(s.items["greek-oil-flask"].holder).toBe("greek-battlefield");
    expect(s.astray).toMatchObject({
      "greek-funeral-cloth": "greek-battlefield",
      "greek-oil-flask": "greek-battlefield",
    });
    // Left there a whole day, they go home at the next dawn.
    s = until(s, "dawn");
    expect(s.items["greek-funeral-cloth"].holder).toBe("greek-eleusis");
    expect(s.items["greek-oil-flask"].holder).toBe("greek-colonus");
  });
});
