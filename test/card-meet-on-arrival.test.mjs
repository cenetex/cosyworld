// Rules 101 (#2248): a resident who walks in at dawn or dusk is met on
// arrival, so the player can Talk with them on that same turn.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  createWorld,
  encodeSave,
  legalActions,
} from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { currentSharedEngine } from "./fixtures/shared-engine.mjs";
import { availableCards } from "../v2/card-game/cards.mjs";
import { knownActors } from "../v2/card-game/want.mjs";
import { DAY_TURNS } from "../v2/card-game/resident-home.mjs";
import { speechOccasions } from "../v2/card-game/narrative.mjs";
import { dialogueCast } from "../v2/card-game/scene-cast.mjs";
import { act, reload, wait } from "./helpers/world-life.mjs";

const ELDER = "greek-elder",
  BAKER = "greek-baker",
  COURT = "greek-courtyard";

// A local save past the opening on its second day: Vale in the courtyard
// has met the baker there but never the elder, who wants the courtyard.
function courtyard() {
  const s = createWorld({
    opening: true,
    seed: 7,
    packScopes: { "greek-drama": "full" },
  });
  s.turn = s.revision = DAY_TURNS + 20;
  s.actors.vale.place = COURT;
  s.opening.crossed = true;
  s.locations.attic.anchored = true;
  for (const id of [BAKER, "moth", "keeper"]) s.opening.met[id] = 0;
  s.packs["greek-drama"].met[BAKER] = 0;
  s.actors[ELDER].want = {
    kind: "place",
    target: COURT,
    since: s.turn,
    refusals: 0,
  };
  return reload(s);
}
const talkTo = (s, id) =>
  legalActions(s).some((a) => a.kind === "talk" && a.target === id);

describe("meeting a resident who arrives (rules 101)", () => {
  for (const [name, step] of [
    ["only Waits", (s) => act(s, "wait")],
    ["Talks with another", (s) => act(s, "talk", { target: BAKER })],
  ])
    it(`offers Talk the turn the elder arrives at dusk, after ${name}`, () => {
      let s = courtyard();
      expect(knownActors(s)).not.toContain(ELDER);
      while (s.actors[ELDER].place !== COURT) {
        expect(s.turn).toBeLessThan(DAY_TURNS + 24);
        s = step(s);
      }
      expect(s.turn).toBe(DAY_TURNS + 24); // dusk
      expect(availableCards(s)).toContain(ELDER);
      expect(knownActors(s)).toContain(ELDER);
      expect(s.opening.met[ELDER]).toBe(s.turn);
      expect(s.packs["greek-drama"].met[ELDER]).toBe(s.turn);
      expect(talkTo(s, ELDER)).toBe(true);
      expect(talkTo(reload(s), ELDER)).toBe(true);
      // The arrival is a first meeting, so the newcomer may speak.
      expect(speechOccasions(s, dialogueCast(s)).speakers).toContain(ELDER);
      s = act(s, "talk", { target: ELDER });
      expect(s.opening.met[ELDER]).toBe(DAY_TURNS + 24);
    });

  it("meets no one who arrives where the player is not", () => {
    let s = courtyard();
    s.actors.vale.place = "greek-harbor";
    s = wait(reload(s), 4);
    expect(s.actors[ELDER].place).toBe(COURT);
    expect(s.opening.met[ELDER]).toBeUndefined();
  });
});

// The shared host runs the minted bundle; it must meet the elder on arrival
// as the browser does, while rules 100 replays its journals unchanged.
describe("meeting on arrival on the server (rules 101)", () => {
  const seats = { claimed: ["vale"], present: ["vale"] };
  const host = (runtime) => (request) =>
    JSON.parse(runtime.cardShared(JSON.stringify(request)));
  const rules100 = () => {
    const dir = new URL(
      "../v2/orchestrator-rust/src/card_shared/",
      import.meta.url,
    );
    const runtime = vm.createContext({
      structuredClone,
      cardContent: JSON.parse(readFileSync(new URL("content.json", dir))),
    });
    vm.runInContext(
      readFileSync(new URL("engine-v100.js", dir), "utf8"),
      runtime,
    );
    return runtime;
  };
  function arrive(server) {
    const both = (request) => {
      const local = dispatchShared(structuredClone(request));
      if (server) expect(server(structuredClone(request))).toEqual(local);
      return local;
    };
    const save = encodeSave(courtyard());
    let world = both({ op: "create", seed: 7, save, actor: "vale" }).world;
    for (let i = 0; i < 6 && world.actors[ELDER].place !== COURT; i++) {
      const { actions } = both({ op: "view", world, actor: "vale", ...seats });
      const action = actions.find((a) => a.kind === "wait" && !a.sleep);
      const done = both({ op: "play", world, actor: "vale", action, ...seats });
      expect(done.ok, done.error).toBe(true);
      world = done.world;
    }
    return world;
  }
  it("commits the same meeting as the browser rules, and replays", () => {
    const world = arrive(host(currentSharedEngine()));
    expect(world.actors[ELDER].place).toBe(COURT);
    expect(world.packs["greek-drama"].met[ELDER]).toBe(world.turn);
    expect(arrive(null)).toEqual(world);
    // Rules 100 still plays as released: no meeting on arrival.
    const old = host(rules100());
    let w = old({
      op: "create",
      seed: 7,
      save: encodeSave(courtyard()),
      actor: "vale",
    }).world;
    for (let i = 0; i < 6 && w.actors[ELDER].place !== COURT; i++) {
      const { actions } = old({
        op: "view",
        world: w,
        actor: "vale",
        ...seats,
      });
      const action = actions.find((a) => a.kind === "wait" && !a.sleep);
      w = old({ op: "play", world: w, actor: "vale", action, ...seats }).world;
    }
    expect(w.actors[ELDER].place).toBe(COURT);
    expect(w.packs["greek-drama"].met[ELDER]).toBeUndefined();
  });
});
