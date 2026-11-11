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
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { greekErrands } from "./helpers/greek-opening.mjs";

// The Gate Guard guards the road from the Theban City Gate out to the
// battlefield, both ways. These fixtures establish closed and generally
// open roads with explicit custody of both papers.
const reload = (s) => decodeSave(encodeSave(s));
const out = (s) => exits(s, "greek-gate", "vale").includes("greek-battlefield");
const painted = (s) => !backdrop("greek-gate", s).includes("closed");
// What the voices at the gate are told about it: every fact but the ones
// that list the room, which name the battlefield either way.
const told = (s) =>
  narrativeContext(s)
    .entities.filter((e) =>
      ["greek-gate", "greek-guard", "greek-antigone", "vale"].includes(e.id),
    )
    .flatMap((e) => e.facts)
    .filter((f) => !/^(Paths visible|At the dialogue scene)/.test(f))
    .join(" ");
const pack = packDefinition("greek-drama");
const OPENED = ["greek-gate>greek-battlefield"];
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
describe("the Theban City Gate", () => {
  it("paints the gate open once the road has opened", () => {
    expect(pack.places["greek-gate"].exits).not.toContain("greek-battlefield");
    // The way in from the battlefield is the gate itself, which its guard
    // bars from both sides until it opens (rules 100).
    expect(pack.places["greek-battlefield"].exits).toEqual(["greek-gate"]);
    expect(
      pack.routes.find(
        (r) => r.from === "greek-battlefield" && r.to === "greek-gate",
      ),
    ).toBeUndefined();
    for (const b of pack.places["greek-gate"].backdrops)
      expect(b.requires.filter((r) => r.kind !== "daylight")).toEqual([
        { kind: "gate_open", from: route.from, to: route.to },
      ]);
  });

  it("keeps the road, painting and voices aligned with the papers", () => {
    let s = greekErrands().traded;
    // Restore the duty order while the Writ remains with Creon.
    s.items["greek-decree"].holder = "greek-guard";
    s = reload(s);
    expect(out(s)).toBe(false);
    expect(painted(s)).toBe(false);
    // The voices hear the shut way from the rules, and nothing calls it open.
    expect(told(s)).toContain("The way to The Exposed Battlefield is shut.");
    expect(told(s)).not.toMatch(/\bopen\b/i);
    // The other gate roads stay open.
    expect(exits(s, "greek-gate", "vale")).toEqual(
      expect.arrayContaining(["greek-courtyard"]),
    );
    s = greekErrands().opened;
    expect(s.items["greek-creon-writ"].holder).toBe("greek-guard");
    expect(out(s)).toBe(true);
    expect(painted(s)).toBe(true);
    expect(told(s)).toContain("The way to The Exposed Battlefield is open.");
    expect(told(s)).not.toMatch(/\b(shut|barred|bar sits)\b/i);
    s = act(s, "move", { target: "greek-battlefield" });
    expect(exits(s, "greek-battlefield", "vale")).toContain("greek-gate");
    // A live gate is never recorded as opened.
    expect(s.openedRoutes ?? []).not.toContain(OPENED[0]);
  });

  it("keeps a live route a toggle", () => {
    const s = structuredClone(greekErrands().opened);
    s.items["greek-creon-writ"].holder = "greek-elder";
    s.items["greek-decree"].holder = "greek-guard";
    // The next round's settle puts him back on guard.
    const shut = act(reload(s), "wait");
    expect(out(shut)).toBe(false);
    expect(painted(shut)).toBe(false);
    s.items["greek-creon-writ"].holder = "greek-guard";
    s.items["greek-decree"].holder = "greek-creon";
    const open = reload(s);
    expect(out(open)).toBe(true);
    expect(open.openedRoutes ?? []).not.toContain(OPENED[0]);
  });
});
