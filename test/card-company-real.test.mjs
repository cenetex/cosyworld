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
import { lifeHome } from "../v2/card-game/resident-home.mjs";
import { openGreekGate } from "./helpers/greek-gate.mjs";

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

  it("she goes with Vale through the Mirror attic and back, and is not stranded there", () => {
    let s = createWorld({ seed: 3 });
    s.turn = s.revision = 60;
    s.actors.vale.place = s.actors.whiskerwind.place = "forest-cottage";
    s.packs["lonely-forest"].met.whiskerwind = 0;
    s.actors.whiskerwind.trust.vale = 2;
    s = invite(s, "whiskerwind", "attic");
    expect(s.log.findLast((e) => e.verb === "accompany").accepted).toBe(true);
    expect(s.actors.whiskerwind.place).toBe("attic");
    expect(s.invitedPlaces.whiskerwind).toContain("attic");
    // Released in the attic, she walks home through the same door.
    s.actors.whiskerwind.trust.vale = 0;
    s = wait(s);
    expect(companionOf(s, "vale")).toBeNull();
    // The door home needs the lit lamp and the cloth in the attic: she waits,
    // alive, until it opens, and then goes home by herself.
    for (let i = 0; i < 6; i++) s = wait(s);
    expect(s.actors.whiskerwind.place).toBe("attic");
    expect(legalActions(s, "whiskerwind").some((a) => a.kind === "wait")).toBe(true);
    Object.assign(s.items.lamp, { holder: "attic", lit: true, fuel: 12, fuelRooms: 3, fuelPlace: "attic" });
    s.items.cloth.holder = "attic";
    for (let i = 0; i < 12; i++) s = wait(s);
    expect(s.actors.whiskerwind.place).toMatch(/^forest-/u);
  });

  it("a companion whose pack is switched off stays bound, and is back when it returns", () => {
    let s = createWorld({ seed: 3 });
    s.turn = s.revision = 60;
    s.actors.vale.place = s.actors.whiskerwind.place = "forest-cottage";
    s.packs["lonely-forest"].met.whiskerwind = 0;
    s.actors.whiskerwind.trust.vale = 2;
    s = invite(s, "whiskerwind", "forest-garden");
    // Vale leaves the forest for the hub, then the forest goes quiet.
    s.actors.vale.place = "pond";
    s = play(s, { kind: "pack", pack: "cottage", enable: false }, s.revision).state;
    s = act(s, "wait");
    expect(companionOf(s, "vale")).toBe("whiskerwind");
    s = play(s, { kind: "pack", pack: "cottage", enable: true }, s.revision).state;
    expect(companionOf(s, "vale")).toBe("whiskerwind");
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

  it("Antigone (range 0, no post) follows, and walks home to the gate when released", () => {
    let s = lifeWorld({ place: "greek-gate", turn: 60 });
    openGreekGate(s);
    s.actors["greek-antigone"].trust.vale = 2;
    s = invite(s, "greek-antigone", "greek-battlefield");
    expect(s.actors["greek-antigone"].place).toBe("greek-battlefield");
    s.actors["greek-antigone"].trust.vale = 0;
    for (let i = 0; i < 12; i++) s = wait(s);
    expect(companionOf(s, "vale")).toBeNull();
    // Range 0 and released away from home: the ordinary leash walks her home.
    expect(s.actors["greek-antigone"].place).toBe(
      lifeHome("greek-antigone", s),
    );
  });

  it("the Gate Guard is refused by his post, not his range", () => {
    const s = lifeWorld({ place: "greek-gate", turn: 60 });
    s.actors["greek-guard"].trust.vale = 3;
    expect(
      legalActions(s).some((a) => a.kind === "accompany" && a.target === "greek-guard"),
    ).toBe(false);
  });
});
