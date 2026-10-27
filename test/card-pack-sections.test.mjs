import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  entityActive,
  hub,
  packDefinition,
  packDefinitions,
  packExits,
  validatePackStates,
} from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import { sectionAllows } from "../v2/card-game/pack-sections.mjs";
import { openingFixture } from "./helpers/greek-opening.mjs";

const pack = packDefinition("greek-drama");
const section = () => ({
  id: "test-open-door",
  name: "The Open Door",
  places: ["greek-athens", "greek-piraeus", "greek-colonus"],
  requires: [{ kind: "flag", key: "greek-water-returned", value: true }],
});
const original = structuredClone({
  sections: pack.sections,
  release: pack.release,
  routes: pack.routes,
});
const act = (world, kind, fields = {}) => {
  const action = legalActions(world).find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  expect(action).toBeTruthy();
  const result = play(world, action, world.revision);
  expect(result.ok, result.error).toBe(true);
  return result.state;
};

describe("permanent pack sections", () => {
  beforeEach(() => {
    pack.sections = [section()];
    pack.release = Object.fromEntries(
      ["places", "avatars", "items"].map((kind) => [
        kind,
        Object.keys(pack[kind]),
      ]),
    );
    pack.release.choices = pack.choices.map((choice) => choice.id);
  });
  afterEach(() => {
    if (original.sections === undefined) delete pack.sections;
    else pack.sections = structuredClone(original.sections);
    pack.release = structuredClone(original.release);
    pack.routes = structuredClone(original.routes);
  });

  it("checks static roads and conditional routes for every traveler", () => {
    const before = openingFixture("refusal").waterOffer;
    pack.routes.push({ from: "greek-harbor", to: "greek-piraeus" });
    for (const actor of ["vale", "mara", "greek-shipmaster"]) {
      expect(exits(before, "greek-harbor", actor)).not.toContain(
        "greek-athens",
      );
      expect(packExits(before, "greek-harbor", actor)).not.toContain(
        "greek-piraeus",
      );
    }
    expect(entityActive(before, "greek-market-neighbor")).toBe(false);
    const opened = act(before, "choose", {
      choiceId: "greek-return-water-jar",
    });
    for (const actor of ["vale", "mara", "greek-shipmaster"]) {
      expect(exits(opened, "greek-harbor", actor)).toContain("greek-athens");
      expect(packExits(opened, "greek-harbor", actor)).toContain(
        "greek-piraeus",
      );
    }
    expect(entityActive(opened, "greek-market-neighbor")).toBe(true);
    const loaded = decodeSave(encodeSave(opened));
    expect(exits(loaded, "greek-harbor", "vale")).toContain("greek-athens");
  });

  it("checks section access before applying a choice and while replaying receipts", () => {
    const before = openingFixture("refusal").waterOffer;
    let world = act(before, "choose", { choiceId: "greek-return-water-jar" });
    world = act(world, "move", { target: "greek-harbor" });
    world = act(world, "move", { target: "greek-athens" });
    world = act(world, "move", { target: "greek-colonus" });
    const action = legalActions(world).find(
      (a) => a.kind === "choose" && a.choiceId.startsWith("greek-inquire-"),
    );
    expect(action).toBeTruthy();
    const closed = structuredClone(before);
    closed.actors.vale.place = "greek-colonus";
    expect(play(closed, action, closed.revision).ok).toBe(false);
    expect(() => decodeSave(JSON.stringify(closed))).toThrow();
    const result = play(world, action, world.revision);
    expect(result.ok, result.error).toBe(true);
    expect(validatePackStates(result.state)).toBe(true);
    const forged = structuredClone(result.state);
    const receipts = forged.packs[pack.id].receipts;
    [receipts[action.choiceId], receipts["greek-return-water-jar"]] = [
      receipts["greek-return-water-jar"],
      receipts[action.choiceId],
    ];
    expect(validatePackStates(forged)).toBe(false);
  });

  it("keeps full-scope roads while preserving the chosen account", () => {
    const world = createWorld({ packScopes: { "greek-drama": "full" } });
    expect(exits(world, "greek-harbor", "vale")).toContain("greek-athens");
    expect(entityActive(world, "greek-egypt-tomb")).toBe(false);
    expect(entityActive(world, "greek-helen-egypt")).toBe(false);
    expect(decodeSave(encodeSave(world))).toEqual(world);
  });

  it("ties cast, objects, and fixtures to their authored section", () => {
    const definition = {
      id: "island",
      places: { quay: {}, court: {} },
      avatars: { host: { place: "court" } },
      items: { letter: { holder: "host" }, cup: { holder: "court" } },
      fixtures: { bell: { at: "court" } },
      sections: [{ places: ["court"], requires: [] }],
    };
    const world = { packs: { island: { scope: "opening" } } };
    for (const id of ["court", "host", "letter", "cup", "bell"])
      expect(sectionAllows(world, definition, id, () => false)).toBe(false);
    expect(sectionAllows(world, definition, "quay", () => false)).toBe(true);
  });

  it("validates section references and permanent access", () => {
    const validate = (candidate) =>
      packProblems(
        candidate,
        hub,
        packDefinitions.flatMap((p) => Object.keys(p.places)),
      );
    expect(validate(pack)).toEqual([]);
    const cases = [
      (p) => p.sections.push({ ...section(), id: "duplicate-place" }),
      (p) => (p.sections[0].places = ["unknown-place"]),
      (p) => (p.sections[0].requires[0].key = "unwritten-flag"),
      (p) => (p.sections[0].requires[0].value = false),
      (p) => (p.sections[0].requires = [{ kind: "met", actor: "greek-baker" }]),
      (p) =>
        p.choices[0].effects.push({
          kind: "set_flag",
          key: "greek-water-returned",
          value: false,
        }),
    ];
    for (const change of cases) {
      const invalid = structuredClone(pack);
      change(invalid);
      expect(validate(invalid).length).toBeGreaterThan(0);
    }
  });
});
