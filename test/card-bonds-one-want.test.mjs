// Rules 133: package 1 (one want) with package 3 (trust tiers). A resident's
// `want.minTrust` keeps Talk from telling the want below that trust, so the
// listener has not "heard" it and cannot accept it.
import { afterEach, describe, expect, it } from "vitest";
import { lifeWorld } from "./helpers/world-life.mjs";
import { legalActions, play } from "../v2/card-game/world.mjs";
import { packPeople } from "../v2/card-game/pack-registry.mjs";
import { toldWant } from "../v2/card-game/talk-quest.mjs";
import { wantOf } from "../v2/card-game/want-talk.mjs";

const R = "greek-ismene";
const saved = packPeople[R].want;
afterEach(() => {
  packPeople[R].want = saved;
});

const talkTo = (s) => {
  const a = legalActions(s).find((x) => x.kind === "talk" && x.target === R);
  expect(a).toBeTruthy();
  return play(s, a).state;
};

const setup = (trust) => {
  const s = lifeWorld();
  s.sharedVersion = 1;
  s.controlledActors = s.presentActors = ["vale"];
  s.actors[R].place = s.actors.vale.place = "greek-gate";
  // A want for a place she can name: her own sanctuary.
  packPeople[R].want = { kind: "place", target: "greek-sanctuary", minTrust: 2 };
  s.actors[R].want = { kind: "place", target: "greek-sanctuary", since: s.turn, refusals: 0 };
  s.actors[R].trust.vale = trust;
  return s;
};

describe("minTrust and the one want", () => {
  it("does not tell, or record as heard, a want below the trust", () => {
    const cold = talkTo(setup(1));
    expect(cold.actors.vale.heard?.[R]).toBeUndefined();
    expect(toldWant(cold, "vale", R)).toBe(false);
  });
  it("tells and records it at the trust", () => {
    const warm = talkTo(setup(2));
    // The resident may renew its want in the same turn, so check what was told.
    expect(warm.actors.vale.heard?.[R]).toBe("place:greek-sanctuary");
  });
});
