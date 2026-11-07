import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { settleGuards } from "../v2/card-game/resident-guard.mjs";
import { freed, packPeople } from "../v2/card-game/pack-registry.mjs";
const guard = "greek-guard",
  gate = "greek-gate",
  beyond = "greek-battlefield";
function start() {
  const s = createWorld({ seed: 7 });
  s.actors.vale.place = gate;
  for (const id of Object.keys(packPeople))
    if (id.startsWith("greek-")) s.packs["greek-drama"].met[id] = 0;
  return s;
}
describe("the guard's two ordinary papers", () => {
  it("starts with the Gate Decree on duty and the Writ with Creon", () => {
    const s = start();
    expect(s.items["greek-decree"].holder).toBe(guard);
    expect(s.items["greek-creon-writ"].holder).toBe("greek-creon");
    expect(exits(s, gate, "vale")).not.toContain(beyond);
    s.items["greek-decree"].holder = "vale";
    s.items["greek-creon-writ"].holder = guard;
    settleGuards(s);
    expect(freed(s, guard)).toBe(true);
    expect(exits(s, gate, "vale")).toContain(beyond);
  });
  it("uses each traveller's friendship when the guard has both papers", () => {
    const s = start();
    s.sharedVersion = 1;
    s.controlledActors = s.presentActors = ["vale", "rue"];
    s.actors.rue.place = gate;
    s.items["greek-creon-writ"].holder = guard;
    s.actors[guard].trust.vale = 1;
    settleGuards(s);
    expect(s.actors[guard].guarding).toBe(beyond);
    expect(exits(s, gate, "vale")).toContain(beyond);
    expect(exits(s, gate, "rue")).not.toContain(beyond);
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
