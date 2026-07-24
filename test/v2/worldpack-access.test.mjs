import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const checkerPath = path.join(repoRoot, "v2/scripts/check-worldpack.mjs");
const compiledWorldpackRoot = path.join(repoRoot, "v2/content/official");
const temporaryRoots = [];

function worldpackFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cosyworld-worldpack-access-"));
  fs.cpSync(compiledWorldpackRoot, root, { recursive: true });
  const assets = JSON.parse(fs.readFileSync(path.join(root, "assets.json"), "utf8"));
  writeJson(root, "assets.json", assets.map((asset) => ({ ...asset, optional: true })));
  temporaryRoots.push(root);
  return root;
}

function writeJson(root, fileName, value) {
  fs.writeFileSync(path.join(root, fileName), `${JSON.stringify(value, null, 2)}\n`);
  if (fileName === "registry.json") return;
  const registryPath = path.join(root, "registry.json");
  if (!fs.existsSync(registryPath)) return;
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  if (fileName === "worldpack.json") {
    registry.manifest = value;
  } else {
    const resource = Object.entries(registry.manifest.files ?? {})
      .find(([, compiledFile]) => compiledFile === fileName)?.[0];
    if (resource) registry.resources[resource] = value;
    for (const [field, manifestField] of [
      ["external_cards", "external_cards"],
      ["assets", "assets"],
      ["rules", "rules"],
      ["attributions", "attributions"],
      ["character_creation", "character_creation"],
    ]) {
      if (registry.manifest[manifestField] === fileName) registry[field] = value;
    }
  }
  fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
}

function writeSentences(root, sentences) {
  const packId = "cosyworld.core";
  const compiledSentences = sentences.map((sentence) => ({ ...sentence, pack_id: packId }));
  writeJson(root, "sentences.json", compiledSentences);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "worldpack.json"), "utf8"));
  for (const pack of manifest.packs) {
    pack.resource_counts.sentences = compiledSentences.filter(
      (sentence) => sentence.pack_id === pack.id,
    ).length;
  }
  writeJson(root, "worldpack.json", manifest);
}

function runChecker(root) {
  return spawnSync(process.execPath, [checkerPath, root], { encoding: "utf8" });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("worldpack progression access validation", () => {
  it("accepts the compiled official world", () => {
    const result = runChecker(worldpackFixture());

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("worldpack ok");
  });

  it("rejects an evolution item seeded behind an undeclared access gate", () => {
    const root = worldpackFixture();
    const items = JSON.parse(fs.readFileSync(path.join(root, "items.json"), "utf8"));
    items.find((item) => item.id === 2004).location_id = 10;
    writeJson(root, "items.json", items);

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "evolution track 1001 requirement item 2004 uses gated or unreachable location 10 without required_grant_id",
    );
  });

  it("rejects a recipe output placed behind an undeclared access gate", () => {
    const root = worldpackFixture();
    const recipes = JSON.parse(fs.readFileSync(path.join(root, "recipes.json"), "utf8"));
    recipes[0].output.target_id = 11;
    recipes[0].balance.target_id = 11;
    writeJson(root, "recipes.json", recipes);

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "recipe 3001 output uses gated or unreachable location 11 without required_grant_id",
    );
  });
});

describe("worldpack Manifest v1 validation", () => {
  it("rejects a compiled pack whose required capability is absent", () => {
    const root = worldpackFixture();
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "worldpack.json"), "utf8"));
    const campaign = manifest.packs.find(
      (pack) => pack.id === "cosyworld.campaign.the-lantern-keeper",
    );
    campaign.dependency_requirements[0].capabilities = ["cosyworld.core/missing"];
    writeJson(root, "worldpack.json", manifest);

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "requires missing capability cosyworld.core/missing from cosyworld.core@1.3.5",
    );
  });

  it("rejects an asset mount whose provider is unavailable", () => {
    const root = worldpackFixture();
    const assets = JSON.parse(fs.readFileSync(path.join(root, "assets.json"), "utf8"));
    assets[0].provider = "fixture.missing/assets";
    writeJson(root, "assets.json", assets);

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("has unavailable provider fixture.missing/assets");
  });

  it("rejects an entitlement authority whose provider is unavailable", () => {
    const root = worldpackFixture();
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "worldpack.json"), "utf8"));
    const gatedPack = manifest.packs.find((pack) => pack.entitlements?.authorities?.length);
    gatedPack.entitlements.authorities[0].provider = "fixture.missing/entitlements";
    writeJson(root, "worldpack.json", manifest);

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("has unavailable provider fixture.missing/entitlements");
  });

  it("rejects wallet identity embedded in a world item", () => {
    const root = worldpackFixture();
    const items = JSON.parse(fs.readFileSync(path.join(root, "items.json"), "utf8"));
    items[0].external_card_id = "wallet-copy-of-world-item";
    writeJson(root, "items.json", items);

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("wallet cards and entitlements must use card_bindings");
  });

  it("allows one external card to describe only one world entity", () => {
    const root = worldpackFixture();
    const bindings = JSON.parse(fs.readFileSync(path.join(root, "card_bindings.json"), "utf8"));
    bindings.push({
      ...bindings[0],
      id: "rati-card-duplicate-subject",
      entity_ref: "pack://cosyworld.core/actor/1002",
      subject_id: 1002,
      seed_card_id: "cosy-whiskerwind",
    });
    writeJson(root, "card_bindings.json", bindings);

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("external card rati binds more than one world entity");
  });
});

describe("worldpack authored relationships", () => {
  it("keeps the Heavens above Lofty Peak", () => {
    const exits = JSON.parse(fs.readFileSync(path.join(compiledWorldpackRoot, "exits.json"), "utf8"));

    expect(exits.find((exit) => exit.from_location_id === 30 && exit.to_location_id === 31)?.direction).toBe("down");
    expect(exits.find((exit) => exit.from_location_id === 31 && exit.to_location_id === 30)?.direction).toBe("up");
  });

  it("keeps the official shard dense without deleting unmounted source packs", () => {
    const world = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "v2/worlds/official/world.json"), "utf8"),
    );
    const locations = JSON.parse(fs.readFileSync(path.join(compiledWorldpackRoot, "locations.json"), "utf8"));
    const rules = JSON.parse(fs.readFileSync(path.join(compiledWorldpackRoot, "rules.json"), "utf8"));

    expect(world.packs).toEqual([
      "cosyworld.core",
      "cosyworld.rules-srd-5.1",
      "cosyworld.rules-srd-5.2.1",
      "cosyworld.rules-profile-srd5",
      "cosyworld.campaign.the-lantern-keeper",
      "cosyworld.the-holy-land",
      "cosyworld.lonely-forest.characters",
      "ruby-high.first-bell",
    ]);
    expect(locations).toHaveLength(48);
    expect(rules.map((bundle) => bundle.pack_id)).toEqual([
      "cosyworld.rules-srd-5.2.1",
      "cosyworld.rules-profile-srd5",
      "cosyworld.rules-srd-5.1",
    ]);

    for (const [directory, id] of [
      ["the-holy-land", "cosyworld.the-holy-land"],
      ["rules-srd-5.1", "cosyworld.rules-srd-5.1"],
      ["rules-srd-5.2.1", "cosyworld.rules-srd-5.2.1"],
    ]) {
      const packRoot = path.join(repoRoot, "v2/content", directory);
      const manifest = JSON.parse(fs.readFileSync(path.join(packRoot, "pack.json"), "utf8"));
      expect(manifest.id).toBe(id);
      for (const resource of Object.values({ ...manifest.resources, ...manifest.rules })) {
        expect(() => JSON.parse(fs.readFileSync(path.join(packRoot, resource), "utf8"))).not.toThrow();
      }
    }
  });

  it("ships the 27-line Left Sentences corpus across all five shelves", () => {
    const sentences = JSON.parse(
      fs.readFileSync(path.join(compiledWorldpackRoot, "sentences.json"), "utf8"),
    );

    expect(sentences).toHaveLength(27);
    expect(new Set(sentences.map((sentence) => sentence.shelf))).toEqual(new Set([
      "quiet-wing",
      "great-library",
      "restricted",
      "drowned",
      "hearth",
    ]));
    expect(sentences.filter((sentence) => sentence.pack_id === "cosyworld.core")).toHaveLength(21);
    expect(sentences.filter((sentence) => sentence.pack_id === "ruby-high.first-bell")).toHaveLength(6);
    expect(sentences.filter((sentence) => sentence.shelf === "hearth")).toHaveLength(3);
    expect(sentences.filter((sentence) => sentence.shelf === "hearth").every((sentence) => (
      sentence.weight === 1 && [1, 50, 64, 65].every((id) => sentence.location_ids.includes(id))
    ))).toBe(true);
  });
});

describe("worldpack writing register validation", () => {
  it("rejects banned tells in environment descriptions", () => {
    const root = worldpackFixture();
    const locations = JSON.parse(fs.readFileSync(path.join(root, "locations.json"), "utf8"));
    locations[0].description = "The kettle seems to approve of every arrival.";
    writeJson(root, "locations.json", locations);

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('uses banned environment tell "seems to"');
  });

  it("rejects second person outside the sentences register", () => {
    const root = worldpackFixture();
    const factions = JSON.parse(fs.readFileSync(path.join(root, "factions.json"), "utf8"));
    factions[0].doctrine = "Keep your promise.";
    writeJson(root, "factions.json", factions);

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("uses second person outside the sentences register");
  });

  it("rejects sentiment assigned to an item-use object", () => {
    const root = worldpackFixture();
    const features = JSON.parse(fs.readFileSync(path.join(root, "room_features.json"), "utf8"));
    features.find((feature) => feature.uses?.length).uses[0].text = "The tonic approves.";
    writeJson(root, "room_features.json", features);

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("use text assigns sentiment to an object");
  });

  it("allows second person in use-texts but rejects it in location descriptions", () => {
    const root = worldpackFixture();
    const features = JSON.parse(fs.readFileSync(path.join(root, "room_features.json"), "utf8"));
    features.find((feature) => feature.uses?.length).uses[0].text = "The tonic warms in your hand.";
    writeJson(root, "room_features.json", features);

    const passResult = runChecker(root);

    expect(passResult.status, passResult.stderr).toBe(0);
    expect(passResult.stdout).toContain("worldpack ok");

    const locations = JSON.parse(fs.readFileSync(path.join(root, "locations.json"), "utf8"));
    locations[0].description = "You see a warm hearth.";
    writeJson(root, "locations.json", locations);

    const failResult = runChecker(root);

    expect(failResult.status).toBe(1);
    expect(failResult.stderr).toContain("uses second person outside the sentences register");
  });

  it("exempts valid sentences from the world-prose register only", () => {
    const root = worldpackFixture();
    writeSentences(root, [{
      id: "quiet-wing/first",
      shelf: "quiet-wing",
      location_ids: [12],
      text: "You read as if the shelf remembers your name.",
      weight: 1,
    }]);

    const passResult = runChecker(root);

    expect(passResult.status, passResult.stderr).toBe(0);
    expect(passResult.stdout).toContain("worldpack ok");

    const locations = JSON.parse(fs.readFileSync(path.join(root, "locations.json"), "utf8"));
    locations[0].description = "You read as if the shelf remembers your name.";
    writeJson(root, "locations.json", locations);

    const failResult = runChecker(root);

    expect(failResult.status).toBe(1);
    expect(failResult.stderr).toContain('uses banned environment tell "as if"');
  });

  it("validates sentence ids, text, shelves, locations, and weights", () => {
    const root = worldpackFixture();
    writeSentences(root, [
      {
        id: "broken/entry",
        shelf: "moon-shelf",
        location_ids: [999999],
        text: "",
        weight: 0,
      },
      {
        id: "broken/entry",
        shelf: "hearth",
        location_ids: [1],
        text: "The kettle stayed warm.",
        weight: 1,
      },
    ]);

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sentences has missing or duplicate id broken/entry");
    expect(result.stderr).toContain("sentence broken/entry is missing text");
    expect(result.stderr).toContain("sentence broken/entry has invalid shelf moon-shelf");
    expect(result.stderr).toContain("sentence broken/entry references missing location 999999");
    expect(result.stderr).toContain("sentence broken/entry must declare a positive weight");
  });
});
