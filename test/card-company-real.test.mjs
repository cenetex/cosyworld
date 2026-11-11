import { describe, expect, it } from "vitest";
import {
  createWorld,
  legalActions,
  play,
  encodeSave,
  decodeSave,
} from "../v2/card-game/world.mjs";
import { companionOf } from "../v2/card-game/world/company.mjs";
import { act, lifeWorld, wait } from "./helpers/world-life.mjs";
import { sailTo } from "./helpers/voyage.mjs";

// A few checks on the shipping content, by real play. The rules are tested on
// a made-up world in card-company.test.mjs; these only prove the real packs
// give the bond what it needs.
const invite = (s, who, to) => act(s, "accompany", { target: who, destination: to });
const go = (s, to) =>
  act(s, "move", { target: to });

describe("sticky companions in the shipping content", () => {
  it("Whiskerwind follows through the forest and keeps her place past nightfall", () => {
    let s = createWorld({ seed: 3 });
    s.turn = s.revision = 60;
    s.actors.vale.place = s.actors.whiskerwind.place = "forest-cottage";
    s.packs["lonely-forest"].met.whiskerwind = 0;
    s.actors.whiskerwind.trust.vale = 2;
    s = invite(s, "whiskerwind", "forest-garden");
    s = go(s, "forest-cottage");
    s = go(s, "forest-garden");
    s = go(s, "forest-oak");
    // Her want was the oak: met on the way, and the bond holds.
    expect(s.actors.whiskerwind.place).toBe("forest-oak");
    expect(companionOf(s, "vale")).toBe("whiskerwind");
    for (let i = 0; i < 40; i++) s = act(s, "wait");
    expect(s.actors.whiskerwind.place).toBe("forest-oak");
    expect(s.actors.whiskerwind.sleeping).toBeUndefined();
    expect(decodeSave(encodeSave(s)).actors.vale.companion).toBe("whiskerwind");
  });

  it("she declines the Mirror attic, where she could not walk home", () => {
    let s = createWorld({ seed: 3 });
    s.turn = s.revision = 60;
    s.actors.vale.place = s.actors.whiskerwind.place = "forest-cottage";
    s.packs["lonely-forest"].met.whiskerwind = 0;
    s.actors.whiskerwind.trust.vale = 2;
    s = invite(s, "whiskerwind", "attic");
    expect(s.log.findLast((e) => e.verb === "accompany").accepted).toBe(false);
    expect(s.actors.whiskerwind.place).toBe("forest-cottage");
    expect(companionOf(s, "vale")).toBeNull();
  });

  it("Dione walks the Theban streets with Vale and does not go home at dusk", () => {
    let s = lifeWorld({ place: "greek-courtyard", turn: 60 });
    s.actors["greek-baker"].trust.vale = 2;
    s = invite(s, "greek-baker", "greek-well");
    s = go(s, "greek-palace");
    s = go(s, "greek-well");
    for (let i = 0; i < 36; i++) s = wait(s);
    expect(s.actors["greek-baker"].place).toBe("greek-well");
    expect(companionOf(s, "vale")).toBe("greek-baker");
  });

  it("Dione rides the Charybdis with Vale and lands where Vale lands", () => {
    let s = lifeWorld({ place: "greek-harbor", turn: 60 });
    s.actors["greek-baker"].place = "greek-harbor";
    s.actors["greek-baker"].trust.vale = 2;
    s.crossings["pond-greek-harbor"].discovered = true;
    s.transports["greek-ship"].dock = "greek-harbor";
    s = invite(s, "greek-baker", "greek-ship");
    expect(s.actors["greek-baker"].place).toBe("greek-ship");
    s = sailTo(s, "pond");
    expect(s.actors.vale.place).toBe("pond");
    expect(s.actors["greek-baker"].place).toBe("pond");
    expect(companionOf(s, "vale")).toBe("greek-baker");
  });
});
