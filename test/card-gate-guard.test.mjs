// Rules 100, world life: the Gate Guard's standing Wait bars the battlefield,
// and a player may stand guard at a guardable way.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  decodeSave,
  encodeSave,
  exits,
  legalActions,
  play,
  sealedWays,
} from "../v2/card-game/world.mjs";
import { cardActions, sealedReason } from "../v2/card-game/cards.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  act,
  lifeWorld,
  reload,
  settleGate,
  wait,
} from "./helpers/world-life.mjs";

const GUARD = "greek-guard",
  GATE = "greek-gate",
  FIELD = "greek-battlefield";
// Beat the guard at his post: threaten, then strike until he yields.
function beatGuard(s) {
  s = act(s, "threaten", { target: GUARD });
  for (let i = 0; i < 24 && s.actors[GUARD].place === GATE; i++) {
    const strike = legalActions(s).find(
      (a) => a.kind === "attack" && a.target === GUARD,
    );
    const done = play(s, strike || legalActions(s)[0], s.revision);
    expect(done.ok, done.error).toBe(true);
    s = done.state;
  }
  // Anyone else at the gate joined in; a round of waits ends it.
  for (let i = 0; i < 6 && s.standoffs.length; i++) s = wait(s);
  return s;
}

describe("the Gate Guard", () => {
  it("bars the battlefield as a locked way whose button names him", () => {
    const s = lifeWorld({ place: GATE });
    expect(s.actors[GUARD].guarding).toBe(FIELD);
    expect(exits(s, GATE, "vale")).not.toContain(FIELD);
    expect(exits(s, GATE, "greek-antigone")).not.toContain(FIELD);
    expect(exits(s, GATE, GUARD)).toContain(FIELD);
    expect(sealedReason(s, FIELD)).toBe("The Gate Guard is guarding this card");
    // The locked card gives no quest: Talk with him gives his (rules 102).
    expect(legalActions(s).some((a) => a.kind === "gate")).toBe(false);
    // He bars the gate from the battlefield side too: there it is the
    // locked box with the same reason, and only he may pass.
    const far = structuredClone(s);
    far.actors.vale.place = FIELD;
    far.actors.vale.visited.push(GATE);
    const field = reload(far);
    expect(exits(field, FIELD, "vale")).not.toContain(GATE);
    expect(sealedReason(field, GATE)).toBe(
      "The Gate Guard is guarding this card",
    );
    expect(exits(field, FIELD, GUARD)).toContain(GATE);
  });

  it("keeps guarding through a Talk", () => {
    let s = lifeWorld({ place: GATE });
    s = act(s, "talk", { target: GUARD });
    expect(s.actors[GUARD].guarding).toBe(FIELD);
    expect(sealedReason(s, FIELD)).toBe("The Gate Guard is guarding this card");
  });

  it("is knocked through on defeat, yields his order and holds a grudge", () => {
    let s = beatGuard(lifeWorld({ place: GATE }));
    expect(s.actors[GUARD].place).toBe(FIELD);
    expect(s.actors[GUARD].guarding).toBeUndefined();
    expect(s.log.some((e) => /knocked through/u.test(e.text))).toBe(true);
    const grudge = s.motives.grievances[GUARD].find((g) => g.other === "vale");
    expect(grudge).toMatchObject({ kind: "threat" });
    expect(grudge.weight).toBeGreaterThanOrEqual(1);
    // The way is open while he is away.
    expect(exits(s, GATE, "vale")).toContain(FIELD);
    expect(sealedReason(s, FIELD)).toBe(null);
    expect(s.items["greek-decree"].holder).toBe(GATE);
  });

  it.each([GATE, "greek-courtyard", FIELD])(
    "has no duty without the Gate Decree while at %s",
    (place) => {
      const s = lifeWorld({ place: GATE });
      s.actors[GUARD].place = place;
      s.items["greek-decree"].holder = "greek-creon";
      settleGate(s);
      expect(s.actors[GUARD].guarding).toBeUndefined();
      expect(exits(s, GATE, "vale")).toContain(FIELD);
      expect(sealedReason(s, FIELD)).toBe(null);
    },
  );
});

describe("a player's guard", () => {
  const opened = () => {
    const s = lifeWorld({ place: GATE });
    s.items["greek-decree"].holder = "greek-creon";
    return wait(reload(s));
  };
  it("stands as a Wait on a guardable way and bars residents only", () => {
    let s = opened();
    const { actions } = cardActions(s, ["vale", FIELD]);
    expect(actions).toHaveLength(1);
    expect(cardActions(s, [FIELD]).actions.map((a) => a.kind)).toEqual([
      "move",
    ]);
    const [guard] = actions;
    expect(guard).toMatchObject({
      kind: "wait",
      label: "Guard",
      cards: ["vale", FIELD],
    });
    const done = play(s, guard, s.revision);
    expect(done.ok, done.error).toBe(true);
    s = done.state;
    expect(s.actors.vale.guarding).toBe(FIELD);
    expect(
      s.log.findLast((e) => e.actorId === "vale" && e.verb === "wait"),
    ).toMatchObject({ guards: FIELD });
    expect(exits(s, GATE, "greek-antigone")).not.toContain(FIELD);
    expect(exits(s, GATE, "vale")).toContain(FIELD);
    // Guard again keeps it; any other play ends it.
    const again = legalActions(s).find((a) => a.guards === FIELD);
    s = play(s, again, s.revision).state;
    expect(s.actors.vale.guarding).toBe(FIELD);
    s = wait(s);
    expect(s.actors.vale.guarding).toBeUndefined();
    expect(exits(s, GATE, "greek-antigone")).toContain(FIELD);
  });

  it("never bars another player in a shared world and lapses when its player leaves", () => {
    const seats = { claimed: ["vale", "mara"], present: ["vale", "mara"] };
    let world = dispatchShared({
      op: "create",
      seed: 7,
      save: encodeSave(opened()),
    }).world;
    const view = (actor, present = seats.present) =>
      dispatchShared({ op: "view", world, actor, ...seats, present });
    world = dispatchShared({
      op: "join",
      world,
      actor: "mara",
      ...seats,
    }).world;
    world.actors.mara.place = GATE;
    world = dispatchShared({
      op: "validate",
      world,
      actor: "mara",
      ...seats,
    }).world;
    const guard = view("vale").actions.find((a) => a.guards === FIELD);
    world = dispatchShared({
      op: "play",
      world,
      actor: "vale",
      action: guard,
      ...seats,
    }).world;
    expect(world.actors.vale.guarding).toBe(FIELD);
    expect(view("mara").exits).toContain(FIELD);
    // Vale leaves: the guard lapses at the next play.
    world = dispatchShared({
      op: "play",
      world,
      actor: "mara",
      action: view("mara", ["mara"]).actions.find(
        (a) => a.kind === "wait" && !a.sleep && !a.guards,
      ),
      claimed: seats.claimed,
      present: ["mara"],
    }).world;
    expect(world.actors.vale.guarding).toBeUndefined();
  });
});

// The battlefield's ways out are the always-open Cithaeron road and the
// guarded City Gate. Personal passage to the Hollow remains separately gated.
const waysOut = (s) =>
  [
    ...new Set([
      ...exits(s, FIELD, "vale"),
      ...sealedWays(s, "vale").map((r) => r.to),
    ]),
  ].sort();
const ROAD = "greek-cithaeron";
describe("the Exposed Battlefield", () => {
  it("keeps the road open while the City Gate and Hollow keep their gates", () => {
    let s = lifeWorld({ place: FIELD });
    expect(waysOut(s)).toEqual([ROAD, GATE, "greek-polynices-hollow"]);
    expect(sealedReason(s, GATE)).toBe("The Gate Guard is guarding this card");
    expect(sealedReason(s, ROAD)).toBe(null);
    // Removing the duty order lifts the City Gate bar; the road stays open.
    s.items["greek-decree"].holder = "greek-creon";
    s = settleGate(reload(s));
    expect(exits(s, FIELD, "vale").sort()).toEqual([
      ROAD,
      GATE,
    ]);
    expect(sealedReason(s, "greek-polynices-hollow")).toMatch(/Polynices.*Shade/);
    expect(exits(s, GATE, "vale")).toContain(FIELD);
    expect(waysOut(s)).toEqual([ROAD, GATE, "greek-polynices-hollow"]);
  });

  it("keeps the road open in a rules 99 world upgraded to 100", () => {
    const file = (f) =>
      readFileSync(`v2/orchestrator-rust/src/card_shared/${f}`, "utf8");
    const context = vm.createContext({
      structuredClone,
      // Released rules read the content they shipped with.
      cardContent: JSON.parse(
        readFileSync("test/fixtures/card-content-rules-101.json", "utf8"),
      ),
    });
    vm.runInContext(file("engine-v99.js"), context);
    const old = JSON.parse(
      context.cardShared(JSON.stringify({ op: "create", seed: 9 })),
    ).world;
    // The road is open after this old world loads under current rules.
    delete old.opening;
    old.packs["greek-drama"].scope = "full";
    old.actors.vale.place = FIELD;
    const upgraded = decodeSave(JSON.stringify(old));
    expect(upgraded.items["greek-decree"].holder).toBe(
      old.items["greek-decree"].holder,
    );
    expect(waysOut(upgraded)).toEqual([ROAD, GATE, "greek-polynices-hollow"]);
    expect(exits(upgraded, FIELD, GUARD)).toContain(GATE);
  });
});
