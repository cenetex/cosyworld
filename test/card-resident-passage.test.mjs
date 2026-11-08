import { afterEach, beforeEach, expect, it } from "vitest";
import { endStandoff } from "./helpers/standoff.mjs";
import { act, lifeWorld, reload } from "./helpers/world-life.mjs";
import { exits, legalActions } from "../v2/card-game/world.mjs";
import {
  packDefinition,
  packPeople,
  validatePackDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { guardPost } from "../v2/card-game/resident-guard.mjs";

const guard = "greek-guard",
  gate = "greek-gate",
  beyond = guardPost(guard).to,
  previous = packPeople[guard].passWhen;
const passage = [{ kind: "trusted", actor: guard, min: 1 }];
beforeEach(() => {
  packPeople[guard].passWhen = passage;
});
afterEach(() => {
  if (previous === undefined) delete packPeople[guard].passWhen;
  else packPeople[guard].passWhen = previous;
});

it("checks the traveller and each invited companion while keeping the guard posted", () => {
  const authored = structuredClone(packDefinition("greek-drama"));
  authored.avatars[guard].passWhen = passage;
  expect(() => validatePackDefinition(authored)).not.toThrow();
  let s = lifeWorld({ place: gate });
  s.sharedVersion = 1;
  s.controlledActors = s.presentActors = ["vale", "rue"];
  s.actors.rue.place = s.actors["greek-ismene"].place = gate;
  s.actors[guard].trust.vale = 1;
  expect(s.actors[guard].guarding).toBe(beyond);
  expect(exits(s, gate, "vale")).toContain(beyond);
  expect(exits(s, gate, "rue")).not.toContain(beyond);
  expect(legalActions(s)).not.toContainEqual(
    expect.objectContaining({
      kind: "accompany",
      target: "greek-ismene",
      destination: beyond,
    }),
  );
  s.actors[guard].trust["greek-ismene"] = 1;
  expect(legalActions(s)).toContainEqual(
    expect.objectContaining({
      kind: "accompany",
      target: "greek-ismene",
      destination: beyond,
    }),
  );
  s = act(s, "move", { target: beyond });
  expect(s.log).toContainEqual(
    expect.objectContaining({
      actorId: "vale",
      verb: "move",
      text: expect.stringContaining("lets Vale through"),
    }),
  );
  expect(reload(s)).toEqual(s);
});

it("gives a real grievance priority over positive trust", () => {
  let s = lifeWorld({ place: gate });
  s.actors[guard].trust.vale = 2;
  s = endStandoff(act(s, "threaten", { target: guard }));
  expect(s.actors[guard].trust.vale).toBeGreaterThan(0);
  expect(s.motives.grievances[guard]).toContainEqual(
    expect.objectContaining({ other: "vale", kind: "threat" }),
  );
  expect(exits(s, gate, "vale")).not.toContain(beyond);
  expect(reload(s)).toEqual(s);
});

it("walks a carried meal to its quest place through ordinary resident plays", () => {
  let s = lifeWorld({ place: "greek-courtyard" });
  const resident = "mara",
    wine = "greek-wine-skin";
  s.sharedVersion = 1;
  s.controlledActors = s.presentActors = ["vale"];
  s.actors[resident].place = "greek-courtyard";
  s.items[wine].holder = resident;
  s.actors[resident].want = {
    kind: "item",
    target: wine,
    since: s.turn,
    refusals: 0,
    step: { verb: "eat", at: gate },
  };
  s = act(s, "wait");
  expect(s.actors[resident].place).toBe(gate);
  s = act(s, "move", { target: gate });
  s = act(s, "wait");
  expect(s.log).toContainEqual(
    expect.objectContaining({
      actorId: resident,
      verb: "eat",
      itemId: wine,
      fromLocationId: gate,
    }),
  );
  expect(reload(s)).toEqual(s);
});
