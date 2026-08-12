import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { evaluateWorldpackGate } from "./check-deploy-worldpack.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packRoot = path.resolve(scriptDir, "../content/hoppycat-archive");
const worldRoot = path.resolve(scriptDir, "../worlds/hoppycat");
const compiledRoot = path.resolve(scriptDir, "../content/hoppycat");
const deployedBundleHashes = [
  "sha256:4033bce20f86585f2fc5221ab7e3aeac637358b4b395ded6dc0b2e71fd1e6035",
  "sha256:4972bbf08959881440c0ab6b718789f6d5822fc3b2898ce7c785ddeb1fe3d475",
];

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(packRoot, fileName), "utf8"));
}

function readJsonFrom(root, fileName) {
  return JSON.parse(fs.readFileSync(path.join(root, fileName), "utf8"));
}

test("Hoppycat accepts replay from deployed bundles before locked item art", () => {
  // #764 added avatar identity and naming metadata, and #767 locks local art
  // for all item cards. Neither changes resource identities, topology, rules,
  // or the meaning of persisted gameplay state.
  const world = readJsonFrom(worldRoot, "world.json");
  const registry = readJsonFrom(compiledRoot, "registry.json");
  const authoredHashes = world.persistence_compatibility
    .replay_compatible_bundle_hashes;
  const compiledHashes = registry.manifest.persistence_compatibility
    .replay_compatible_bundle_hashes;

  assert.deepEqual(authoredHashes, deployedBundleHashes);
  assert.deepEqual(compiledHashes, authoredHashes);

  for (const deployedBundleHash of deployedBundleHashes) {
    const decision = evaluateWorldpackGate({
      candidateHash: registry.manifest.bundle_hash,
      candidateReplayCompatible: compiledHashes,
      liveHash: deployedBundleHash,
    });
    assert.equal(decision.ok, true);
    assert.equal(decision.status, "declared_migration");
  }
});

test("Hoppycat uses a locked illustrated card set led by Hoppy Cat", () => {
  const actors = readJson("actors.json");
  const cards = readJson("cards.json");
  const manifest = readJson("pack.json");

  assert.equal(actors.length, 9);
  assert.ok(actors.every((actor) => actor.ambient_autonomy === true));
  assert.ok(actors.every((actor) => actor.roaming === true));

  const hoppy = actors.find((actor) => actor.id === 771008);
  assert.equal(hoppy?.name, "Hoppy Cat");
  assert.equal(hoppy?.title, "Broadcaster Between Worlds");
  assert.match(hoppy?.identity?.appearance ?? "", /green hair/i);
  assert.match(hoppy?.identity?.appearance ?? "", /blue hoodie/i);
  assert.match(hoppy?.identity?.appearance ?? "", /microphone/i);

  const avatarAndLocationCards = cards.filter((card) =>
    card.subject_kind === "actor" || card.subject_kind === "location");
  assert.equal(avatarAndLocationCards.length, 19);

  const itemCards = cards.filter((card) => card.subject_kind === "item");
  assert.equal(itemCards.length, 10);

  const illustratedCards = [...avatarAndLocationCards, ...itemCards];
  assert.equal(illustratedCards.length, 29);
  assert.ok(illustratedCards.every((card) => card.asset_status === "generated_art"));

  const mount = manifest.assets.find((asset) => asset.mount === "cards");
  assert.equal(mount?.public_prefix, "/assets/hoppycat/cards");
  for (const card of illustratedCards) {
    assert.ok(card.image_url.startsWith(`${mount.public_prefix}/`));
    const fileName = card.image_url.slice(mount.public_prefix.length + 1);
    const assetPath = path.join(packRoot, mount.directory, fileName);
    assert.ok(fs.statSync(assetPath).size > 10_000, `${card.card_id} has usable art`);
  }

  assert.equal(
    fs.readdirSync(path.join(packRoot, mount.directory))
      .filter((fileName) => fileName.endsWith(".webp")).length,
    illustratedCards.length,
  );
});

test("every Hoppycat location is reachable by roaming residents", () => {
  const locationIds = readJson("locations.json").map((location) => location.id);
  const exits = readJson("exits.json");
  const reachable = new Set([locationIds[0]]);
  const pending = [locationIds[0]];

  while (pending.length) {
    const current = pending.shift();
    for (const exit of exits.filter((candidate) =>
      candidate.from_location_id === current && candidate.distance === 1)) {
      if (!reachable.has(exit.to_location_id)) {
        reachable.add(exit.to_location_id);
        pending.push(exit.to_location_id);
      }
    }
  }

  assert.deepEqual([...reachable].sort(), [...locationIds].sort());
  assert.ok(locationIds.every((id) =>
    exits.some((exit) => exit.from_location_id === id && exit.distance === 1)));
});
