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
  validatePackStates,
} from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";

const pack = packDefinition("greek-drama");
const resident = "greek-baker";
const agreement = "test-journey-agree";
const arrival = "test-journey-arrive";
const path = ["greek-courtyard", "greek-harbor", "greek-argolid-road"];
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
function alternateJourney() {
  const key = "test-journey-route";
  const alternate = "test-journey-agree-well";
  const first = pack.choices.find((choice) => choice.id === agreement);
  first.effects.push({ kind: "choose", key, value: "harbor" });
  pack.choices.push({
    id: alternate,
    at: path[0],
    subject: resident,
    label: "Choose the well journey",
    text: "Dione agrees to visit the well.",
    requires: [],
    effects: [
      { kind: "set_flag", key: "test-journey-agreed", value: true },
      { kind: "choose", key, value: "well" },
    ],
  });
  pack.release.choices.push(alternate);
  const options = [
    { after: agreement, path: [...path] },
    { after: alternate, path: [path[0], "greek-well"] },
  ];
  pack.avatars[resident].journey = options;
  packPeople[resident].journey = options;
  return { alternate, options, key };
}
function independentSail() {
  const journey = {
    after: agreement,
    path: [
      "greek-courtyard",
      "greek-harbor",
      "greek-ship",
      "greek-athens-harbor",
    ],
    independent: true,
  };
  pack.avatars[resident].journey = journey;
  packPeople[resident].journey = journey;
  const world = fixture();
  world.crossings["pond-greek-harbor"].discovered = true;
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
        label: "Share this journey",
        text: "Dione agrees to this journey.",
        requires,
        effects: [{ kind: "set_flag", key: flag, value: true }],
      });
    pack.release.choices.push(agreement, arrival);
    if (!pack.release.places.includes("greek-argolid-road"))
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
    world = act(world, "choose", { choiceId: agreement });
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
    world = act(world, "choose", { choiceId: agreement });
    expect(legalActions(world).some((a) => a.choiceId === arrival)).toBe(false);
    const first = accompany(world)[0];
    for (const destination of path.slice(1)) {
      world = act(world, "accompany", { target: resident, destination });
      expect(world.actors[resident].place).toBe(destination);
      expect(world.actors.vale.place).toBe(destination);
      expect(world.items["greek-water-jar"].holder).toBe(resident);
      expect(world.items["greek-water-jar"].history[0]).toBe(
        "Kept for the journey.",
      );
      expect(itemPlace(world, "greek-water-jar")).toBe(destination);
      expect(plan(world, resident).action.kind).toBe("wait");
      expect(legalActions(world, resident).some((a) => a.kind === "move")).toBe(
        false,
      );
      world = decodeSave(encodeSave(world));
      expect(world.actors[resident].place).toBe(destination);
    }
    expect(play(world, first).ok).toBe(false);
    world = act(world, "choose", { choiceId: arrival });
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
      places: ["greek-harbor"],
      requires: [{ kind: "flag", key: "greek-open-door-open", value: true }],
    });
    let world = act(fixture("opening"), "choose", { choiceId: agreement });
    expect(accompany(world)).toEqual([]);
    expect(world.actors[resident].place).toBe("greek-courtyard");
    const together = act(fixture(), "choose", { choiceId: agreement });
    together.actors.vale.place = "greek-piraeus";
    expect(legalActions(together).some((a) => a.choiceId === arrival)).toBe(
      false,
    );
  });

  it("validates saved journey places and authored consent, route, and resident boundaries", () => {
    expect(packProblems(pack, hub, mountedPlaces)).toEqual([]);
    const world = fixture();
    world.actors[resident].place = "greek-harbor";
    expect(validatePackStates(world)).toBe(false);
    const accepted = act(fixture(), "choose", { choiceId: agreement });
    accepted.actors[resident].place = "greek-well";
    expect(validatePackStates(accepted)).toBe(false);
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

  it.each(["harbor", "well"])(
    "follows only the %s path after the resident chooses between exclusive journeys",
    (route) => {
      const { alternate, options } = alternateJourney();
      expect(packProblems(pack, hub, mountedPlaces)).toEqual([]);
      let world = fixture();
      expect(accompany(world)).toEqual([]);
      world = act(world, "choose", {
        choiceId: route === "harbor" ? agreement : alternate,
      });
      const selected = options[route === "harbor" ? 0 : 1].path;
      expect(accompany(world).map((action) => action.destination)).toEqual([
        selected[1],
      ]);
      const other = route === "harbor" ? "greek-well" : "greek-harbor";
      expect(accompanyDecision(world, "vale", resident, other).accepted).toBe(
        false,
      );
      for (const destination of selected.slice(1)) {
        world = act(world, "accompany", { target: resident, destination });
        world = decodeSave(encodeSave(world));
        expect(world.actors[resident].place).toBe(destination);
      }
      expect(accompany(world)).toEqual([]);
      world.actors[resident].place = other;
      expect(validatePackStates(world)).toBe(false);
    },
  );

  it("bounds the journey options and requires one shared exclusive consent key", () => {
    const { options, key } = alternateJourney();
    const tooMany = structuredClone(pack);
    tooMany.avatars[resident].journey = [...options, ...options];
    expect(
      packProblems(tooMany, hub, mountedPlaces).some((problem) =>
        problem.includes("one to three distinct agreements"),
      ),
    ).toBe(true);
    const independent = structuredClone(pack);
    independent.choices.find((choice) => choice.id === agreement).effects =
      independent.choices
        .find((choice) => choice.id === agreement)
        .effects.filter((effect) => effect.key !== key);
    expect(
      packProblems(independent, hub, mountedPlaces).some((problem) =>
        problem.includes("exclusive recorded consent"),
      ),
    ).toBe(true);
  });

  it("rejects two recorded journey agreements for one resident", () => {
    const { alternate } = alternateJourney();
    const world = act(fixture(), "choose", { choiceId: agreement });
    world.packs[pack.id].receipts[alternate] = world.turn;
    expect(validatePackStates(world)).toBe(false);
    expect(accompany(world)).toEqual([]);
  });

  it("lets a consenting resident make the actual voyage while the human stays ashore", () => {
    let world = independentSail();
    expect(packProblems(pack, hub, mountedPlaces)).toEqual([]);
    world.items["greek-water-jar"].holder = resident;
    for (let turn = 0; turn < 3; turn++) world = act(world, "wait");
    expect(world.actors[resident].place).toBe("greek-courtyard");
    world = act(world, "choose", { choiceId: agreement });
    for (let turn = 0; turn < 5; turn++) {
      world = act(world, "wait");
      world = decodeSave(encodeSave(world));
      expect(world.actors.vale.place).toBe("greek-courtyard");
    }
    expect(world.actors[resident].place).toBe("greek-athens-harbor");
    expect(itemPlace(world, "greek-water-jar")).toBe("greek-athens-harbor");
    expect(world.transports["greek-ship"].dock).toBe("greek-athens-harbor");
    expect(
      world.log
        .filter((event) => event.actorId === resident && event.verb === "move")
        .map((event) => event.targetId),
    ).toEqual(["greek-harbor", "greek-ship", "greek-athens-harbor"]);
    expect(plan(world, resident).action.kind).toBe("wait");
  });

  it("keeps an independent passenger aboard until the human chooses the agreed port", () => {
    let world = act(independentSail(), "choose", { choiceId: agreement });
    world = act(world, "move", { target: "greek-harbor" });
    expect(world.actors[resident].place).toBe("greek-ship");
    world = act(world, "move", { target: "greek-ship" });
    world = act(world, "move", { target: "greek-piraeus" });
    expect(world.actors[resident].place).toBe("greek-ship");
    expect(plan(world, resident).action.kind).toBe("wait");
    world = decodeSave(encodeSave(world));
    world = act(world, "move", { target: "greek-ship" });
    world = act(world, "move", { target: "greek-athens-harbor" });
    expect(world.actors[resident].place).toBe("greek-athens-harbor");
    expect(world.transports["greek-ship"].dock).toBe("greek-athens-harbor");
  });

  it("requires a declared vessel for an independent journey", () => {
    pack.avatars[resident].journey.independent = true;
    expect(
      packProblems(pack, hub, mountedPlaces).some((problem) =>
        problem.includes("simple connected path"),
      ),
    ).toBe(true);
    independentSail();
    pack.avatars[resident].journey.independent = "yes";
    expect(
      packProblems(pack, hub, mountedPlaces).some((problem) =>
        problem.includes("simple connected path"),
      ),
    ).toBe(true);
  });

  it("keeps the reserved departure for the resident while the human waits ashore", () => {
    let world = independentSail();
    pack.avatars[resident].journey.exclusive = true;
    packPeople[resident].journey.exclusive = true;
    expect(packProblems(pack, hub, mountedPlaces)).toEqual([]);
    world = act(world, "move", { target: "greek-harbor" });
    const staleBoard = legalActions(world).find(
      (a) => a.kind === "move" && a.target === "greek-ship",
    );
    expect(staleBoard).toBeDefined();
    world = act(world, "move", { target: "greek-courtyard" });
    world = act(world, "choose", { choiceId: agreement });
    world = act(world, "move", { target: "greek-harbor" });
    expect(world.actors[resident].place).toBe("greek-ship");
    expect(
      legalActions(world).some(
        (a) => a.kind === "move" && a.target === "greek-ship",
      ),
    ).toBe(false);
    const rejected = play(world, staleBoard, world.revision);
    expect(rejected.ok).toBe(false);
    expect(rejected.state).toEqual(world);
    const forged = structuredClone(world);
    forged.actors.vale.place = "greek-ship";
    expect(() => decodeSave(JSON.stringify(forged))).toThrow();
    for (
      let turn = 0;
      turn < 16 &&
      !legalActions(world).some(
        (a) => a.kind === "move" && a.target === "greek-ship",
      );
      turn++
    )
      world = act(world, "wait");
    expect(world.actors[resident].place).toBe("greek-athens-harbor");
    expect(world.actors.vale.place).toBe("greek-harbor");
    world = act(world, "move", { target: "greek-ship" });
    expect(world.actors.vale.place).toBe("greek-ship");
  });

  it("waits for the existing passengers to leave before the reserved voyage", () => {
    let world = independentSail();
    pack.avatars[resident].journey.exclusive = true;
    packPeople[resident].journey.exclusive = true;
    world = act(world, "choose", { choiceId: agreement });
    // A second human can already be aboard when the agreement is recorded.
    // This state isolates that boarding guard before the next legal move.
    world.actors.vale.place = "greek-ship";
    world.transports["greek-ship"].destination = "pond";
    expect(
      legalActions(world, resident).some(
        (a) => a.kind === "move" && a.target === "greek-ship",
      ),
    ).toBe(false);
    world = act(world, "move", { target: "pond" });
    expect(world.actors[resident].place).toBe("greek-harbor");
    world = act(world, "move", { target: "greek-ship" });
    world = act(world, "move", { target: "greek-harbor" });
    expect(world.actors[resident].place).toBe("greek-ship");
    expect(world.actors.vale.place).toBe("greek-harbor");
    world = act(world, "wait");
    expect(world.actors[resident].place).toBe("greek-athens-harbor");
  });

  it("requires an independent shore-to-shore path for a reserved departure", () => {
    independentSail();
    const journey = pack.avatars[resident].journey;
    journey.exclusive = true;
    delete journey.independent;
    expect(
      packProblems(pack, hub, mountedPlaces).some((problem) =>
        problem.includes("simple connected path"),
      ),
    ).toBe(true);
    journey.independent = true;
    journey.path.pop();
    expect(
      packProblems(pack, hub, mountedPlaces).some((problem) =>
        problem.includes("simple connected path"),
      ),
    ).toBe(true);
  });
});
