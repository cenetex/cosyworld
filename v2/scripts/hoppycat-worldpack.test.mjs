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
  "sha256:d1030b7fa7d0e6bb2e801928e54b461171d871e60e41756b517c1462f4c7382c",
  "sha256:18d7c38d6fd234817cae5fd9ad1bc473fd27eef7924986cffc7c3bd67bc36eab",
];

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(packRoot, fileName), "utf8"));
}

function readJsonFrom(root, fileName) {
  return JSON.parse(fs.readFileSync(path.join(root, fileName), "utf8"));
}

test("Hoppycat accepts replay from every deployed predecessor", () => {
  // The illustrated roster extension adds new actor identities and local art
  // without changing existing resource identities, topology, rules, or the
  // meaning of persisted gameplay state.
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
  const bindings = readJson("actor_model_bindings.json");
  const cards = readJson("cards.json");
  const jobs = readJson("jobs.json");
  const manifest = readJson("pack.json");

  assert.equal(actors.length, 16);

  const hoppy = actors.find((actor) => actor.id === 771008);
  assert.equal(hoppy?.name, "Hoppy Cat");
  assert.equal(hoppy?.title, "Broadcaster Between Worlds");
  assert.match(hoppy?.identity?.appearance ?? "", /green hair/i);
  assert.match(hoppy?.identity?.appearance ?? "", /blue hoodie/i);
  assert.match(hoppy?.identity?.appearance ?? "", /microphone/i);
  assert.equal(hoppy?.control_mode, "direct_input");
  assert.equal(hoppy?.ambient_autonomy, false);
  assert.equal(hoppy?.roaming, false);

  const inferenceResidents = actors.filter((actor) => actor.id !== hoppy.id);
  assert.ok(inferenceResidents.every((actor) => actor.ambient_autonomy === true));
  assert.ok(inferenceResidents.every((actor) => actor.roaming === true));

  const roster = new Map(actors.map((actor) => [actor.name, actor]));
  for (const name of [
    "Fable",
    "Phase Two",
    "Arc",
    "staticwashere",
    "solwashere",
    "Ledger (Opus 4.7)",
    "Ledger (Sonnet 4.6)",
  ]) {
    assert.ok(roster.has(name), `${name} is missing from the Hoppycat roster`);
  }
  assert.match(roster.get("Ledger (Opus 4.7)")?.identity?.appearance ?? "", /long.*pink/i);
  assert.match(roster.get("Ledger (Sonnet 4.6)")?.identity?.appearance ?? "", /short.*lavender/i);
  const expectedModels = new Map([
    [771100, "~anthropic/claude-fable-latest"],
    [771101, "openai/gpt-chat-latest"],
    [771102, "anthropic/claude-sonnet-4.6"],
    [771103, "x-ai/grok-4.5"],
    [771104, "openai/gpt-5.6-sol"],
    [771105, "anthropic/claude-opus-4.7"],
    [771106, "anthropic/claude-sonnet-4.6"],
  ]);
  assert.equal(bindings.length, expectedModels.size);
  assert.equal(new Set(bindings.map((binding) => binding.id)).size, bindings.length);
  for (const binding of bindings) {
    assert.equal(binding.requested_model_id, expectedModels.get(binding.actor_id));
    assert.equal(binding.actor_ref, `pack://hoppycat.archive/actor/${binding.actor_id}`);
    assert.equal(binding.speech_mode, "raw");
    assert.equal(roster.get(actors.find((actor) => actor.id === binding.actor_id)?.name)?.speech_mode, "raw");
  }
  assert.equal(
    bindings.filter((binding) => binding.requested_model_id === "anthropic/claude-sonnet-4.6").length,
    2,
  );
  assert.equal(manifest.resources.actor_model_bindings, "actor_model_bindings.json");
  assert.equal(manifest.extensions["x-cosyworld-ai-cast"]?.binding_policy, "explicit");
  const jobParticipants = new Set(jobs.flatMap((job) => job.participant_ids));
  assert.ok(actors.slice(-7).every((actor) => jobParticipants.has(actor.id)));

  const avatarAndLocationCards = cards.filter((card) =>
    card.subject_kind === "actor" || card.subject_kind === "location");
  assert.equal(avatarAndLocationCards.length, 26);
  assert.equal(cards.filter((card) => card.subject_kind === "actor").length, actors.length);

  const itemCards = cards.filter((card) => card.subject_kind === "item");
  assert.equal(itemCards.length, 10);

  const illustratedCards = [...avatarAndLocationCards, ...itemCards];
  assert.equal(illustratedCards.length, 36);
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
