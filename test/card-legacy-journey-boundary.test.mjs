import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import vm from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";
import { decodeSave } from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { currentSharedEngine } from "./fixtures/shared-engine.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url));
const engine = read("../v2/orchestrator-rust/src/card_shared/engine-v110.js");
// Rules 110's content at a1f0038ac is byte-identical to this existing fixture.
const content = read("./fixtures/card-content-rules-109.json");
const start = read("./fixtures/greek-before-funeral/exposure.json.gz");
const currentVersion = read("../v2/orchestrator-rust/src/card_shared/engine.rs")
  .toString()
  .match(/const VERSION: &str = "(full-card-world\/\d+)"/)[1];
const actions = JSON.parse(
  read("./fixtures/released-rules/journey-v110-actions.json"),
);
const runtime = vm.createContext({
  structuredClone,
  cardContent: JSON.parse(content),
});
vm.runInContext(engine.toString(), runtime);
const membership = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const call = (request) =>
  JSON.parse(runtime.cardShared(JSON.stringify({ ...membership, ...request })));
function released(request) {
  const result = call(request);
  expect(result.ok, result.error).toBe(true);
  return result;
}
const resident = "greek-household-witness";
const agreement = "greek-homecoming-agree-journey";
const arrival = "greek-homecoming-receive-family";
const packId = "greek-drama";
const path = JSON.parse(content).files["v2/card-game/packs.json"].packs.find(
  (pack) => pack.id === packId,
).avatars[resident].journey.path;
const histories = {};

beforeAll(() => {
  // A checked-in rules-103 opening, loaded by unmodified rules 110. Every
  // receipt, journey step and arrival below comes from an actual old play.
  let world = released({
    op: "validate",
    world: JSON.parse(gunzipSync(start)).closed,
  }).world;
  histories.unagreed = world;
  for (const action of actions) {
    expect(released({ op: "view", world }).actions).toContainEqual(action);
    world = released({ op: "play", world, action }).world;
    expect(world.journeyProgress).toBeUndefined();
    if (world.packs[packId].receipts[agreement] && !histories[0])
      histories[0] = world;
    if (action.kind === "accompany" && action.target === resident)
      histories[path.indexOf(world.actors[resident].place)] = world;
  }
  expect(world.packs[packId].receipts[arrival]).toBeDefined();
  histories.completed = world;
}, 30000);

function preserved(before, after) {
  for (const key of ["turn", "eventSeq", "log"])
    expect(after[key]).toEqual(before[key]);
  expect(after.packs[packId].receipts).toEqual(before.packs[packId].receipts);
  for (const [id, actor] of Object.entries(before.actors))
    expect(after.actors[id].place, id).toBe(actor.place);
  expect(after.items["greek-provision-basket"].holder).toBe(
    before.items["greek-provision-basket"].holder,
  );
}

describe("legacy journey migration boundary", () => {
  it("pins historical rules, content, opening and the original authored route", () => {
    const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
    expect(hash(engine)).toBe(
      "e104f15ed3fd80962b3738134b2a8d95569b380966f56c8aed56a31c9e2da624",
    );
    expect(hash(content)).toBe(
      "b1a6dcaed430919ac081d36e512c62a8a64d53c7c64a57cb8c37bc170288a6f3",
    );
    expect(hash(start)).toBe(
      "5431cd710d2e04f714bda9051b94ecae8c02b4f0f9717031eda5dd8582f38f10",
    );
    expect(actions).toHaveLength(52);
    expect(path).toHaveLength(5);
    // Today Myrine has no authored journey: she walks on her own want
    // (open-door-rework). The old route lives on in the released content.
    expect(packDefinition(packId).avatars[resident].journey).toBeUndefined();
  });

  // The source and the compiled bundle still agree at the shared boundary:
  // the same requests, including an upgrade onto the current rules, answer
  // alike on a world of the current rules. (Worlds of earlier rules retired
  // with the rules 133 bump, so the released rules-110 stages no longer cross.)
  it("keeps the source and compiled shared engines in agreement at the upgrade boundary", () => {
    const current = currentSharedEngine();
    const ask = (request) => JSON.parse(current.cardShared(JSON.stringify(request)));
    const created = dispatchShared({ op: "create", seed: 11 });
    expect(created.ok, created.error).toBe(true);
    expect(ask({ op: "create", seed: 11 })).toEqual(created);
    for (const op of ["view", "validate"]) {
      const request = { ...membership, op, world: structuredClone(created.world) };
      expect(ask(request)).toEqual(dispatchShared(request));
    }
    const view = dispatchShared({ ...membership, op: "view", world: created.world });
    const play = {
      ...membership,
      op: "play",
      world: structuredClone(created.world),
      action: view.actions.find((a) => a.kind === "wait"),
    };
    expect(ask(play)).toEqual(dispatchShared(play));
    const upgrade = {
      ...membership,
      op: "upgrade",
      world: structuredClone(created.world),
      from: currentVersion,
      to: currentVersion,
    };
    expect(ask(upgrade)).toEqual(dispatchShared(upgrade));
  });

  it("rejects an off-path save in both old and current decoders", () => {
    const corrupt = structuredClone(histories[0]);
    corrupt.actors[resident].place = "greek-well";
    const original = JSON.stringify(corrupt);
    const old = call({ op: "validate", world: corrupt });
    expect(old.ok).toBe(false);
    expect(old.error).toContain("fresh start");
    expect(() => decodeSave(original)).toThrow(/fresh start/);
    expect(JSON.stringify(corrupt)).toBe(original);
  });

});
