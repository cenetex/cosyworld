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
const locations = readJson("the-holy-land", "locations.json");
const holyLandPack = readJson("the-holy-land", "pack.json");
const bridgePack = readJson("core-holy-land-bridge", "pack.json");
const bethlehemRegistry = readJson("bethlehem", "registry.json");
const officialWorld = JSON.parse(
  fs.readFileSync(path.resolve(scriptDir, "../worlds/official/world.json"), "utf8"),
);
const bethlehemWorld = JSON.parse(
  fs.readFileSync(path.resolve(scriptDir, "../worlds/bethlehem/world.json"), "utf8"),
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

test("Emmaus is the destination while its road belongs to the journey system", () => {
  const emmaus = locations.find(({ id }) => id === 714);
  const emmausCard = cards.find(({ subject_kind, subject_id }) => (
    subject_kind === "location" && subject_id === 714
  ));

  assert.equal(emmaus?.name, "Emmaus");
  assert.equal(emmausCard?.display_name, "Emmaus");
  assert.ok(!locations.some(({ name }) => name === "Road to Emmaus"));
});

test("Holy Land generated paths use the current ecology-grounded prose contract", () => {
  const policy = holyLandPack.extensions["x-cosyworld-generation"];
  assert.equal(holyLandPack.version, "1.2.3");
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

  assert.equal(bridgePack.version, "1.0.4");
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
          === "cosyworld.composition.core-holy-land/generation/1"
        && migration.from_migration_version === 1
        && migration.from_pack_version === "1.0.1"
        && migration.mode === "preserve_descendants",
    ),
  );
  assert.ok(
    policy.migrations.some(
      (migration) =>
        migration.from_policy_id === "cosyworld.compatibility.host-generation/1"
        && migration.from_migration_version === 0
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
  assert.ok(
    compatible.includes(
      "sha256:fea970b0cdbb1266e4fd20bbec60ed2ff48bb8feb36a799ebd558700a7f83028",
    ),
  );
  assert.ok(
    compatible.includes(
      "sha256:407b41af639a9cdd0ee1e5a043482d56bd5e935fcc99f53385733fb39d4425c0",
    ),
  );
});

test("the official world accepts the live pre-Ruby High population epoch", () => {
  const compatible =
    officialWorld.persistence_compatibility.replay_compatible_bundle_hashes;
  assert.ok(
    compatible.includes(
      "sha256:955e562292235ee87d68fbc16457f89fad70102c9bb71556e26814e8f461f8bc",
    ),
  );
});

test("the official world accepts the deployed pre-item-policy journal", () => {
  const compatible =
    officialWorld.persistence_compatibility.replay_compatible_bundle_hashes;
  assert.ok(
    compatible.includes(
      "sha256:d2f4d610d4c55b5a0565631940db57f94d97685640ae4b74632a529022530b61",
    ),
  );
});

test("Bethlehem accepts every declared production replay epoch", () => {
  const compatible = bethlehemWorld.persistence_compatibility
    .replay_compatible_bundle_hashes;
  assert.deepEqual(compatible, [
    "sha256:463890e096d1ebb1bc253e20af8173bf3cf3a78ee508e3236e18ba002f03b0df",
    "sha256:0d989794764b86a1b3067a3c1ca43078dbacfece38a84371039d5a16af80e2f3",
    "sha256:2029c79967979ad2864570ea55708b6fdc02aced3c32ad80f88c646c330083f8",
    "sha256:782e5c77078ffe57d9cb31ed070ca8ba14a9158084e13f08fea17d9497a8b347",
    "sha256:e02e7f097c390244005c2ccebbdcec82dc2618ede05fac998716f6a03bdcc63e",
    "sha256:97c90b233f9a548f914bed0ddb4d9b5582bc370398a980d8ef9ec8d524a13c74",
    "sha256:0781f23550c8be3e16ad2fb92b9c1bf067f164c351d9d95df47a2969116f7480",
    "sha256:070906fd0fd90124fe93641d11c2c6285cf0c78b2e9126d805206a0d9136eb7f",
    "sha256:d6bb85c9b172307abb4c06faabb6d270e583b539947abb90d2e683832dff806d",
    "sha256:1480f6d16556ba2a61636c106a9aeae87f05cca72c02e043fa22eedad6188fbf",
  ]);
});

test("Bethlehem mounts a provider for every authored card image", () => {
  const prefixes = bethlehemRegistry.assets.map(({ public_prefix }) => public_prefix);
  for (const card of bethlehemRegistry.resources.cards) {
    if (!card.image_url?.startsWith("/assets/")) continue;
    assert.ok(
      prefixes.some(
        (prefix) => card.image_url === prefix || card.image_url.startsWith(`${prefix}/`),
      ),
      `${card.card_id} has no mounted asset provider for ${card.image_url}`,
    );
  }
});
