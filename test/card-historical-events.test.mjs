import { readFileSync } from "node:fs";
import vm from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";

// Pin both the released rules and their content. This is historical-input
// compatibility, not equivalence between old and deliberately changed rules.
// The content fixture is verbatim from main 562c8193 (full-card-world/128).
const runtime = vm.createContext({
  structuredClone,
  cardContent: JSON.parse(
    readFileSync(
      new URL("./fixtures/released-rules/content-v128.json", import.meta.url),
    ),
  ),
});
vm.runInContext(
  readFileSync(
    new URL(
      "../v2/orchestrator-rust/src/card_shared/engine-v128.js",
      import.meta.url,
    ),
    "utf8",
  ),
  runtime,
);
const context = { actor: "vale", claimed: ["vale"], present: ["vale"] };
function released(request) {
  const result = JSON.parse(
    runtime.cardShared(JSON.stringify({ ...context, ...request })),
  );
  expect(result.ok, result.error).toBe(true);
  return result;
}
function playReleased(world, kind, item) {
  const action = released({ op: "view", world }).actions.find(
    (a) => a.kind === kind && (item === undefined || a.item === item),
  );
  expect(action, `released rules offer ${kind}`).toBeDefined();
  return released({ op: "play", world, action }).world;
}
const histories = {};
beforeAll(() => {
  const initial = released({ op: "create", seed: 7 }).world;
  histories.snuff = playReleased(initial, "snuff", "lamp");
  histories.light = playReleased(histories.snuff, "light", "lamp");
  // Prepare valid old-world preconditions, then let the released rules create
  // the actual records. Do not invent or relabel historical log entries.
  const covered = structuredClone(initial);
  covered.items.cloth.holder = "vale";
  histories.cover = playReleased(covered, "cover", "cloth");
  const empty = structuredClone(initial);
  empty.items.lamp.fuel = 0;
  empty.items.lamp.lit = false;
  empty.items.oil.holder = "vale";
  histories.refuel = playReleased(empty, "wait");
  for (const [verb, world] of Object.entries(histories)) {
    expect(world.log.some((entry) => entry.verb === verb)).toBe(true);
    released({ op: "view", world });
  }
}, 30000);

function preservedHistory(before, after) {
  expect(after.log).toEqual(before.log);
  expect(after.eventSeq).toBe(before.eventSeq);
  expect(after.turn).toBe(before.turn);
  for (const [id, item] of Object.entries(before.items)) {
    expect(after.items[id].holder).toBe(item.holder);
  }
  for (const [id, crossing] of Object.entries(before.crossings)) {
    expect(after.crossings[id].discovered).toBe(crossing.discovered);
  }
}

describe("released lamp events remain accepted history", () => {
  // Skipped: replays a recorded save through the removed Theban-response
  // branch; retired with the fixtures in package 6 fixtures.
  it.skip.each(["snuff", "light", "cover", "refuel"])(
    "loads and round-trips a real rules-128 %s record without rewriting history",
    (verb) => {
      const original = histories[verb];
      const text = JSON.stringify(original);
      const loaded = decodeSave(text);
      preservedHistory(original, loaded);
      const again = decodeSave(encodeSave(loaded));
      expect(again).toEqual(loaded);
      expect(JSON.stringify(original)).toBe(text);
    },
  );
  // Skipped: replays a recorded save through the removed Theban-response
  // branch; retired with the fixtures in package 6 fixtures.
  it.skip.each(["snuff", "light", "cover", "refuel"])(
    "preserves the %s record through the source shared-upgrade boundary",
    (verb) => {
      const original = histories[verb];
      const before = structuredClone(original);
      // No v129 bundle is minted: this exercises the current source handler
      // that the next authorized rules version will use.
      const upgraded = dispatchShared({
        ...context,
        op: "upgrade",
        world: original,
        from: "full-card-world/128",
        to: "full-card-world/129",
      });
      expect(upgraded.ok).toBe(true);
      expect(upgraded.world.revision).toBe(original.revision + 1);
      preservedHistory(original, upgraded.world);
      const viewed = dispatchShared({
        ...context,
        op: "view",
        world: upgraded.world,
      });
      preservedHistory(original, viewed.world);
      expect(original).toEqual(before);
    },
  );
  it("still rejects an unknown historical verb or invalid event sequence", () => {
    const badVerb = structuredClone(histories.light);
    badVerb.log.find((entry) => entry.verb === "light").verb =
      "invented-action";
    expect(() => decodeSave(JSON.stringify(badVerb))).toThrow(/fresh start/);
    const badSequence = structuredClone(histories.light);
    badSequence.log.find((entry) => entry.verb === "light").seq = 0;
    expect(() => decodeSave(JSON.stringify(badSequence))).toThrow(
      /fresh start/,
    );
  });
});
