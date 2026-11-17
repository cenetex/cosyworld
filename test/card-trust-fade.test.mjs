import { describe, expect, it } from "vitest";
import { createWorld, decodeSave, encodeSave, wantAPI } from "../v2/card-game/world.mjs";
import { newWant, settleWants } from "../v2/card-game/want.mjs";
import { TRUST_FADE_TURNS, fadeTrust, gainTrust } from "../v2/card-game/world/company.mjs";

function met() {
  const s = createWorld();
  s.turn = s.revision = 10;
  s.actors.moth.place = s.actors.keeper.place = "station";
  s.actors.moth.want = newWant("person", "keeper", 0);
  settleWants(s, ["moth", "keeper"], wantAPI(s), {
    kind: "talk",
    actor: "moth",
    target: "keeper",
  });
  return s;
}

describe("trust from met wants", () => {
  it("raises a resident's trust in the resident who met its want", () => {
    const s = met();
    expect(s.actors.moth.trust.keeper).toBe(1);
    expect(s.actors.moth.contact).toEqual({ keeper: [10, 0] });
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });

  it("keeps it while they share a place, and lets it fade apart", () => {
    const s = met();
    s.turn += TRUST_FADE_TURNS * 2;
    fadeTrust(s);
    expect(s.actors.moth.trust.keeper).toBe(1);
    s.actors.keeper.place = "pond";
    const seen = s.turn;
    s.turn = seen + TRUST_FADE_TURNS - 1;
    fadeTrust(s);
    expect(s.actors.moth.trust.keeper).toBe(1);
    s.turn = seen + TRUST_FADE_TURNS;
    fadeTrust(s);
    expect(s.actors.moth.trust.keeper).toBe(0);
    expect(s.actors.moth.contact).toBeUndefined();
  });

  it("fades back to where it stood, never below", () => {
    const s = createWorld();
    s.actors.moth.place = "station";
    s.actors.keeper.place = "pond";
    s.actors.moth.trust.keeper = 1;
    gainTrust(s, "moth", "keeper");
    gainTrust(s, "moth", "keeper");
    expect(s.actors.moth.trust.keeper).toBe(3);
    for (let i = 1; i <= 4; i++) {
      s.turn = i * TRUST_FADE_TURNS;
      fadeTrust(s);
    }
    expect(s.actors.moth.trust.keeper).toBe(1);
    expect(s.actors.moth.contact).toBeUndefined();
    gainTrust(s, "moth", "keeper");
    s.actors.moth.trust.keeper = 0;
    s.turn += TRUST_FADE_TURNS;
    fadeTrust(s);
    expect(s.actors.moth.trust.keeper).toBe(0);
  });
});
