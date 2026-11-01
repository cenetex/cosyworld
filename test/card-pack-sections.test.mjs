import { needsVoyage, sailTo } from "./helpers/voyage.mjs";
import { greekTravelTargets } from "./helpers/greek-travel.mjs";
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
  choices: pack.choices,
});
const act = (world, kind, fields = {}) => {
  if (kind === "move") {
    const steps = greekTravelTargets(world.actors.vale.place, fields.target);
    if (steps.length > 1)
      return steps.reduce((w, target) => act(w, "move", { target }), world);
    if (needsVoyage(world, "vale", fields.target))
      return sailTo(world, fields.target);
    if (fields.target === "greek-ship")
      for (
        let n = 0;
        n < 32 &&
        !legalActions(world).some(
          (a) => a.kind === "move" && a.target === fields.target,
        );
        n++
      )
        world = act(world, "wait");
  }
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
    pack.choices = structuredClone(original.choices);
  });

  it("checks static roads and conditional routes for every traveler", () => {
    const before = openingFixture("exposure").waterOffer;
    pack.routes.push({ from: "greek-harbor", to: "greek-piraeus" });
    for (const actor of ["vale", "mara", "greek-shipmaster"]) {
      expect(exits(before, "greek-road-athens-piraeus", actor)).not.toContain(
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
      expect(exits(opened, "greek-road-athens-piraeus", actor)).toContain(
        "greek-athens",
      );
      expect(packExits(opened, "greek-harbor", actor)).toContain(
        "greek-piraeus",
      );
    }
    expect(entityActive(opened, "greek-market-neighbor")).toBe(true);
    const loaded = decodeSave(encodeSave(opened));
    expect(exits(loaded, "greek-road-athens-piraeus", "vale")).toContain(
      "greek-athens",
    );
  });

  it("checks section access before applying a choice and while replaying receipts", () => {
    const before = openingFixture("exposure").waterOffer;
    const question = {
      id: "test-colonus-question",
      subject: "greek-colonus",
      at: "greek-colonus",
      label: "Ask about the grove",
      text: "Vale asks about the grove.",
      requires: [],
      effects: [{ kind: "set_flag", key: "test-colonus-asked", value: true }],
    };
    pack.choices.push(question);
    pack.release.choices.push(question.id);
    let world = act(before, "choose", { choiceId: "greek-return-water-jar" });
    world = act(world, "move", { target: "greek-harbor" });
    world = act(world, "move", { target: "greek-athens" });
    world = act(world, "move", { target: "greek-colonus" });
    const action = legalActions(world).find(
      (a) => a.kind === "choose" && a.choiceId === question.id,
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

  it("checks a transport's destination before offering boarding", () => {
    pack.sections[0].places = ["greek-harbor"];
    const world = createWorld();
    world.actors.vale.place = "pond";
    world.crossings["pond-greek-harbor"].discovered = true;
    world.transports["greek-ship"].dock = "pond";
    world.invitedPlaces = { vale: ["greek-harbor"] };
    expect(exits(world, "pond", "vale")).not.toContain("greek-ship");
    expect(
      legalActions(world).some((action) => action.target === "greek-ship"),
    ).toBe(false);
    const full = createWorld({ packScopes: { "greek-drama": "full" } });
    full.actors.vale.place = "pond";
    full.crossings["pond-greek-harbor"].discovered = true;
    full.transports["greek-ship"].dock = "pond";
    expect(exits(full, "pond", "vale")).toContain("greek-ship");
  });

  it("keeps full-scope roads while preserving the chosen account", () => {
    const world = createWorld({ packScopes: { "greek-drama": "full" } });
    expect(exits(world, "greek-road-athens-harbor", "vale")).toContain(
      "greek-athens",
    );
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
