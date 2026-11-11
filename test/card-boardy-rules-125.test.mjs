import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { currentSharedEngine } from "./fixtures/shared-engine.mjs";

// Exact content from main 35d73397403c04c5f79d5009089898d99256c82e.
const runtime = currentSharedEngine(125);
const dispatch = (request) =>
  JSON.parse(runtime.cardShared(JSON.stringify(request)));
const membership = {
  actor: "vale",
  claimed: ["vale", "mara"],
  present: ["vale", "mara"],
};

describe("historical Boardy rules125 contracts", () => {
  it("pins the released rules and content bytes", () => {
    const engine = readFileSync(
      new URL(
        "../v2/orchestrator-rust/src/card_shared/engine-v125.js",
        import.meta.url,
      ),
    );
    expect(createHash("sha256").update(engine).digest("hex")).toBe(
      "90d543aee574f23d1990d08b51f3234175eb109dc47f96a1abb5fdf20a2cea88",
    );
    const content = readFileSync(
      new URL("./fixtures/card-content-rules-125.json", import.meta.url),
    );
    expect(createHash("sha256").update(content).digest("hex")).toBe(
      "452a364413608b909b3751563416145c488638bf775a79f4cf81373c9ea7a1da",
    );
  });
  it("rules125 upgrades only revision 2's doorway knowledge while preserving the saved world", () => {
    let world = dispatch({ op: "create" }).world;
    world.actors.vale.place = "station";
    const action = dispatch({ op: "view", world, ...membership }).actions.find(
      (a) => a.kind === "take" && a.item === "boardyai-calling-card",
    );
    expect(action).toBeDefined();
    world = dispatch({
      op: "play",
      world,
      actor: "vale",
      claimed: ["vale", "mara"],
      present: ["vale", "mara"],
      action,
    }).world;
    // A saved world omits live presence; normalize that existing boundary first.
    world = dispatch({ op: "validate", world }).world;
    world.packs.boardyai.revision = 2;
    world.crossings["station-boardyai-parlour"].discovered = true;
    world.crossings["boardyai-parlour-station"].discovered = true;
    world.routeKnowledge.vale = [
      ["station", "boardyai-parlour"],
      ["boardyai-parlour", "station"],
      ["station", "pond"],
      ["forest-garden", "forest-oak"],
    ];
    const expected = structuredClone(world);
    expected.packs.boardyai.revision = 3;
    expected.routeKnowledge.vale = [
      ["station", "pond"],
      ["pond", "attic"],
      ["attic", "boardyai-parlour"],
      ["boardyai-parlour", "attic"],
      ["attic", "pond"],
      ["pond", "station"],
      ["forest-garden", "forest-oak"],
    ];
    const loaded = dispatch({ op: "validate", world }).world;
    expect(loaded).toEqual(expected);
    expect(dispatch({ op: "validate", world: loaded }).world).toEqual(expected);
  });

  it("replays an accepted attic doorway action with the recorded content", () => {
    const world = dispatch({ op: "create" }).world;
    world.actors.vale.place = "attic";
    world.items["boardyai-calling-card"].holder = "vale";
    const action = dispatch({ op: "view", world, ...membership }).actions.find(
      (a) => a.kind === "move" && a.target === "boardyai-parlour",
    );
    expect(action).toBeDefined();
    const request = { op: "play", world, ...membership, action };
    const accepted = dispatch(request);
    expect(accepted.ok).toBe(true);
    expect(accepted.world.actors.vale.place).toBe("boardyai-parlour");
    expect(accepted.world.items["boardyai-calling-card"].holder).toBe("vale");
    const replay = currentSharedEngine(125);
    expect(JSON.parse(replay.cardShared(JSON.stringify(request)))).toEqual(
      accepted,
    );
    expect(
      dispatch({
        op: "view",
        world: accepted.world,
        ...membership,
        present: ["vale"],
      }).exits,
    ).toContain("attic");
  });
});
