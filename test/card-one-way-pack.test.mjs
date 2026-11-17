import { expect, it, vi } from "vitest";

const spot = (name, exits = []) => ({
  name,
  text: `${name}.`,
  persona: `${name}.`,
  exits,
  backdrop: "assets/ow-pack/x.png",
});
const door = (from, to) => ({
  id: `${from}-${to}`,
  from,
  to,
  travelers: "any",
  travel: "through the test door",
  requires: [],
});
const pack = {
  schemaVersion: 1,
  id: "ow-pack",
  packId: "cosyworld.ow-pack",
  revision: 1,
  name: "One Way",
  description: "An invented pack with a one-way route and a lost place.",
  entry: "ow-a",
  places: {
    "ow-a": spot("Near Side"),
    "ow-b": spot("Far Side"),
    "ow-lost": spot("Lost Place"),
  },
  avatars: {},
  routes: [{ from: "ow-a", to: "ow-b", requires: [] }],
  crossings: [door("station", "ow-a"), door("ow-a", "station")],
  choices: [],
  bridge: { id: "shore-ow-pack", description: "Invented." },
};

vi.mock("../v2/card-game/packs.json", async (importOriginal) => {
  const real = await importOriginal();
  return {
    default: { ...real.default, packs: [...real.default.packs, pack] },
  };
});

const { createWorld, legalActions, play } = await import(
  "../v2/card-game/world.mjs"
);
const { packProblems, packWarnings } = await import(
  "../v2/card-game/pack-schema.mjs"
);
const { default: compiled } = await import("../v2/card-game/packs.json");

it("loads and plays a pack with a one-way route and an unreachable place", () => {
  expect(packProblems(pack, compiled.hub)).toEqual([]);
  expect(packWarnings(pack, compiled.hub)).toEqual([
    "ow-pack: a route has no return: ow-a>ow-b",
    "ow-pack: every place must be reachable from the entry",
  ]);
  let s = createWorld({ seed: 5 });
  s.actors.vale.place = "ow-a";
  const moves = () =>
    legalActions(s, "vale")
      .filter((a) => a.kind === "move")
      .map((a) => a.target);
  expect(moves()).toContain("ow-b");
  const step = (kind, target) => {
    const action = legalActions(s, "vale").find(
      (a) => a.kind === kind && (!target || a.target === target),
    );
    const result = play(s, action, s.revision, "vale");
    expect(result.ok, result.error).toBe(true);
    s = result.state;
  };
  step("move", "ow-b");
  expect(s.actors.vale.place).toBe("ow-b");
  expect(moves()).toEqual([]);
  step("wait");
  expect(s.actors.vale.place).toBe("ow-b");
  expect(moves()).toEqual([]);
});
