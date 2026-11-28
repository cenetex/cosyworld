import { describe, expect, it, vi } from "vitest";

const rites = vi.hoisted(() =>
  [
    ["greek-burial-petition", true],
    ["greek-wine-skin", undefined],
  ].map(([item, forGood]) => ({
    id: `greek-test-keep-${item}`,
    subject: "greek-baker",
    at: "greek-courtyard",
    label: "Hand it to Dione",
    text: "Dione puts it away.",
    on: "give",
    requires: [{ kind: "holding", item, role: "actor" }],
    effects: [{ kind: "retire_item", item, ...(forGood && { forGood }) }],
  })),
);
vi.mock("../v2/card-game/packs.json", async (importOriginal) => {
  const compiled = structuredClone((await importOriginal()).default);
  const greek = compiled.packs.find((p) => p.id === "greek-drama");
  greek.choices.push(...rites);
  greek.release.choices.push(...rites.map((r) => r.id));
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
import { packProblems, packWarnings } from "../v2/card-game/pack-schema.mjs";
import { DAYLIGHT_TURNS } from "../v2/card-game/pack-rules.mjs";

const PETITION = "greek-burial-petition",
  WINE = "greek-wine-skin";
const edited = (change = () => {}) => {
  const p = structuredClone(packDefinition("greek-drama"));
  change(p);
  return p;
};
const problems = (change) =>
  packProblems(
    edited(change),
    hub,
    packDefinitions.flatMap((d) => Object.keys(d.places)),
  ).join(" ");
const effect = (p, id) => p.choices.find((c) => c.id === id).effects;
function atCourtyard() {
  const s = createWorld();
  s.crossings["pond-greek-harbor"].discovered = true;
  s.actors.vale.place = s.actors["greek-baker"].place = "greek-courtyard";
  s.actors.vale.visited.push("pond", "greek-courtyard");
  for (const id of [PETITION, WINE]) s.items[id].holder = "vale";
  for (const id of ["lamp", "cloth"]) s.items[id].holder = "pond";
  return s;
}
const give = (s, item) =>
  legalActions(s).find((a) => a.kind === "give" && a.item === item);
function given(s, item) {
  const result = play(s, give(s, item), s.revision);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}

describe("a retire_item marked forGood", () => {
  it("is accepted, refused with waitAtHome, and warns of a lock it closes", () => {
    expect(problems()).toBe("");
    const withoutRites = edited((p) => {
      p.choices = p.choices.filter((c) => !rites.some((r) => r.id === c.id));
    });
    expect(packWarnings(edited())).toEqual(packWarnings(withoutRites));
    expect(
      problems((p) => (effect(p, rites[0].id)[0].waitAtHome = true)),
    ).toMatch(/greek-test-keep-greek-burial-petition effect/);
    expect(
      problems((p) => (effect(p, rites[0].id)[0].forGood = false)),
    ).toMatch(/greek-test-keep-greek-burial-petition effect/);
    const passage = (p) => {
      p.items["greek-provisions"].tags = ["food"];
      effect(p, "greek-helen-egypt-passage").find(
        (e) => e.kind === "retire_item",
      ).forGood = true;
    };
    expect(problems(passage)).toBe("");
    const warnings = packWarnings(edited(passage)).join(" ");
    expect(warnings).toMatch(
      /greek-helen-egypt-passage uses up greek-provisions for good, which closes greek-helen-troy-passage/,
    );
    expect(warnings).toMatch(/closes greek-harbor>greek-piraeus/);
  });

  it("puts a homed pack item in world.gone, through reload and two dawns", () => {
    let s = given(atCourtyard(), PETITION);
    expect(s.gone).toEqual([PETITION]);
    expect(s.usedUp).toContain(PETITION);
    expect(neverBack(s, PETITION)).toBe(true);
    expect(decodeSave(encodeSave(s))).toEqual(s);
    for (let turn = 0; turn < 2 * DAYLIGHT_TURNS + 2; turn++) {
      const wait = legalActions(s).find((a) => a.kind === "wait" && !a.sleep);
      s = decodeSave(encodeSave(play(s, wait, s.revision).state));
      expect(legalActions(s).filter((a) => a.item === PETITION)).toEqual([]);
    }
    expect(s.gone).toEqual([PETITION]);
    expect(s.items[PETITION]).toEqual({ holder: "greek-eleusis", history: [] });
  });

  it("still sends the thing home when the use is not marked", () => {
    const s = given(atCourtyard(), WINE);
    expect(s.gone).toBeUndefined();
    expect(s.usedUp).not.toContain(WINE);
    expect(s.items[WINE].holder).toBe("greek-gate");
    expect(neverBack(s, WINE)).toBe(false);
  });

  it("uses nothing up when the play is refused", () => {
    const s = atCourtyard();
    const saved = encodeSave(s);
    expect(play(s, give(s, PETITION), s.revision - 1).ok).toBe(false);
    s.items[PETITION].holder = "greek-baker";
    const held = encodeSave(s);
    expect(() =>
      applyPackChoice(
        s,
        { packId: "greek-drama", choiceId: rites[0].id, actor: "vale" },
        { mode: "give" },
      ),
    ).toThrow(/no longer available/);
    expect(encodeSave(s)).toBe(held);
    s.items[PETITION].holder = "vale";
    expect(encodeSave(s)).toBe(saved);
  });
});
