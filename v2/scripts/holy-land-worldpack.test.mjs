import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const contentDir = path.resolve(scriptDir, "../content");

function readJson(...parts) {
  return JSON.parse(fs.readFileSync(path.join(contentDir, ...parts), "utf8"));
}

const actors = readJson("the-holy-land", "actors.json");
const cards = readJson("the-holy-land", "cards.json");
const jobs = readJson("the-holy-land", "jobs.json");
const holyLandPack = readJson("the-holy-land", "pack.json");
const bridgePack = readJson("core-holy-land-bridge", "pack.json");
const officialWorld = JSON.parse(
  fs.readFileSync(path.resolve(scriptDir, "../worlds/official/world.json"), "utf8"),
);

test("the Twelve search for Christ for twelve distinct reasons", () => {
  const disciples = actors.filter(({ id }) => id >= 7002 && id <= 7013);
  assert.equal(disciples.length, 12);

  const motivations = disciples.map((actor) => {
    assert.equal(actor.goals?.length, 1, `${actor.name} should have one private goal`);
    assert.equal(actor.goals[0].objective, "Search for Christ.");
    assert.ok(actor.goals[0].motivation.length >= 40);
    return actor.goals[0].motivation;
  });

  assert.equal(new Set(motivations).size, 12);
});

test("Christ remains real in the fiction and absent from the authored cast", () => {
  assert.ok(actors.some((actor) => actor.goals?.[0]?.objective === "Search for Christ."));
  assert.ok(!actors.some((actor) => /\bjesus\b|\bchrist\b/i.test(actor.name)));
  assert.ok(!cards.some((card) => /\bjesus\b|\bchrist\b/i.test(card.display_name)));
});

test("Holy Land generated paths use the current ecology-grounded prose contract", () => {
  const policy = holyLandPack.extensions["x-cosyworld-generation"];
  assert.equal(holyLandPack.version, "1.2.1");
  assert.equal(policy.migration_version, 4);
  assert.deepEqual(policy.prose.prompt_versions, ["pathway-content-v2"]);
  assert.ok(
    policy.migrations.some(
      (migration) =>
        migration.from_migration_version === 3
        && migration.from_pack_version === "1.2.0"
        && migration.mode === "preserve_descendants",
    ),
  );
});

test("Holy Land contribution strategies bind the current pack version", () => {
  const strategies = jobs.flatMap((job) => job.contribution_strategies ?? []);
  assert.ok(strategies.length > 0);
  assert.ok(
    strategies.every(
      (strategy) =>
        strategy.pack_id === holyLandPack.id
        && strategy.pack_version === holyLandPack.version,
    ),
  );
});

test("the official bridge keeps Holy Land prose, art, and cairn vocabulary", () => {
  const policy = bridgePack.extensions["x-cosyworld-generation"];
  const dependency = bridgePack.dependencies.find(
    ({ id }) => id === "cosyworld.the-holy-land",
  );
  const route = policy.cross_pack_routes[0];

  assert.equal(bridgePack.version, "1.0.2");
  assert.equal(dependency.version, ">=1.2.1 <2.0.0");
  assert.equal(policy.migration_version, 2);
  assert.deepEqual(policy.prose.prompt_versions, ["pathway-content-v2"]);
  assert.equal(policy.place_anchor.action_label, "Build a cairn");
  assert.equal(policy.place_anchor.target_label, "a cairn");
  assert.match(policy.place_anchor.visual_description, /watercolor palette/);
  assert.equal(
    route.media_profile_id,
    "cosyworld.holy-land.generated-landscape/1",
  );
  assert.equal(route.topology_authority.migration_version, 2);
  assert.ok(
    policy.migrations.some(
      (migration) =>
        migration.from_policy_id
          === "cosyworld.compatibility.host-generation/1"
        && migration.from_migration_version === 0
        && migration.from_pack_version === "1.0.1"
        && migration.mode === "preserve_descendants",
    ),
  );
  assert.ok(
    policy.migrations.some(
      (migration) =>
        migration.from_policy_id
          === "cosyworld.composition.core-holy-land/generation/1"
        && migration.from_migration_version === 1
        && migration.from_pack_version === "1.0.1"
        && migration.mode === "preserve_descendants",
    ),
  );
});

test("the official world accepts replay from prior Holy Land bundles", () => {
  const compatible =
    officialWorld.persistence_compatibility.replay_compatible_bundle_hashes;
  assert.ok(
    compatible.includes(
      "sha256:a4e8e14c025ceed0247a3e475d51399496cbad6ff386d8eccea93572fe704f7a",
    ),
  );
  assert.ok(
    compatible.includes(
      "sha256:54cdcd2ed0d23a8a1f216bf6240035d7f6cf312a910e5e10b2a323d39ac1a333",
    ),
  );
});
