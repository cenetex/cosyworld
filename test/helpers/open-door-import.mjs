import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { packDefinition } from "../../v2/card-game/pack-registry.mjs";
import { decodeSave, encodeSave } from "../../v2/card-game/world.mjs";

// Play the released catalog; no recorded save or invented receipts.
export function openDoorImport(upgraded = false) {
  const base = "521c76cb39df10c2e552a9e2d88dc4a8d02d6fe9";
  const prior = (name) =>
    execFileSync(
      "git",
      ["show", `${base}:v2/orchestrator-rust/src/card_shared/${name}`],
      { encoding: "utf8", maxBuffer: 64 << 20 },
    );
  const oldContent = JSON.parse(prior("content.json"));
  const oldPack = oldContent.files["v2/card-game/packs.json"].packs.find(
    (p) => p.id === "greek-drama",
  );
  const current = packDefinition("greek-drama");
  const authored = JSON.parse(
    readFileSync(
      new URL(
        "../../v2/orchestrator-rust/src/card_narrative/authored-text.json",
        import.meta.url,
      ),
    ),
  );
  assert.deepEqual(
    authored.retired_names,
    Object.entries(oldPack.items)
      .filter(([id]) => !current.items[id])
      .map(([id, item]) => [id, item.name])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  const context = vm.createContext({
    structuredClone,
    cardContent: oldContent,
  });
  vm.runInContext(
    prior("engine-v137.js").replace(
      "globalThis.cardShared = (json) => {",
      "globalThis.fixture = {createWorld, legalActions, play, validateWorld, worldLife}; globalThis.cardShared = (json) => {",
    ),
    context,
  );
  const rules = context.fixture;
  rules.worldLife.on = false;
  let world = rules.createWorld({
    seed: 7,
    packScopes: { "greek-drama": "full" },
  });
  world.actors.vale.place = "greek-eleusis";
  world.actors.vale.visited.push("greek-eleusis");
  world.crossings["pond-greek-harbor"].discovered = true;
  world.items.lamp.lit = false;
  const act = (kind, fields = {}) => {
    const action = rules
      .legalActions(world)
      .find(
        (a) =>
          a.kind === kind &&
          Object.entries(fields).every(([k, v]) => a[k] === v),
      );
    assert.ok(action, `${kind} ${JSON.stringify(fields)}`);
    const next = rules.play(world, action, world.revision);
    assert.equal(next.error, undefined);
    world = next.state;
  };
  const move = (...ids) =>
    ids.forEach((id) => act("move", { target: `greek-${id}` }));
  act("talk", { target: "greek-aethra" });
  act("wait");
  act("take", { item: "greek-burial-petition" });
  move("road-athens-eleusis", "athens");
  act("give", { item: "greek-burial-petition", target: "greek-theseus" });
  act("talk", { target: "greek-theseus" });
  move("road-athens-piraeus", "piraeus");
  act("wait");
  act("take", { item: "greek-return-cloths" });
  move("road-athens-piraeus", "athens", "road-athens-eleusis", "eleusis");
  act("drop", { item: "greek-return-cloths", target: "greek-eleusis" });
  act("wait");
  act("take", { item: "greek-ash-urn" });
  act("give", { item: "greek-ash-urn", target: "greek-argive-mother" });
  act("take", { item: "greek-return-list" });
  act("take", { item: "greek-pyre-account" });
  move("road-athens-eleusis", "athens", "road-athens-piraeus", "piraeus");
  act("give", { item: "greek-return-list", target: "greek-quay-host" });
  move("road-athens-piraeus", "athens", "road-athens-eleusis", "eleusis");
  for (const destination of [
    "greek-road-athens-eleusis",
    "greek-athens",
    "greek-road-athens-piraeus",
    "greek-piraeus",
  ])
    act("accompany", { target: "greek-household-witness", destination });
  act("take", { item: "greek-provision-basket" });
  act("give", {
    item: "greek-provision-basket",
    target: "greek-household-witness",
  });
  act("take", { item: "greek-return-list" });
  rules.validateWorld(world);
  assert.equal(world.actors.vale.heldItem, "greek-return-list");
  assert.equal(world.journeyProgress["greek-household-witness"].step, 4);
  assert.equal(world.packs["greek-drama"].revision, 24);
  return upgraded
    ? JSON.parse(encodeSave(decodeSave(JSON.stringify(world))))
    : world;
}
