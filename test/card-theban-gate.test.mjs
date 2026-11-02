import { describe, expect, it } from "vitest";
import {
  decodeSave,
  encodeSave,
  exits,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { backdrop } from "../v2/card-game/scene.mjs";
import { greekTravelTargets } from "./helpers/greek-travel.mjs";
import { openingFixture } from "./helpers/greek-opening.mjs";

// The road from the Theban City Gate out to the battlefield opens once the
// Gate Guard holds the Burial Decree at the gate, and stays open after. The
// gate only blocks the way out; the way back is an ordinary exit.
const reload = (s) => decodeSave(encodeSave(s));
const out = (s) => exits(s, "greek-gate", "vale").includes("greek-battlefield");
const painted = (s) => !backdrop("greek-gate", s).includes("closed");
const pack = packDefinition("greek-drama");
const route = pack.routes.find(
  (r) => r.from === "greek-gate" && r.to === "greek-battlefield",
);
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

describe("the Theban City Gate", () => {
  it("paints the gate open once the road has opened", () => {
    expect(pack.places["greek-gate"].exits).not.toContain("greek-battlefield");
    expect(pack.places["greek-battlefield"].exits).toEqual(["greek-gate"]);
    for (const b of pack.places["greek-gate"].backdrops)
      expect(b.requires.filter((r) => r.kind !== "daylight")).toEqual([
        { kind: "gate_open", from: route.from, to: route.to },
      ]);
  });

  it("opens the battlefield road once the guard holds the decree there", () => {
    let s = openingFixture("burial").decree;
    expect(s.items["greek-decree"].holder).toBe("greek-palace");
    expect(out(s)).toBe(false);
    expect(painted(s)).toBe(false);
    expect(
      legalActions(s).some(
        (a) => a.kind === "move" && a.target === "greek-battlefield",
      ),
    ).toBe(false);
    // The other gate roads stay open.
    expect(exits(s, "greek-gate", "vale")).toEqual(
      expect.arrayContaining(["greek-courtyard"]),
    );
    s = act(walk(s, "palace"), "take", { item: "greek-decree" });
    s = walk(s, "gate");
    expect(out(s)).toBe(false);
    s = act(s, "give", { item: "greek-decree", target: "greek-guard" });
    expect(s.items["greek-decree"].holder).toBe("greek-guard");
    expect(out(s)).toBe(true);
    expect(painted(s)).toBe(true);
    s = act(s, "move", { target: "greek-battlefield" });
    // The way back is always open.
    expect(exits(s, "greek-battlefield", "vale")).toContain("greek-gate");
    expect(s.openedRoutes).toEqual(["greek-gate>greek-battlefield"]);
    // The guard leaves his post with the decree: the gate stays open.
    const away = structuredClone(s);
    away.actors["greek-guard"].place = "greek-well";
    expect(out(reload(away))).toBe(true);
    expect(painted(reload(away))).toBe(true);
    expect(exits(reload(away), "greek-battlefield", "vale")).toContain(
      "greek-gate",
    );
    // He gives the decree away: it stays open.
    s.items["greek-decree"].holder = "greek-elder";
    expect(out(reload(s))).toBe(true);
  });

  it("records a gate already open when an earlier save loads", () => {
    const s = structuredClone(openingFixture("burial").decree);
    s.items["greek-decree"].holder = "greek-guard";
    s.actors["greek-guard"].place = "greek-gate";
    const loaded = reload(s);
    expect(loaded.openedRoutes).toEqual(["greek-gate>greek-battlefield"]);
    loaded.items["greek-decree"].holder = "greek-palace";
    expect(out(reload(loaded))).toBe(true);
  });

  it("keeps a live route a toggle", () => {
    route.live = true;
    try {
      const s = structuredClone(openingFixture("burial").decree);
      s.items["greek-decree"].holder = "greek-guard";
      s.actors["greek-guard"].place = "greek-gate";
      const open = reload(s);
      expect(open.openedRoutes).toBeUndefined();
      expect(out(open)).toBe(true);
      open.items["greek-decree"].holder = "greek-palace";
      expect(out(reload(open))).toBe(false);
    } finally {
      delete route.live;
    }
  });
});
