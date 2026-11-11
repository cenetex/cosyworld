import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import vm from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";
import { decodeSave } from "../v2/card-game/world.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";

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
    expect(packDefinition(packId).avatars[resident].journey.path).toEqual(path);
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
