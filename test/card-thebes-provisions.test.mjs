import { describe, expect, it } from "vitest";
import {
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { DAYLIGHT_TURNS } from "../v2/card-game/pack-rules.mjs";
import { greekTravelTargets } from "./helpers/greek-travel.mjs";
import { funeralJourney } from "./helpers/greek-funeral.mjs";

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
  it("go straight home to Eleusis and Colonus after the rite", () => {
    // The burial is played from createWorld; the rite opens the Open Door,
    // so Eleusis and Colonus are live the moment it is done.
    let s = funeralJourney().buried;
    expect(s.packs["greek-drama"].flags["greek-burial-performed"]).toBe(true);
    expect(s.usedUp).not.toContain("greek-funeral-cloth");
    expect(s.items["greek-funeral-cloth"].holder).toBe("greek-eleusis");
    expect(s.items["greek-oil-flask"].holder).toBe("greek-colonus");
    // The shovel is a tool: it stays where it was used.
    expect(s.items["greek-shovel"].holder).toBe("greek-polynices-hollow");
    // Nothing moves them at dawn.
    s = until(s, "dawn");
    expect(s.items["greek-funeral-cloth"].holder).toBe("greek-eleusis");
    expect(s.items["greek-oil-flask"].holder).toBe("greek-colonus");
    expect(s.items["greek-shovel"].holder).toBe("greek-polynices-hollow");
  });
  it("stay where they are laid through a dawn, then go home the next", () => {
    // Eleusis and Colonus are live once the way is open, so a thing laid away
    // from its home is noted at one dawn and swept home at the next.
    let s = funeralJourney().buried;
    const grave = "greek-polynices-hollow";
    s.items["greek-funeral-cloth"].holder = grave;
    s.items["greek-oil-flask"].holder = grave;
    delete s.astray;
    s = until(s, "dawn");
    expect(s.items["greek-funeral-cloth"].holder).toBe(grave);
    expect(s.items["greek-oil-flask"].holder).toBe(grave);
    expect(s.astray).toMatchObject({
      "greek-funeral-cloth": grave,
      "greek-oil-flask": grave,
    });
    s = until(s, "dawn");
    expect(s.items["greek-funeral-cloth"].holder).toBe("greek-eleusis");
    expect(s.items["greek-oil-flask"].holder).toBe("greek-colonus");
  });
});
