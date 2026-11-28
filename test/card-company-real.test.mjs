import { describe, expect, it } from "vitest";
import {
  createWorld,
  legalActions,
  play,
  encodeSave,
  decodeSave,
} from "../v2/card-game/world.mjs";
import { act, lifeWorld, wait } from "./helpers/world-life.mjs";
import { sailTo } from "./helpers/voyage.mjs";
import { homeOf } from "../v2/card-game/resident-home.mjs";
import { openGreekGate } from "./helpers/greek-gate.mjs";

const invite = (state, who, to) =>
  act(state, "accompany", { target: who, destination: to });
const go = (state, to) => act(state, "move", { target: to });

function forestWorld() {
  const state = createWorld({ seed: 3 });
  state.turn = state.revision = 60;
  state.actors.vale.place = state.actors.whiskerwind.place = "forest-cottage";
  state.packs["lonely-forest"].met.whiskerwind = 0;
  state.actors.whiskerwind.trust.vale = 2;
  return state;
}

describe("explicit invitations in the shipping content", () => {
  it("brings Whiskerwind to the oak through two separate invitations", () => {
    let state = invite(forestWorld(), "whiskerwind", "forest-garden");
    state = go(state, "forest-cottage");
    expect(state.actors.whiskerwind.place).toBe("forest-garden");
    state = go(state, "forest-garden");
    state = invite(state, "whiskerwind", "forest-oak");
    expect(state.actors.vale.place).toBe("forest-oak");
    expect(state.actors.whiskerwind.place).toBe("forest-oak");
    const trips = state.log.filter(
      (entry) =>
        entry.verb === "accompany" &&
        entry.targetId === "whiskerwind" &&
        entry.accepted,
    );
    expect(trips.map((entry) => entry.destinationId)).toEqual([
      "forest-garden",
      "forest-oak",
    ]);
    expect(decodeSave(encodeSave(state))).toEqual(state);
  });

  it("lets Whiskerwind visit the Mirror attic on the invited leg", () => {
    const state = invite(forestWorld(), "whiskerwind", "attic");
    expect(
      state.log.findLast((entry) => entry.verb === "accompany").accepted,
    ).toBe(true);
    expect(state.actors.whiskerwind.place).toBe("attic");
    expect(state.invitedPlaces.whiskerwind).toEqual(["attic"]);
    expect(
      legalActions(state, "whiskerwind").some(
        (action) => action.kind === "wait",
      ),
    ).toBe(true);
    expect(decodeSave(encodeSave(state))).toEqual(state);
  });

  it("keeps an earlier trip and earned trust when a pack is switched off and on", () => {
    let state = invite(forestWorld(), "whiskerwind", "forest-garden");
    state.actors.vale.place = "pond";
    state = play(
      state,
      { kind: "pack", pack: "cottage", enable: false },
      state.revision,
    ).state;
    state = wait(state);
    state = play(
      state,
      { kind: "pack", pack: "cottage", enable: true },
      state.revision,
    ).state;
    expect(state.actors.whiskerwind.place).toBe("forest-garden");
    expect(state.actors.whiskerwind.trust.vale).toBe(2);
    expect(state.actors.vale.companion).toBeUndefined();
  });

  it("leaves Dione at the well when Vale goes to the palace", () => {
    const start = lifeWorld({ place: "greek-courtyard", turn: 60 });
    start.actors["greek-baker"].trust.vale = 2;
    const state = go(
      invite(start, "greek-baker", "greek-well"),
      "greek-palace",
    );
    expect(state.actors.vale.place).toBe("greek-palace");
    expect(state.actors["greek-baker"].place).toBe("greek-well");
  });

  it("boards the Charybdis and invites Dione ashore after the voyage", () => {
    let state = lifeWorld({ place: "greek-harbor", turn: 60 });
    state.actors["greek-baker"].place = "greek-harbor";
    state.actors["greek-baker"].trust.vale = 2;
    state.crossings["pond-greek-harbor"].discovered = true;
    state.transports["greek-ship"].dock = "greek-harbor";
    state = invite(state, "greek-baker", "greek-ship");
    expect(state.actors["greek-baker"].place).toBe("greek-ship");
    state = sailTo(state, "pond", {
      step: (world, action) =>
        action.kind === "move"
          ? invite(world, "greek-baker", action.target)
          : play(world, action, world.revision, action.actor).state,
    });
    expect(state.actors.vale.place).toBe("pond");
    expect(state.actors["greek-baker"].place).toBe("pond");
    expect(
      state.log.findLast((entry) => entry.verb === "accompany"),
    ).toMatchObject({
      targetId: "greek-baker",
      destinationId: "pond",
      accepted: true,
    });
  });

  it("allows Antigone to visit the battlefield while the gate guard holds his post", () => {
    let state = lifeWorld({ place: "greek-gate", turn: 60 });
    openGreekGate(state);
    state.actors["greek-antigone"].trust.vale = 2;
    state.actors["greek-guard"].trust.vale = 3;
    expect(
      legalActions(state).some(
        (action) =>
          action.kind === "accompany" && action.target === "greek-guard",
      ),
    ).toBe(false);
    state = invite(state, "greek-antigone", "greek-battlefield");
    expect(state.actors["greek-antigone"].place).toBe("greek-battlefield");
    expect(homeOf("greek-antigone", state)).toBe("greek-polynices-hollow");
  });
});
