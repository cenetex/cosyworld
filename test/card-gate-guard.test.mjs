// Rules 100, world life: the Gate Guard's standing Wait bars the battlefield,
// and a player may stand guard at a guardable way.
import { describe, expect, it } from "vitest";
import {
  encodeSave,
  exits,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { sealedReason } from "../v2/card-game/cards.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { act, lifeWorld, reload, wait } from "./helpers/world-life.mjs";

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
    expect(sealedReason(s, FIELD)).toBe("The Gate Guard bars the way");
    // Seeking the way still gives the decree's quest.
    expect(legalActions(s).find((a) => a.kind === "gate")?.text).toBe(
      "The Gate Guard bars the way",
    );
    // Never a trap: the way back from the battlefield stays open to anyone
    // who has been at the gate, and the city stays shut to the rest.
    const far = structuredClone(s);
    far.actors.vale.place = FIELD;
    expect(exits(reload(far), FIELD, "vale")).not.toContain(GATE);
    far.actors.vale.visited.push(GATE);
    expect(exits(reload(far), FIELD, "vale")).toContain(GATE);
    expect(exits(reload(far), FIELD, GUARD)).toContain(GATE);
  });

  it("keeps guarding through a Talk", () => {
    let s = lifeWorld({ place: GATE });
    s = act(s, "talk", { target: GUARD });
    expect(s.actors[GUARD].guarding).toBe(FIELD);
    expect(sealedReason(s, FIELD)).toBe("The Gate Guard bars the way");
  });

  it("is knocked through on defeat, holds a grudge, walks back and bars again", () => {
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
    // After the peace he walks home, off-stage, and bars the way again.
    s = act(s, "move", { target: "greek-courtyard" });
    for (let i = 0; i < 8 && s.actors[GUARD].place !== GATE; i++) s = wait(s);
    expect(s.actors[GUARD].place).toBe(GATE);
    expect(s.actors[GUARD].guarding).toBe(FIELD);
    s = act(s, "move", { target: GATE });
    expect(exits(s, GATE, "vale")).not.toContain(FIELD);
    expect(sealedReason(s, FIELD)).toBe("The Gate Guard bars the way");
  });

  it("lifts the bar for good when he holds the decree, wherever he stands", () => {
    let s = lifeWorld({ place: "greek-courtyard" });
    s.actors[GUARD].place = "greek-courtyard";
    s.actors[GUARD].homeward = true;
    s.items["greek-decree"].holder = GUARD;
    s = wait(reload(s));
    expect(s.openedRoutes).toContain(`${GATE}>${FIELD}`);
    for (let i = 0; i < 4 && s.actors[GUARD].place !== GATE; i++) s = wait(s);
    expect(s.actors[GUARD].place).toBe(GATE);
    expect(s.actors[GUARD].guarding).toBeUndefined();
    s = act(s, "move", { target: GATE });
    expect(exits(s, GATE, "vale")).toContain(FIELD);
    expect(sealedReason(s, FIELD)).toBe(null);
  });
});

describe("a player's guard", () => {
  const opened = () => {
    const s = lifeWorld({ place: GATE });
    s.items["greek-decree"].holder = GUARD;
    return wait(reload(s));
  };
  it("stands as a Wait on a guardable way and bars residents only", () => {
    let s = opened();
    const guard = legalActions(s).find((a) => a.guards === FIELD);
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
