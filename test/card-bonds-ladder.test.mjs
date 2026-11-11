import { afterEach, describe, expect, it } from "vitest";
import { lifeWorld, reload } from "./helpers/world-life.mjs";
import { accompanyDecision } from "../v2/card-game/world.mjs";
import { revealed, wantFact, wantOf } from "../v2/card-game/want-talk.mjs";
import {
  applyPackChoice,
  packDefinition,
  packDefinitions,
  packPeople,
  personalRouteOpen,
  validatePackDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { passengers } from "../v2/card-game/pack-transport.mjs";

// A Patroclus-shaped resident, made from Ismene in memory: aboard the ship
// after a flag, met on the ship (trust one), tells her want at trust one,
// travels at trust two, and her home is a door behind trust three.
const R = "greek-ismene",
  ship = "greek-ship",
  field = "greek-battlefield",
  hollow = "greek-polynices-hollow";
const pack = packDefinitions.find((p) => p.id === "greek-drama");
const route = pack.routes.find((r) => r.from === field && r.to === hollow);
const saved = {
  requires: packPeople[R].requires,
  want: packPeople[R].want,
  routeRequires: route.requires,
  routeTraveler: route.travelerRequires,
  choices: pack.choices,
};
const restore = (o, k, v) => (v === undefined ? delete o[k] : (o[k] = v));
afterEach(() => {
  restore(packPeople[R], "requires", saved.requires);
  packPeople[R].want = saved.want;
  restore(route, "requires", saved.routeRequires);
  restore(route, "travelerRequires", saved.routeTraveler);
  pack.choices = saved.choices;
});
const human = (s) => {
  s.sharedVersion = 1;
  s.controlledActors = s.presentActors = ["vale"];
  return s;
};
const meeting = (patch = {}) => ({
  id: "test-meet-ismene",
  on: "talk",
  subject: R,
  at: "greek-sanctuary",
  label: "Meet",
  text: "We meet.",
  effects: [{ kind: "trust", level: 1 }],
  ...patch,
});
const wanting = (target) => ({ kind: "place", target, since: 0, refusals: 0 });

describe("trust tiers", () => {
  it("accepts an invitation that serves no want only at trust two", () => {
    const s = human(lifeWorld({ place: "greek-gate" }));
    s.actors[R].place = "greek-gate";
    // Her want is the room she already stands in, so no trip brings it closer.
    s.actors[R].want = wanting("greek-gate");
    const to = "greek-courtyard";
    s.actors[R].trust.vale = 1;
    expect(accompanyDecision(s, "vale", R, to, true).accepted).toBe(false);
    s.actors[R].trust.vale = 2;
    expect(accompanyDecision(s, "vale", R, to, true).accepted).toBe(true);
    s.actors[R].trust.vale = 0;
    expect(accompanyDecision(s, "vale", R, to, true).accepted).toBe(false);
  });
  it("still accepts, without trust, a trip that serves her want", () => {
    const s = human(lifeWorld({ place: "greek-gate" }));
    s.actors[R].place = "greek-gate";
    s.actors[R].want = wanting("greek-courtyard");
    s.actors[R].trust.vale = 0;
    expect(
      accompanyDecision(s, "vale", R, "greek-courtyard", true).accepted,
    ).toBe(true);
  });
});

describe("want.minTrust", () => {
  it("tells the desire only at that trust, and only to a listener", () => {
    const s = lifeWorld();
    s.actors[R].place = "greek-gate";
    const want = wantOf(s, R);
    expect(revealed(s, R, want, "vale")).toBe(true);
    packPeople[R].want = { ...packPeople[R].want, minTrust: 1 };
    s.actors[R].trust.vale = 0;
    expect(revealed(s, R, want, "vale")).toBe(false);
    expect(wantFact(s, R, (id) => id, "vale")).toBeNull();
    expect(revealed(s, R, want)).toBe(true);
    s.actors[R].trust.vale = 1;
    expect(revealed(s, R, want, "vale")).toBe(true);
    // A resident whose want declares no minTrust is not gated.
    const baker = wantOf(s, "greek-guard");
    expect(revealed(s, "greek-guard", baker, "vale")).toBe(true);
  });
  it("validates the field", () => {
    for (const [minTrust, ok] of [
      [1, true],
      [3, true],
      [0, false],
      [4, false],
    ]) {
      const p = structuredClone(packDefinition("greek-drama"));
      p.avatars[R].want.minTrust = minTrust;
      const check = () => validatePackDefinition(p);
      if (ok) expect(check).not.toThrow();
      else expect(check).toThrow();
    }
  });
});

describe("a meeting sets trust", () => {
  it("raises trust to the level, never lowers it", () => {
    pack.choices = [...pack.choices, meeting()];
    const s = human(lifeWorld({ place: "greek-sanctuary" }));
    s.actors[R].place = "greek-sanctuary";
    s.actors[R].trust.vale = 0;
    const meet = (choiceId) =>
      applyPackChoice(
        s,
        { packId: pack.id, choiceId, actor: "vale" },
        { mode: "talk" },
      );
    meet("test-meet-ismene");
    expect(s.actors[R].trust.vale).toBe(1);
    expect(reload(s)).toEqual(s);
    pack.choices = [...saved.choices, meeting({ id: "test-meet-two" })];
    s.actors[R].trust.vale = 3;
    meet("test-meet-two");
    expect(s.actors[R].trust.vale).toBe(3);
  });
  it("is valid only on a meet or talk choice with a level of one to three", () => {
    const attempt = (choice) => {
      const p = structuredClone(packDefinition("greek-drama"));
      p.choices.push(choice);
      validatePackDefinition(p);
    };
    expect(() => attempt(meeting())).not.toThrow();
    expect(() => attempt(meeting({ on: "meet" }))).not.toThrow();
    expect(() =>
      attempt(meeting({ effects: [{ kind: "trust", level: 4 }] })),
    ).toThrow();
    expect(() =>
      attempt(meeting({ effects: [{ kind: "trust", level: 0 }] })),
    ).toThrow();
    expect(() => attempt(meeting({ on: "wait" }))).toThrow();
  });
});

describe("a home behind trust three", () => {
  it("opens per traveler, and the keeper passes his own door", () => {
    route.requires = [];
    route.travelerRequires = [{ kind: "trusted", actor: R, min: 3 }];
    const s = lifeWorld();
    s.actors[R].trust.vale = 2;
    expect(personalRouteOpen(s, field, hollow, "vale")).toBe(false);
    s.actors[R].trust.vale = 3;
    expect(personalRouteOpen(s, field, hollow, "vale")).toBe(true);
    expect(personalRouteOpen(s, field, hollow, R)).toBe(true);
    s.actors[R].trust.vale = 0;
    expect(personalRouteOpen(s, field, hollow, R)).toBe(true);
  });
  it("accepts trusted in travelerRequires only", () => {
    const trusted = [{ kind: "trusted", actor: R, min: 3 }];
    const withKey = (key) => {
      const p = structuredClone(packDefinition("greek-drama"));
      const q = p.routes.find((x) => x.from === field && x.to === hollow);
      q[key] = trusted;
      validatePackDefinition(p);
    };
    expect(() => withKey("travelerRequires")).not.toThrow();
    expect(() => withKey("requires")).toThrow();
  });
});

describe("ships hold only active riders", () => {
  it("does not count a resident whose condition has not yet held", () => {
    packPeople[R].requires = [{ kind: "flag", key: "boarded", value: true }];
    const s = lifeWorld({ place: "greek-gate" });
    s.actors[R].place = ship;
    expect(passengers(s, ship)).toHaveLength(0);
    s.packs["greek-drama"].flags.boarded = true;
    expect(passengers(s, ship)).toEqual([s.actors[R]]);
  });
  it("does not count a human who left the table", () => {
    const s = human(lifeWorld({ place: ship }));
    expect(passengers(s, ship).map((a) => a.place)).toEqual([ship]);
    s.actors.vale.place = ship;
    // Away from the table, a shared avatar lives on as a resident and still
    // rides; one marked absent is not a rider and cannot hold the ship.
    s.controlledActors = s.presentActors = [];
    expect(passengers(s, ship)).toHaveLength(1);
    s.absent = ["vale"];
    expect(passengers(s, ship)).toHaveLength(0);
  });
});
