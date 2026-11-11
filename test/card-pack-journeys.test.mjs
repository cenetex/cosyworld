import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  accompanyDecision,
  createWorld,
  decodeSave,
  encodeSave,
  itemPlace,
  legalActions,
  plan,
  play,
} from "../v2/card-game/world.mjs";
import {
  hub,
  packDefinition,
  packDefinitions,
  packPeople,
  packJourneyDestination,
  validatePackStates,
} from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";

const pack = packDefinition("greek-drama");
const resident = "greek-baker";
const agreement = "test-journey-agree";
const arrival = "test-journey-arrive";
const path = [
  "greek-courtyard",
  "greek-road-thebes",
  "greek-harbor",
  "greek-argolid-road",
];
const original = structuredClone({
  avatar: pack.avatars[resident],
  person: packPeople[resident],
  choices: pack.choices,
  release: pack.release,
  sections: pack.sections,
});
const mountedPlaces = packDefinitions.flatMap((p) => Object.keys(p.places));

function act(world, kind, fields = {}) {
  const action = legalActions(world).find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  expect(action, JSON.stringify(fields)).toBeDefined();
  const result = play(world, action);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}
function fixture(scope = "full") {
  const world = createWorld({ opening: false });
  world.packs[pack.id].scope = scope;
  world.actors.vale.place = path[0];
  return world;
}
const accompany = (world) =>
  legalActions(world).filter(
    (a) => a.kind === "accompany" && a.target === resident,
  );

describe("agreed resident journeys", () => {
  beforeEach(() => {
    const journey = { after: agreement, path: [...path] };
    Object.assign(pack.avatars[resident], { travels: false, journey });
    Object.assign(packPeople[resident], { travels: false, journey });
    for (const [id, at, requires, flag] of [
      [agreement, path[0], [], "test-journey-agreed"],
      [
        arrival,
        path.at(-1),
        [{ kind: "flag", key: "test-journey-agreed", value: true }],
        "test-journey-arrived",
      ],
    ])
      pack.choices.push({
        id,
        at,
        subject: resident,
        on: "wait",
        label: "Share this journey",
        text: "Dione agrees to this journey.",
        requires,
        effects: [{ kind: "set_flag", key: flag, value: true }],
      });
    pack.release.choices.push(agreement, arrival);
    pack.release.places.push("greek-argolid-road");
  });
  afterEach(() => {
    pack.avatars[resident] = structuredClone(original.avatar);
    Object.keys(packPeople[resident]).forEach(
      (key) => delete packPeople[resident][key],
    );
    Object.assign(packPeople[resident], structuredClone(original.person));
    pack.choices = structuredClone(original.choices);
    pack.release = structuredClone(original.release);
    pack.sections = structuredClone(original.sections);
  });

  it("keeps consent and each agreed road before accepting company", () => {
    let world = fixture();
    world.actors[resident].trust.vale = 1;
    expect(accompany(world)).toEqual([]);
    expect(legalActions(world, resident).some((a) => a.kind === "move")).toBe(
      false,
    );
    expect(accompanyDecision(world, "vale", resident, path[1]).accepted).toBe(
      false,
    );
    world = act(world, "wait");
    expect(accompany(world).map((a) => a.destination)).toEqual([path[1]]);
    expect(
      accompanyDecision(world, "greek-guard", resident, path[1]).accepted,
    ).toBe(false);
    expect(
      accompanyDecision(world, "vale", resident, "greek-well").accepted,
    ).toBe(false);
    expect(legalActions(world).some((a) => a.choiceId === agreement)).toBe(
      false,
    );
  });

  it("saves every actual step, carries the resident's belongings, and keeps the arrival", () => {
    let world = fixture();
    world.items["greek-water-jar"].holder = resident;
    world.items["greek-water-jar"].history = ["Kept for the journey."];
    world = act(world, "wait");
    expect(legalActions(world).some((a) => a.choiceId === arrival)).toBe(false);
    const first = accompany(world)[0];
    for (const destination of path.slice(1)) {
      world = act(world, "accompany", { target: resident, destination });
      expect(world.actors[resident].place).toBe(destination);
      expect(world.journeyProgress[resident]).toEqual({
        agreement,
        step: path.indexOf(destination),
      });
      expect(world.actors.vale.place).toBe(destination);
      expect(world.items["greek-water-jar"].holder).toBe(resident);
      expect(world.items["greek-water-jar"].history[0]).toBe(
        "Kept for the journey.",
      );
      expect(itemPlace(world, "greek-water-jar")).toBe(destination);
      // The resident may talk, but never walks off the agreed road.
      expect(["move", "course", "accompany"]).not.toContain(
        plan(world, resident).action.kind,
      );
      expect(legalActions(world, resident).some((a) => a.kind === "move")).toBe(
        false,
      );
      world = decodeSave(encodeSave(world));
      expect(world.actors[resident].place).toBe(destination);
    }
    expect(play(world, first).ok).toBe(false);
    world = act(world, "wait");
    expect(world.packs[pack.id].flags["test-journey-arrived"]).toBe(true);
    expect(legalActions(world).some((a) => a.choiceId === arrival)).toBe(false);
    expect(accompany(world)).toEqual([]);
    world = act(world, "move", { target: "greek-harbor" });
    expect(world.actors[resident].place).toBe("greek-argolid-road");
    expect(decodeSave(encodeSave(world)).actors[resident].place).toBe(
      "greek-argolid-road",
    );
  });

  it("waits at a closed section and requires the resident for the arrival choice", () => {
    pack.sections.push({
      id: "test-harbor",
      name: "Harbor",
      places: [path[1]],
      requires: [{ kind: "flag", key: "greek-open-door-open", value: true }],
    });
    let world = act(fixture("opening"), "wait");
    expect(accompany(world)).toEqual([]);
    expect(world.actors[resident].place).toBe("greek-courtyard");
    const together = act(fixture(), "wait");
    together.actors.vale.place = "greek-piraeus";
    expect(legalActions(together).some((a) => a.choiceId === arrival)).toBe(
      false,
    );
  });

  it("keeps an agreed waypoint through a visit and a real return trip", () => {
    let world = act(fixture(), "wait");
    for (const id of ["vale", resident]) world.actors[id].place = "greek-well";
    world = decodeSave(encodeSave(world));
    expect(world.journeyProgress[resident]).toEqual({ agreement, step: 0 });
    expect(packJourneyDestination(world, resident)).toBe(path[0]);
    world = act(world, "accompany", { target: resident, destination: path[0] });
    expect(world.journeyProgress[resident].step).toBe(0);
    world = act(world, "accompany", { target: resident, destination: path[1] });
    expect(world.journeyProgress[resident].step).toBe(1);
    for (const id of ["vale", resident]) world.actors[id].place = path.at(-1);
    expect(legalActions(world).some((a) => a.choiceId === arrival)).toBe(false);
    expect(decodeSave(encodeSave(world)).journeyProgress[resident].step).toBe(
      1,
    );
  });

  it("derives an older save's agreed step once", () => {
    const world = act(fixture(), "wait");
    world.actors[resident].place = path[2];
    delete world.journeyProgress;
    const loaded = decodeSave(JSON.stringify(world));
    expect(loaded.journeyProgress[resident]).toEqual({ agreement, step: 2 });
    loaded.actors[resident].place = "greek-well";
    expect(decodeSave(encodeSave(loaded)).journeyProgress).toEqual(
      loaded.journeyProgress,
    );
  });

  it("validates saved progress and authored consent, route, and resident boundaries", () => {
    expect(packProblems(pack, hub, mountedPlaces)).toEqual([]);
    const world = fixture();
    world.actors[resident].place = "greek-harbor";
    expect(validatePackStates(world)).toBe(true);
    const accepted = act(fixture(), "wait");
    accepted.actors[resident].place = "greek-well";
    expect(validatePackStates(accepted)).toBe(true);
    for (const progress of [
      null,
      [],
      { agreement, step: -1 },
      { agreement, step: path.length },
      { agreement: "another", step: 0 },
      { agreement, step: 0, extra: true },
    ]) {
      const bad = structuredClone(accepted);
      bad.journeyProgress[resident] = progress;
      expect(validatePackStates(bad)).toBe(false);
    }
    for (const change of [
      (p) => {
        p.avatars[resident].journey.after = "unknown-agreement";
      },
      (p) => {
        p.avatars[resident].journey.path = [path[0], "greek-piraeus"];
      },
      (p) => {
        p.avatars[resident].journey.path.push(path[0]);
      },
      (p) => {
        delete p.avatars[resident].travels;
      },
      (p) => {
        p.choices.find((c) => c.id === agreement).subject = "greek-elder";
      },
    ]) {
      const bad = structuredClone(pack);
      change(bad);
      expect(
        packProblems(bad, hub).some((p) => p.includes("journey needs consent")),
      ).toBe(true);
    }
    const humanHub = { ...hub, avatars: [...hub.avatars, resident] };
    expect(
      packProblems(pack, humanHub).some((p) =>
        p.includes("journey needs consent"),
      ),
    ).toBe(true);
  });
});
