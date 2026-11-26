import { describe, expect, it, vi } from "vitest";

// Invented places and people isolate the travel rules from real pack stories.
vi.mock("../v2/card-game/packs.json", async (importOriginal) => {
  const real = await importOriginal();
  const { companyPacks } = await import("./helpers/company-world.mjs");
  return {
    default: {
      ...real.default,
      packs: [...real.default.packs, ...companyPacks],
    },
  };
});

const { createWorld, decodeSave, encodeSave, legalActions, plan, play } =
  await import("../v2/card-game/world.mjs");
const { learnLane } = await import("../v2/card-game/pack-transport.mjs");
const { cardPlay, asleepReason } = await import("../v2/card-game/cards.mjs");
const { life } = await import("../v2/card-game/resident-home.mjs");

const ANN = "co-ann";
const BO = "co-bo";
const CY = "co-cy";
const DEE = "co-dee";

function world({ turn = 60, at = "co-a" } = {}) {
  const state = createWorld({ seed: 5 });
  state.turn = state.revision = turn;
  state.actors.vale.place = at;
  for (const id of [ANN, BO, CY, DEE, "co-oak"]) {
    const resident = state.actors[id];
    resident.want = null;
    resident.content = true;
    resident.trust.vale = 2;
    delete resident.sleeping;
    if (id !== DEE && id !== "co-oak") resident.place = at;
  }
  for (const id of [ANN, BO, CY, "co-oak"]) state.packs["co-home"].met[id] = 0;
  state.packs["co-away"].met[DEE] = 0;
  for (const id of ["moth", "keeper"])
    Object.assign(state.actors[id], {
      place: "attic",
      want: null,
      content: true,
      sleeping: { since: turn, place: "attic", until: turn + 47 },
    });
  return state;
}

function step(state, kind, fields = {}, actor = "vale") {
  const action = legalActions(state, actor).find(
    (offer) =>
      offer.kind === kind &&
      (kind !== "move" || fields.item || !offer.item) &&
      (kind !== "wait" || (!offer.sleep && !offer.guards)) &&
      Object.entries(fields).every(([key, value]) => offer[key] === value),
  );
  expect(action, `${kind} ${JSON.stringify(fields)}`).toBeTruthy();
  const result = play(state, action, state.revision, actor);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}

const go = (state, target) => step(state, "move", { target });
const invite = (state, target, destination, actor) =>
  step(state, "accompany", { target, destination }, actor);
const room = (state, id) => state.actors[id].place;
const atBoth = (state, resident, place, actor = "vale") => {
  expect(room(state, actor)).toBe(place);
  expect(room(state, resident)).toBe(place);
};
const invited = (state) =>
  state.log.findLast((entry) => entry.verb === "accompany");
const offers = (state, target, destination, actor = "vale") =>
  legalActions(state, actor).some(
    (action) =>
      action.kind === "accompany" &&
      action.target === target &&
      action.destination === destination,
  );

function expectNoBinding(state, actor = "vale") {
  expect(state.actors[actor].companion).toBeUndefined();
  expect(state.actors[actor].actedAt).toBeUndefined();
}

describe("explicit invitations", () => {
  it("moves both participants once and keeps trust and custody through reload", () => {
    const before = world();
    before.items["co-key"].holder = ANN;
    const state = invite(before, ANN, "co-b");
    atBoth(state, ANN, "co-b");
    expect(invited(state)).toMatchObject({
      actorId: "vale",
      targetId: ANN,
      destinationId: "co-b",
      accepted: true,
    });
    expectNoBinding(state);
    expect(state.actors[ANN].trust.vale).toBe(2);
    expect(state.items["co-key"].holder).toBe(ANN);
    expect(before.invitedPlaces).toBeUndefined();
    expect(decodeSave(encodeSave(state))).toEqual(state);
  });

  it("keeps a refused invitation in the current room", () => {
    const before = world();
    before.actors[ANN].trust.vale = 0;
    const state = invite(before, ANN, "co-b");
    atBoth(state, ANN, "co-a");
    expect(invited(state)).toMatchObject({ targetId: ANN, accepted: false });
    expectNoBinding(state);
    expect(state.invitedPlaces).toBeUndefined();
  });

  it("offers Invite again for the same resident and makes an ordinary move solo", () => {
    let state = invite(world(), ANN, "co-b");
    expect(cardPlay(state, [ANN, "co-c"]).action).toMatchObject({
      kind: "accompany",
      target: ANN,
      destination: "co-c",
    });
    state = go(state, "co-c");
    expect(room(state, "vale")).toBe("co-c");
    expect(room(state, ANN)).toBe("co-b");
    for (let i = 0; i < 3; i++) state = step(state, "wait");
    expect(room(state, ANN)).toBe("co-b");
    state = go(state, "co-b");
    state = invite(state, ANN, "co-c");
    atBoth(state, ANN, "co-c");
    expect(
      state.log.filter((entry) => entry.verb === "accompany" && entry.accepted),
    ).toHaveLength(2);
  });

  it("opens the route for an invited resident one crossing at a time", () => {
    let state = invite(world(), ANN, "station");
    atBoth(state, ANN, "station");
    expect(state.invitedPlaces[ANN]).toEqual(["station"]);
    state = go(state, "co-far");
    expect(room(state, ANN)).toBe("station");
    expect(state.invitedPlaces[ANN]).toEqual(["station"]);
    state = go(state, "station");
    state = invite(state, ANN, "co-far");
    atBoth(state, ANN, "co-far");
    expect(state.invitedPlaces[ANN]).toEqual(["co-far"]);
  });

  it("boards and disembarks by separate invitations", () => {
    let state = invite(world({ at: "co-c" }), CY, "co-dock");
    learnLane(state, "vale", "co-dock", "co-far-pier");
    state = invite(state, CY, "co-ship");
    atBoth(state, CY, "co-ship");
    state = step(state, "course", { target: "co-far-pier" });
    state = step(state, "wait");
    expect(state.transports["co-ship"]).toMatchObject({
      phase: "arrived",
      dock: "co-far-pier",
      riders: expect.arrayContaining(["vale", CY]),
    });
    state = invite(state, CY, "co-far-pier");
    atBoth(state, CY, "co-far-pier");
    expect(invited(state)).toMatchObject({
      targetId: CY,
      destinationId: "co-far-pier",
      accepted: true,
    });
    expectNoBinding(state);
    expect(decodeSave(encodeSave(state))).toEqual(state);
  });

  it("lets a resident take a player-only way with the traveler on that leg", () => {
    let state = world({ at: "pond" });
    expect(
      legalActions(state, ANN).some((action) => action.target === "co-loft"),
    ).toBe(false);
    state = invite(state, ANN, "co-loft");
    atBoth(state, ANN, "co-loft");
    expect(offers(state, ANN, "pond")).toBe(true);
    state = go(state, "pond");
    expect(room(state, "vale")).toBe("pond");
    expect(room(state, ANN)).toBe("co-loft");
    expect(decodeSave(encodeSave(state))).toEqual(state);
  });

  it("can ask a trusting resident down a one-way route", () => {
    const start = world({ at: "co-c" });
    expect(asleepReason(start, [ANN, "co-pit"])).toBeNull();
    const state = invite(start, ANN, "co-pit");
    atBoth(state, ANN, "co-pit");
    expectNoBinding(state);
    expect(
      legalActions(state, ANN).some((action) => action.kind === "wait"),
    ).toBe(true);
  });
});

describe("independent residents", () => {
  it("leaves a resident free to pursue a new want on their own", () => {
    let state = invite(world(), ANN, "co-b");
    state.actors[ANN].want = {
      kind: "place",
      target: "co-a",
      since: state.turn,
      refusals: 0,
    };
    delete state.actors[ANN].dwellUntil;
    expect(plan(state, ANN).action).toMatchObject({
      kind: "move",
      target: "co-a",
    });
    state = step(state, "wait");
    expect(room(state, ANN)).toBe("co-a");
    expect(room(state, "vale")).toBe("co-b");
  });

  it("lets the same resident accept a different traveler's invite in a shared world", () => {
    let state = world({ at: "co-b" });
    state.sharedVersion = 1;
    state.controlledActors = ["vale", "mara"];
    state.presentActors = ["vale", "mara"];
    state.heldActors = ["vale", "mara"];
    state.actors.mara.place = "co-c";
    state.actors[ANN].trust.mara = 2;
    state = invite(state, ANN, "co-c");
    expect(offers(state, ANN, "co-b", "mara")).toBe(true);
    state = invite(state, ANN, "co-b", "mara");
    atBoth(state, ANN, "co-b", "mara");
    expect(room(state, "vale")).toBe("co-c");
    expectNoBinding(state);
    expectNoBinding(state, "mara");
  });

  it("does not offer an invitation to a resident fixed by role", () => {
    const state = world();
    expect(offers(state, "co-oak", "co-b")).toBe(false);
    expect(asleepReason(state, ["co-oak", "co-b"])).toBe("The Post stays here");
  });

  it("allows an explicit trip for a range-zero resident who holds no post", () => {
    life.residents[ANN] = { range: 0 };
    try {
      const state = invite(world({ at: "co-b" }), ANN, "co-c");
      atBoth(state, ANN, "co-c");
    } finally {
      delete life.residents[ANN];
    }
  });

  it("does not offer an invitation to a guard at their post", () => {
    life.residents[BO] = { guards: "co-c" };
    try {
      const state = world({ at: "co-b" });
      expect(offers(state, BO, "co-a")).toBe(false);
      expect(asleepReason(state, [BO, "co-a"])).toBe("Bo stays here");
    } finally {
      delete life.residents[BO];
    }
  });
});

describe("escort requests and gates", () => {
  it("does not move a resident on learning or accepting their escort request", () => {
    let state = world();
    state.actors[ANN].want = {
      kind: "place",
      target: "co-c",
      since: state.turn,
      refusals: 0,
    };
    state = step(state, "talk", { target: ANN });
    atBoth(state, ANN, "co-a");
    state = step(state, "accept", { target: ANN });
    atBoth(state, ANN, "co-a");
    expect(state.actors.vale.want).toMatchObject({ from: `quest:from:${ANN}` });
    expectNoBinding(state);
    state = go(state, "co-b");
    expect(room(state, ANN)).toBe("co-a");
    state = go(state, "co-a");
    state = invite(state, ANN, "co-b");
    state = invite(state, ANN, "co-c");
    atBoth(state, ANN, "co-c");
    expect(state.actors.vale.want?.from).not.toBe(`quest:from:${ANN}`);
  });

  it("accepts a trip at zero trust when it fulfills the resident's want", () => {
    const start = world();
    start.actors[ANN].trust.vale = 0;
    start.actors[ANN].want = {
      kind: "place",
      target: "co-b",
      since: start.turn,
      refusals: 0,
    };
    const state = invite(start, ANN, "co-b");
    atBoth(state, ANN, "co-b");
    expect(invited(state).accepted).toBe(true);
    expect(state.actors[ANN].trust.vale).toBe(1);
    expectNoBinding(state);
  });

  it("does not use a nearby resident's key to unlock the traveler's solo move", () => {
    const state = invite(world(), ANN, "co-b");
    state.items["co-key"].holder = ANN;
    expect(
      legalActions(state).some(
        (action) => action.kind === "move" && action.target === "co-yard",
      ),
    ).toBe(false);
  });

  it("brings an invited resident through a gate the traveler can open", () => {
    const start = world({ at: "co-b" });
    start.items["co-key"].holder = "vale";
    const state = invite(start, ANN, "co-yard");
    atBoth(state, ANN, "co-yard");
    expect(state.items["co-key"].holder).toBe("vale");
  });
});

describe("trust and previous saves", () => {
  it("still gains trust when given a wanted item", () => {
    const start = world();
    start.actors[ANN].trust.vale = 0;
    start.actors[ANN].want = {
      kind: "item",
      target: "co-key",
      since: 0,
      refusals: 0,
    };
    start.items["co-key"].holder = "vale";
    const state = step(start, "give", { target: ANN, item: "co-key" });
    expect(state.actors[ANN].trust.vale).toBe(1);
  });

  it("keeps trust loss from threats and strikes", () => {
    let state = invite(world({ at: "co-b" }), ANN, "co-c");
    state.actors[ANN].trust.vale = 3;
    state = step(state, "threaten", { target: ANN, item: null });
    expect(state.actors[ANN].trust.vale).toBe(1);
    state = step(state, "attack", { target: ANN });
    expect(state.actors[ANN].trust.vale).toBe(0);
  });

  it("keeps the trust floor for an item-backed threat", () => {
    const start = invite(world({ at: "co-b" }), ANN, "co-c");
    start.items["co-key"].holder = ANN;
    const state = step(start, "threaten", { target: ANN, item: "co-key" });
    expect(state.actors[ANN].trust.vale).toBe(0);
  });

  it("lets an active grievance cause an ordinary invitation to be refused", () => {
    const start = world();
    start.actors[ANN].trust.vale = 3;
    start.motives.grievances[ANN].push({
      other: "vale",
      kind: "pestering",
      reason: "Vale annoyed her.",
      turn: start.turn,
      weight: 2,
      lastTouched: start.turn,
      repaired: false,
    });
    const state = invite(start, ANN, "co-b");
    atBoth(state, ANN, "co-a");
    expect(invited(state)).toMatchObject({ accepted: false, reason: "grudge" });
    expect(state.actors[ANN].trust.vale).toBe(3);
  });

  it("retires the old following fields while keeping position, custody and trust", () => {
    const old = world({ at: "co-b" });
    old.actors.vale.companion = ANN;
    old.actors.vale.actedAt = old.turn - 1;
    old.actors[ANN].dwellUntil = old.turn + 10;
    old.invitedPlaces = { [ANN]: ["co-b"] };
    old.items["co-key"].holder = ANN;
    const state = decodeSave(JSON.stringify(old));
    atBoth(state, ANN, "co-b");
    expectNoBinding(state);
    expect(state.actors[ANN].trust.vale).toBe(2);
    expect(state.items["co-key"].holder).toBe(ANN);
    expect(state.invitedPlaces).toEqual(old.invitedPlaces);
    expect(offers(state, ANN, "co-c")).toBe(true);
    expect(room(go(state, "co-c"), ANN)).toBe("co-b");
  });

  it("replays the same sequence of invitations and solo moves identically", () => {
    const run = () =>
      go(invite(invite(world(), ANN, "co-b"), ANN, "co-c"), "co-b");
    expect(run()).toEqual(run());
  });
});
