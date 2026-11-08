import { describe, expect, it } from "vitest";
import { endStandoff } from "./helpers/standoff.mjs";
import { decodeSave, exits } from "../v2/card-game/world.mjs";
import { guardPost, settleGuards } from "../v2/card-game/resident-guard.mjs";
import { act, lifeWorld, reload } from "./helpers/world-life.mjs";
const guard = "greek-guard",
  gate = "greek-gate",
  beyond = guardPost(guard).to;
const start = () => lifeWorld({ turn: 0, place: gate });
describe("the guard's two ordinary papers", () => {
  it("uses each traveller's friendship when the guard has both papers", () => {
    let s = start();
    expect(s.items["greek-decree"].holder).toBe(guard);
    expect(s.items["greek-creon-writ"].holder).toBe("greek-creon");
    expect(exits(s, gate, "vale")).not.toContain(beyond);
    s.sharedVersion = 1;
    s.controlledActors = s.presentActors = ["vale", "rue"];
    s.actors.rue.place = gate;
    s.items["greek-creon-writ"].holder = guard;
    s.actors[guard].trust.vale = 1;
    settleGuards(s);
    expect(s.actors[guard].guarding).toBe(beyond);
    expect(exits(s, gate, "vale")).toContain(beyond);
    expect(exits(s, gate, "rue")).not.toContain(beyond);
    s = act(s, "move", { target: beyond });
    expect(
      s.log.find((e) => e.actorId === "vale" && e.verb === "move").text,
    ).toContain("lets Vale through");
    expect(reload(s)).toEqual(s);
  });
  it("ends friendly passage after a real threat", () => {
    let s = start();
    s.items["greek-creon-writ"].holder = guard;
    s.actors[guard].trust.vale = 2;
    s = endStandoff(act(s, "threaten", { target: guard }));
    expect(s.motives.grievances[guard].some((g) => g.other === "vale")).toBe(
      true,
    );
    expect(exits(s, gate, "vale")).not.toContain(beyond);
    expect(reload(s)).toEqual(s);
  });
  it("walks to the common table and drinks through its ordinary quest", () => {
    let s = start();
    s.items["greek-decree"].holder = "vale";
    s.items["greek-creon-writ"].holder = "vale";
    s.items["greek-wine-skin"].holder = guard;
    settleGuards(s);
    for (const { kind, ...fields } of [
      { kind: "give", item: "greek-creon-writ", target: guard },
      { kind: "move", target: "greek-courtyard" },
      { kind: "wait" },
    ]) s = act(s, kind, fields);
    expect(s.actors[guard].place).toBe("greek-courtyard");
    expect(
      s.log.some(
        (e) =>
          e.actorId === guard &&
          e.verb === "eat" &&
          e.itemId === "greek-wine-skin",
      ),
    ).toBe(true);
    expect(s.items["greek-creon-writ"].holder).toBe(guard);
    s = act(s, "give", { item: "greek-decree", target: guard });
    expect(s.actors[guard]).toMatchObject({ place: gate, guarding: beyond });
    expect(reload(s)).toEqual(s);
  });
  it("preserves transferred papers and repairs only an untouched old palace start", () => {
    for (const [holder, history, expected] of [
      ["greek-palace", [], "greek-creon"],
      ["greek-courtyard", ["Vale gave the writ to Dione."], "greek-courtyard"],
      ["vale", ["Creon gave Vale the writ."], "vale"],
    ]) {
      const s = start();
      s.packs["greek-drama"].revision = 23;
      Object.assign(s.items["greek-creon-writ"], { holder, history });
      const loaded = decodeSave(JSON.stringify(s));
      expect(loaded.packs["greek-drama"].revision).toBe(24);
      expect(loaded.items["greek-creon-writ"]).toEqual({
        holder: expected,
        history,
      });
    }
  });
});
