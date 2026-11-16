import { describe, expect, it, vi } from "vitest";

const rite = vi.hoisted(() => ({
  id: "greek-test-rite",
  subject: "greek-baker",
  at: "greek-courtyard",
  label: "Hand Dione the cloth",
  text: "Dione folds the cloth away for good.",
  on: "give",
  requires: [{ kind: "holding", item: "cloth", role: "actor" }],
  effects: [{ kind: "retire_item", item: "cloth" }],
}));
vi.mock("../v2/card-game/packs.json", async (importOriginal) => {
  const compiled = structuredClone((await importOriginal()).default);
  const greek = compiled.packs.find((p) => p.id === "greek-drama");
  greek.choices.push(rite);
  greek.release.choices.push(rite.id);
  return { default: compiled };
});

import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  applyPackChoice,
  hub,
  neverBack,
  packDefinition,
  packDefinitions,
} from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import { DAYLIGHT_TURNS } from "../v2/card-game/pack-rules.mjs";

const pack = () => structuredClone(packDefinition("greek-drama"));
const last = (p) => p.choices.at(-1);
const problems = (change = () => {}) => {
  const p = pack();
  change(p);
  const places = packDefinitions.flatMap((d) => Object.keys(d.places));
  return packProblems(p, hub, places).join(" ");
};
function atCourtyard() {
  const s = createWorld();
  s.crossings["pond-greek-harbor"].discovered = true;
  s.actors.vale.place = s.actors["greek-baker"].place = "greek-courtyard";
  s.actors.vale.visited.push("pond", "greek-courtyard");
  s.items.cloth.holder = "vale";
  s.items.lamp.holder = "pond";
  return s;
}
const give = (s) =>
  legalActions(s).find((a) => a.kind === "give" && a.item === "cloth");

describe("a pack choice uses up a hub item", () => {
  it("lets holding, a lay step and retire_item name a hub item", () => {
    expect(problems()).toBe("");
    expect(
      problems((p) => {
        p.avatars["greek-baker"].want = {
          kind: "place",
          target: "greek-courtyard",
          step: { verb: "lay", items: ["cloth"] },
        };
        p.choices[0].requires.push({
          kind: "holding",
          item: "cloth",
          actor: "vale",
        });
      }),
    ).toBe("");
    expect(
      problems((p) => (last(p).effects[0].waitAtHome = true)),
    ).toMatch(/greek-test-rite effect/);
    for (const item of ["missing", "greek-baker"]) {
      expect(
        problems((p) => (last(p).effects[0].item = item)),
      ).toMatch(/greek-test-rite effect/);
      expect(
        problems((p) => (last(p).requires[0].item = item)),
      ).toMatch(/condition/);
    }
  });

  it("takes the item out of the world for good", () => {
    const before = atCourtyard();
    const result = play(before, give(before), before.revision);
    expect(result.ok, result.error).toBe(true);
    let s = result.state;
    expect(s.packs["greek-drama"].receipts[rite.id]).toBe(s.turn);
    expect(s.gone).toEqual(["cloth"]);
    expect(s.usedUp).toContain("cloth");
    expect(neverBack(s, "cloth")).toBe(true);
    expect(decodeSave(encodeSave(s))).toEqual(s);
    for (let turn = 0; turn < 2 * DAYLIGHT_TURNS + 2; turn++) {
      const wait = legalActions(s).find((a) => a.kind === "wait" && !a.sleep);
      s = play(s, wait, s.revision).state;
      expect(legalActions(s).filter((a) => a.item === "cloth")).toEqual([]);
    }
    expect(s.gone).toEqual(["cloth"]);
    expect(s.items.cloth.holder).toBe("pond");
  });

  it("uses nothing up when the play is refused", () => {
    const s = atCourtyard();
    const saved = encodeSave(s);
    expect(play(s, give(s), s.revision - 1).ok).toBe(false);
    s.items.cloth.holder = "greek-baker";
    const held = encodeSave(s);
    expect(() =>
      applyPackChoice(
        s,
        { packId: "greek-drama", choiceId: rite.id, actor: "vale" },
        { mode: "give" },
      ),
    ).toThrow(/no longer available/);
    expect(encodeSave(s)).toBe(held);
    s.items.cloth.holder = "vale";
    expect(encodeSave(s)).toBe(saved);
    expect(s.gone).toBeUndefined();
  });
});
