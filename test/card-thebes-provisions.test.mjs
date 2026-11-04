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

// Thebes on rules 95: the burial rites use up the funeral cloth and oil,
// which regrow at Eleusis and Colonus. The provisions, the bread and the
// gate are rules 102 now: card-thebes-bread.test.mjs.
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
  it("are used up by the defiant rite and regrow at Eleusis and Colonus", () => {
    let s = openingFixture("burial").closed;
    expect(s.usedUp).toEqual(
      expect.arrayContaining(["greek-funeral-cloth", "greek-oil-flask"]),
    );
    // The shovel is a tool: it stays where it was used.
    expect(s.items["greek-shovel"].holder).toBe("greek-battlefield");
    s = until(s, "dawn");
    expect(s.items["greek-funeral-cloth"].holder).toBe("greek-eleusis");
    expect(s.items["greek-oil-flask"].holder).toBe("greek-colonus");
  });

  it("are used up by the permitted rite too", () => {
    const s = openingFixture("concession").closed;
    expect(s.packs["greek-drama"].flags["greek-burial-performed"]).toBe(true);
    expect(s.usedUp).toEqual(
      expect.arrayContaining(["greek-funeral-cloth", "greek-oil-flask"]),
    );
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
