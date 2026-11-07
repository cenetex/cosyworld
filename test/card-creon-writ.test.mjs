import { describe, expect, it } from "vitest";
import { endStandoff } from "./helpers/standoff.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { guardPost, settleGuards } from "../v2/card-game/resident-guard.mjs";
import { entityActive, packPeople } from "../v2/card-game/pack-registry.mjs";
const guard = "greek-guard",
  gate = "greek-gate",
  beyond = guardPost(guard).to;
function start() {
  const s = createWorld({ seed: 7 });
  s.actors.vale.place = gate;
  for (const id of Object.keys(packPeople))
    if (id.startsWith("greek-") && entityActive(s, id))
      s.packs["greek-drama"].met[id] = 0;
  return s;
}
describe("the guard's two ordinary papers", () => {
  it("uses each traveller's friendship when the guard has both papers", () => {
    const s = start();
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
    s.actors["greek-ismene"].place = gate;
    expect(
      legalActions(s).some(
        (a) =>
          a.kind === "accompany" &&
          a.target === "greek-ismene" &&
          a.destination === beyond,
      ),
    ).toBe(false);
    const action = legalActions(s).find(
      (a) => a.kind === "move" && a.target === beyond,
    );
    const done = play(s, action);
    expect(done.ok).toBe(true);
    expect(
      done.state.log.find((e) => e.actorId === "vale" && e.verb === "move")
        .text,
    ).toContain("lets Vale through");
    expect(decodeSave(encodeSave(done.state))).toEqual(done.state);
  });
  it("ends friendly passage after a real threat", () => {
    let s = start();
    s.items["greek-creon-writ"].holder = guard;
    s.actors[guard].trust.vale = 2;
    const threat = legalActions(s).find(
      (a) => a.kind === "threaten" && a.target === guard,
    );
    s = endStandoff(play(s, threat).state);
    expect(s.motives.grievances[guard].some((g) => g.other === "vale")).toBe(
      true,
    );
    expect(exits(s, gate, "vale")).not.toContain(beyond);
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });
  it("walks to the common table and drinks through its ordinary quest", () => {
    let s = start();
    s.items["greek-decree"].holder = "vale";
    s.items["greek-creon-writ"].holder = "vale";
    s.items["greek-wine-skin"].holder = guard;
    settleGuards(s);
    for (const fields of [
      { kind: "give", item: "greek-creon-writ", target: guard },
      { kind: "move", target: "greek-courtyard" },
      { kind: "wait" },
    ]) {
      const action = legalActions(s).find(
        (a) => !a.sleep && Object.entries(fields).every(([k, v]) => a[k] === v),
      );
      expect(action).toBeDefined();
      s = play(s, action).state;
    }
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
    const order = legalActions(s).find(
      (a) =>
        a.kind === "give" && a.item === "greek-decree" && a.target === guard,
    );
    expect(order).toBeDefined();
    s = play(s, order).state;
    expect(s.actors[guard]).toMatchObject({ place: gate, guarding: beyond });
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });
  it("preserves transferred papers and repairs only an untouched old palace start", () => {
    for (const [holder, history, expected] of [
      ["greek-palace", [], "greek-creon"],
      ["greek-courtyard", ["Vale gave the writ to Dione."], "greek-courtyard"],
      ["vale", ["Creon gave Vale the writ."], "vale"],
    ]) {
      const s = start();
      s.packs["greek-drama"].revision = 22;
      Object.assign(s.items["greek-creon-writ"], { holder, history });
      const loaded = decodeSave(JSON.stringify(s));
      expect(loaded.items["greek-creon-writ"]).toEqual({
        holder: expected,
        history,
      });
    }
  });
});
