// Rules 100, world life: the Gate Guard's standing Wait bars city entry,
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
  BEYOND = "greek-courtyard";
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
  it("bars city entry as a locked way whose button names him", () => {
    const s = lifeWorld({ place: GATE });
    expect(s.actors[GUARD].guarding).toBe(BEYOND);
    expect(exits(s, GATE, "vale")).not.toContain(BEYOND);
    expect(exits(s, GATE, "greek-antigone")).not.toContain(BEYOND);
    expect(exits(s, GATE, GUARD)).toContain(BEYOND);
    expect(sealedReason(s, BEYOND)).toBe(
      "The Gate Guard is guarding this card",
    );
    // The locked card gives no quest: Talk with him gives his (rules 102).
    expect(legalActions(s).some((a) => a.kind === "gate")).toBe(false);
    // The city gate lets travellers leave from the courtyard.
    const far = structuredClone(s);
    far.actors.vale.place = BEYOND;
    far.actors.vale.visited.push(GATE);
    const field = reload(far);
    expect(exits(field, BEYOND, "vale")).toContain(GATE);
    expect(sealedReason(field, GATE)).toBe(null);
    expect(exits(field, BEYOND, GUARD)).toContain(GATE);
  });

  it("keeps guarding through a Talk", () => {
    let s = lifeWorld({ place: GATE });
    s = act(s, "talk", { target: GUARD });
    expect(s.actors[GUARD].guarding).toBe(BEYOND);
    expect(sealedReason(s, BEYOND)).toBe(
      "The Gate Guard is guarding this card",
    );
  });

  it("is knocked through on defeat, holds a grudge, walks back and bars again", () => {
    let s = beatGuard(lifeWorld({ place: GATE }));
    expect(s.actors[GUARD].place).toBe(BEYOND);
    expect(s.actors[GUARD].guarding).toBeUndefined();
    expect(s.log.some((e) => /knocked through/u.test(e.text))).toBe(true);
    const grudge = s.motives.grievances[GUARD].find((g) => g.other === "vale");
    expect(grudge).toMatchObject({ kind: "threat" });
    expect(grudge.weight).toBeGreaterThanOrEqual(1);
    // The way is open while he is away.
    expect(exits(s, GATE, "vale")).toContain(BEYOND);
    expect(sealedReason(s, BEYOND)).toBe(null);
    // After the peace he walks home, off-stage, and bars the way again.
    s = act(s, "move", { target: "greek-battlefield" });
    for (let i = 0; i < 8 && s.actors[GUARD].place !== GATE; i++) s = wait(s);
    expect(s.actors[GUARD].place).toBe(GATE);
    expect(s.actors[GUARD].guarding).toBe(BEYOND);
    s = act(s, "move", { target: GATE });
    expect(exits(s, GATE, "vale")).not.toContain(BEYOND);
    expect(sealedReason(s, BEYOND)).toBe(
      "The Gate Guard is guarding this card",
    );
  });

  it("stands aside while he holds Creon's writ, wherever he stands", () => {
    let s = lifeWorld({ place: "greek-courtyard" });
    s.actors[GUARD].place = "greek-courtyard";
    s.actors[GUARD].homeward = true;
    s.items["greek-creon-writ"].holder = GUARD;
    s = wait(reload(s));
    for (let i = 0; i < 4 && s.actors[GUARD].place !== GATE; i++) s = wait(s);
    expect(s.actors[GUARD].place).toBe(GATE);
    expect(s.actors[GUARD].guarding).toBeUndefined();
    s = act(s, "move", { target: GATE });
    expect(exits(s, GATE, "vale")).toContain(BEYOND);
    expect(sealedReason(s, BEYOND)).toBe(null);
  });
});

describe("a player's guard", () => {
  const opened = () => {
    const s = lifeWorld({ place: GATE });
    s.items["greek-creon-writ"].holder = GUARD;
    return wait(reload(s));
  };
  it("stands as a Wait on a guardable way and bars residents only", () => {
    let s = opened();
    const { actions } = cardActions(s, ["vale", BEYOND]);
    expect(actions).toHaveLength(1);
    expect(cardActions(s, [BEYOND]).actions.map((a) => a.kind)).toEqual([
      "move",
    ]);
    const [guard] = actions;
    expect(guard).toMatchObject({
      kind: "wait",
      label: "Guard",
      cards: ["vale", BEYOND],
    });
    const done = play(s, guard, s.revision);
    expect(done.ok, done.error).toBe(true);
    s = done.state;
    expect(s.actors.vale.guarding).toBe(BEYOND);
    expect(
      s.log.findLast((e) => e.actorId === "vale" && e.verb === "wait"),
    ).toMatchObject({ guards: BEYOND });
    expect(exits(s, GATE, "greek-antigone")).not.toContain(BEYOND);
    expect(exits(s, GATE, "vale")).toContain(BEYOND);
    // Guard again keeps it; any other play ends it.
    const again = legalActions(s).find((a) => a.guards === BEYOND);
    s = play(s, again, s.revision).state;
    expect(s.actors.vale.guarding).toBe(BEYOND);
    s = wait(s);
    expect(s.actors.vale.guarding).toBeUndefined();
    expect(exits(s, GATE, "greek-antigone")).toContain(BEYOND);
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
    const guard = view("vale").actions.find((a) => a.guards === BEYOND);
    world = dispatchShared({
      op: "play",
      world,
      actor: "vale",
      action: guard,
      ...seats,
    }).world;
    expect(world.actors.vale.guarding).toBe(BEYOND);
    expect(view("mara").exits).toContain(BEYOND);
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

// The battlefield reaches the outside junction and the personal Hollow.
const FIELD = "greek-battlefield";
const waysOut = (s) =>
  [
    ...new Set([
      ...exits(s, FIELD, "vale"),
      ...sealedWays(s, "vale").map((r) => r.to),
    ]),
  ].sort();

describe("the Exposed Battlefield", () => {
  it("reaches the outside gate while the Hollow waits for its own quest", () => {
    const s = lifeWorld({ place: FIELD });
    expect(waysOut(s)).toEqual([GATE, "greek-polynices-hollow"]);
    expect(exits(s, FIELD, "vale")).toContain(GATE);
    expect(sealedReason(s, "greek-polynices-hollow")).toMatch(
      /Polynices.*Shade/,
    );
  });

  it("keeps its ways out when a rules 99 world upgrades", () => {
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
    // A world whose Theban release has opened the road (the guard's tablet
    // on Dione's table): before that the road is not yet in the world.
    delete old.opening;
    old.packs["greek-drama"].scope = "full";
    old.actors.vale.place = FIELD;
    const upgraded = decodeSave(JSON.stringify(old));
    expect(upgraded.actors[GUARD].guarding).toBe(BEYOND);
    expect(waysOut(upgraded)).toEqual([GATE, "greek-polynices-hollow"]);
    expect(exits(upgraded, FIELD, GUARD)).toContain(GATE);
  });
});
