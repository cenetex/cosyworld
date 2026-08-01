import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  packAcceptsRulesProfile,
  resolveContentPackGraph,
  rulesCompatibilityProfiles,
  validateContentPackManifest,
  validateWorldEntityResource,
} from "../../v2/scripts/content-pack-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const compilerPath = path.join(repoRoot, "v2/scripts/compile-worldpack.mjs");
const checkerPath = path.join(repoRoot, "v2/scripts/check-worldpack.mjs");

function manifest(id, overrides = {}) {
  return {
    schema_version: 1,
    id,
    name: id,
    version: "1.0.0",
    kind: "assets",
    description: `${id} fixture`,
    license: "MIT",
    license_url: "https://opensource.org/license/mit",
    engine: ">=0.0.20 <0.1.0",
    capabilities: [{ id: `${id}/assets`, kind: "assets", version: "1.0.0" }],
    dependencies: [],
    provenance: {
      author: "Contract Test",
      source_name: "contract test",
      source_url: "https://example.com/contract-test",
    },
    ...overrides,
  };
}

describe("Content Pack Manifest v1", () => {
  it("represents every authored source pack with the machine-readable contract", () => {
    const contentRoot = path.join(repoRoot, "v2/content");
    const manifests = fs.readdirSync(contentRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(contentRoot, entry.name, "pack.json"))
      .filter((filePath) => fs.existsSync(filePath));
    expect(manifests.length).toBeGreaterThan(0);
    for (const filePath of manifests) {
      const authored = JSON.parse(fs.readFileSync(filePath, "utf8"));
      expect(
        () => validateContentPackManifest(authored, path.relative(repoRoot, filePath)),
        filePath,
      ).not.toThrow();
    }
  });

  it("authors a versioned story question for every player-visible clock", () => {
    const allowedRhythms = new Set([
      "immediate",
      "session",
      "multi_session",
      "construction",
      "civic",
      "seasonal",
    ]);
    const allowedAttention = new Set([
      "immediate",
      "local",
      "communal",
      "background",
    ]);
    const clocks = [
      "v2/content/core/clocks.json",
      "v2/content/the-lantern-keeper/clocks.json",
    ].flatMap((relativePath) =>
      JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8")),
    );
    const visible = clocks.filter((clock) => clock.visible_to_players);
    expect(visible.length).toBeGreaterThan(0);
    const rhythms = new Set(visible.map((clock) => clock.presentation?.rhythm));
    for (const rhythm of ["session", "construction", "civic", "seasonal"]) {
      expect(rhythms.has(rhythm), rhythm).toBe(true);
    }
    for (const clock of visible) {
      expect(clock.presentation?.version, clock.id).toBe(1);
      expect(clock.presentation.question.trim(), clock.id).not.toBe("");
      expect(clock.presentation.situation.trim(), clock.id).not.toBe("");
      expect(clock.presentation.stakes.trim(), clock.id).not.toBe("");
      expect(clock.presentation.outcome.trim(), clock.id).not.toBe("");
      expect(clock.presentation.completion_memory.trim(), clock.id).not.toBe(
        "",
      );
      expect(allowedRhythms.has(clock.presentation.rhythm), clock.id).toBe(true);
      expect(allowedAttention.has(clock.presentation.attention), clock.id).toBe(
        true,
      );
      expect(clock.presentation.priority, clock.id).toBeGreaterThanOrEqual(0);
      expect(clock.presentation.priority, clock.id).toBeLessThanOrEqual(100);
    }
  });

  it("locks the exact official dependency closure, capabilities, IDs, and licenses", () => {
    const lock = JSON.parse(fs.readFileSync(
      path.join(repoRoot, "v2/worlds/official/pack.lock.json"),
      "utf8",
    ));
    expect(lock.manifest_contract).toBe("cosyworld.content-pack/1");
    expect(lock.canonical_id_mapping_version).toBe(1);
    expect(lock.dependency_order).toEqual(lock.packs.map((pack) => pack.id));
    expect(lock.license_records.map((record) => record.pack_id)).toEqual(lock.dependency_order);
    expect(lock.license_records.every((record) => (
      record.license_identifier
      && record.license_url.startsWith("https://")
      && record.provenance.author
      && Array.isArray(record.notices)
    ))).toBe(true);
    const lantern = lock.license_records.find(
      (record) => record.pack_id === "cosyworld.campaign.the-lantern-keeper",
    );
    expect(lantern.provenance.modification_notice).toMatch(/SRD 5\.1/);
    expect(lantern.notices[0].text).toContain("System Reference Document 5.1");
    expect(lantern.notices[0].text).toContain(
      "creativecommons.org/licenses/by/4.0/legalcode",
    );
    expect(lock.packs.every((pack) => (
      /^sha256:[0-9a-f]{64}$/.test(pack.integrity)
      && Array.isArray(pack.dependency_closure)
      && pack.capabilities.length > 0
    ))).toBe(true);
  });

  it("requires complete license and provenance coordinates", () => {
    expect(() => validateContentPackManifest(manifest("fixture.no-license-url", {
      license_url: undefined,
    }))).toThrow(/license_url/);
    expect(() => validateContentPackManifest(manifest("fixture.no-author", {
      provenance: {
        source_name: "contract test",
        source_url: "https://example.com/contract-test",
      },
    }))).toThrow(/author/);
  });

  it("rejects unknown fields but preserves namespaced extensions", () => {
    expect(() => validateContentPackManifest(manifest("fixture.valid", {
      extensions: { "x-fixture.note": { useful: true } },
    }))).not.toThrow();
    expect(() => validateContentPackManifest(manifest("fixture.invalid", {
      surprise: true,
    }))).toThrow(/additional properties/);
  });

  it("requires dedicated composition bridges for cross-pack paths", () => {
    const bridge = manifest("fixture.bridge", {
      kind: "world",
      capabilities: [
        { id: "fixture.bridge/world", kind: "world", version: "1.0.0" },
      ],
      dependencies: [
        {
          id: "fixture.left",
          version: ">=1.0.0 <2.0.0",
          capabilities: ["fixture.left/world"],
        },
        {
          id: "fixture.right",
          version: ">=1.0.0 <2.0.0",
          capabilities: ["fixture.right/world"],
        },
      ],
      default_ruleset: null,
      entry_points: [],
      resources: { exits: "exits.json" },
      extensions: {
        "x-cosyworld-composition": {
          schema_version: 1,
          role: "bridge",
        },
      },
    });
    expect(() => validateContentPackManifest(bridge)).not.toThrow();
    expect(() => validateContentPackManifest({
      ...bridge,
      resources: { exits: "exits.json", actors: "actors.json" },
    })).toThrow(/may contain only exits or hidden_exits/);
  });

  it("treats rules_profile as a legacy one-profile compatibility alias", () => {
    const legacy = manifest("fixture.legacy", {
      rules_profile: "cosyworld.srd5/1",
    });
    expect(rulesCompatibilityProfiles(legacy)).toEqual(["cosyworld.srd5/1"]);
    expect(packAcceptsRulesProfile(legacy, "cosyworld.srd5/1")).toBe(true);
    expect(packAcceptsRulesProfile(legacy, "fixture.commons/1")).toBe(false);

    const explicit = manifest("fixture.explicit", {
      rules_compatibility: {
        profiles: ["cosyworld.srd5/1", "fixture.commons/1"],
      },
    });
    expect(() => validateContentPackManifest(explicit)).not.toThrow();
    expect(rulesCompatibilityProfiles(explicit)).toEqual([
      "cosyworld.srd5/1",
      "fixture.commons/1",
    ]);
    expect(packAcceptsRulesProfile(explicit, "fixture.commons/1")).toBe(true);

    expect(() => validateContentPackManifest({
      ...explicit,
      rules_profile: "cosyworld.srd5/1",
    })).toThrow(/legacy one-profile alias/);
  });

  it("pins the current cosyworld.srd5 profile action declaration as a fixture", () => {
    const actions = JSON.parse(fs.readFileSync(
      path.join(repoRoot, "v2/content/rules-profile-srd5/actions.json"),
      "utf8",
    ));
    expect(actions.map((action) => action.id).sort()).toEqual([
      "srd5.2.1:attack",
      "srd5.2.1:dash",
      "srd5.2.1:disengage",
      "srd5.2.1:dodge",
      "srd5.2.1:help",
      "srd5.2.1:hide",
      "srd5.2.1:influence",
      "srd5.2.1:magic",
      "srd5.2.1:ready",
      "srd5.2.1:search",
      "srd5.2.1:study",
      "srd5.2.1:utilize",
    ]);
  });

  it("compiles a different selected profile and rejects mismatches consistently", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cosyworld-rules-profile-"));
    const contentRoot = path.join(root, "content");
    const worldDir = path.join(root, "worlds/core-only");
    const sharedWorldDir = path.join(root, "worlds/shared");
    const outputDir = path.join(contentRoot, "compiled");
    const fixtureProfile = "fixture.commons/1";
    const incompatibleProfile = "fixture.other/1";
    const fixtureProvider = "fixture.rules-profile-commons";
    const sourceContentRoot = path.join(repoRoot, "v2/content");
    const sourceWorldDir = path.join(repoRoot, "v2/worlds/core-only");
    const writeJson = (filePath, value) => {
      fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
    };
    const compile = () => spawnSync(process.execPath, [
      compilerPath,
      "--world-dir",
      worldDir,
      "--content-root",
      contentRoot,
      "--output-dir",
      outputDir,
      "--write-lock",
    ], { cwd: repoRoot, encoding: "utf8" });

    try {
      fs.mkdirSync(contentRoot, { recursive: true });
      fs.mkdirSync(worldDir, { recursive: true });
      fs.mkdirSync(sharedWorldDir, { recursive: true });
      for (const directory of ["core", "rules-srd-5.2.1"]) {
        fs.cpSync(
          path.join(sourceContentRoot, directory),
          path.join(contentRoot, directory),
          { recursive: true },
        );
      }
      fs.cpSync(
        path.join(sourceContentRoot, "rules-profile-srd5"),
        path.join(contentRoot, "rules-profile-commons"),
        { recursive: true },
      );
      fs.copyFileSync(
        path.join(sourceWorldDir, "world.json"),
        path.join(worldDir, "world.json"),
      );
      const lock = JSON.parse(fs.readFileSync(
        path.join(sourceWorldDir, "pack.lock.json"),
        "utf8",
      ));
      const lockedProvider = lock.packs.find(
        (pack) => pack.id === "cosyworld.rules-profile-srd5",
      );
      lockedProvider.id = fixtureProvider;
      lockedProvider.source.path = "../../content/rules-profile-commons";
      writeJson(path.join(worldDir, "pack.lock.json"), lock);
      fs.copyFileSync(
        path.join(repoRoot, "v2/worlds/shared/cozy-fantasy-avatar-naming.json"),
        path.join(sharedWorldDir, "cozy-fantasy-avatar-naming.json"),
      );
      fs.mkdirSync(path.join(root, "worlds/official"), { recursive: true });
      fs.copyFileSync(
        path.join(repoRoot, "v2/worlds/official/first-tale.json"),
        path.join(root, "worlds/official/first-tale.json"),
      );

      const worldPath = path.join(worldDir, "world.json");
      const corePackPath = path.join(contentRoot, "core/pack.json");
      const rulesPackPath = path.join(contentRoot, "rules-profile-commons/pack.json");
      const profilesPath = path.join(contentRoot, "rules-profile-commons/profiles.json");
      const actionsPath = path.join(contentRoot, "rules-profile-commons/actions.json");
      const conformancePath = path.join(contentRoot, "rules-profile-commons/conformance.json");
      const world = JSON.parse(fs.readFileSync(worldPath, "utf8"));
      const corePack = JSON.parse(fs.readFileSync(corePackPath, "utf8"));
      const rulesPack = JSON.parse(fs.readFileSync(rulesPackPath, "utf8"));
      const profiles = JSON.parse(fs.readFileSync(profilesPath, "utf8"));
      const actions = JSON.parse(fs.readFileSync(actionsPath, "utf8"))
        .filter((action) => action.id !== "srd5.2.1:dash");
      const conformance = JSON.parse(fs.readFileSync(conformancePath, "utf8"))
        .filter((row) => row.action_id !== "srd5.2.1:dash");

      world.rules_profile = fixtureProfile;
      world.packs = world.packs.map((packId) => (
        packId === "cosyworld.rules-profile-srd5" ? fixtureProvider : packId
      ));
      delete corePack.rules_profile;
      corePack.rules_compatibility = {
        profiles: ["cosyworld.srd5/1", fixtureProfile],
      };
      corePack.dependencies[0].id = fixtureProvider;
      corePack.dependencies[0].capabilities = [`${fixtureProvider}/rules`];
      rulesPack.id = fixtureProvider;
      rulesPack.name = "Fixture Commons Rules Profile";
      rulesPack.capabilities[0].id = `${fixtureProvider}/rules`;
      rulesPack.rules_profile = fixtureProfile;
      profiles[0].id = fixtureProfile;
      writeJson(worldPath, world);
      writeJson(corePackPath, corePack);
      writeJson(rulesPackPath, rulesPack);
      writeJson(profilesPath, profiles);
      writeJson(actionsPath, actions);
      writeJson(conformancePath, conformance);

      const selected = compile();
      expect(selected.status, selected.stderr).toBe(0);
      const compiled = JSON.parse(fs.readFileSync(
        path.join(outputDir, "worldpack.json"),
        "utf8",
      ));
      expect(compiled.rules_profile).toBe(fixtureProfile);
      expect(compiled.packs.find((pack) => pack.id === "cosyworld.core")?.rules_compatibility)
        .toEqual({ profiles: ["cosyworld.srd5/1", fixtureProfile] });
      const check = spawnSync(process.execPath, [checkerPath, outputDir], {
        cwd: repoRoot,
        encoding: "utf8",
      });
      expect(check.status, check.stderr).toBe(0);

      corePack.rules_compatibility = { profiles: [incompatibleProfile] };
      writeJson(corePackPath, corePack);
      const incompatible = compile();
      expect(incompatible.status).not.toBe(0);
      expect(incompatible.stderr).toContain(fixtureProfile);
      expect(incompatible.stderr).toContain(incompatibleProfile);

      corePack.rules_compatibility = { profiles: [fixtureProfile] };
      writeJson(corePackPath, corePack);
      writeJson(conformancePath, conformance.slice(1));
      const incomplete = compile();
      expect(incomplete.status).not.toBe(0);
      expect(incomplete.stderr).toMatch(/conformance matrix must cover every action/);

      writeJson(conformancePath, conformance);
      corePack.rules_compatibility = {
        profiles: ["cosyworld.srd5/1", fixtureProfile],
      };
      writeJson(corePackPath, corePack);
      world.rules_profile = "cosyworld.srd5/1";
      writeJson(worldPath, world);
      const wrongWorld = compile();
      expect(wrongWorld.status).not.toBe(0);
      expect(wrongWorld.stderr).toContain(fixtureProvider);
      expect(wrongWorld.stderr).toContain(fixtureProfile);
      expect(wrongWorld.stderr).toContain("cosyworld.srd5/1");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("types pack and zone rules selectors and rejects equal-precedence conflicts", () => {
    const rulesManifest = manifest("fixture.world", {
      kind: "world",
      capabilities: [
        { id: "fixture.world/world", kind: "world", version: "1.0.0" },
        { id: "fixture.world/rules", kind: "rules", version: "1.0.0" },
      ],
      default_ruleset: "fixture.world/rules",
      extensions: {
        "x-cosyworld-rules-context": {
          schema_version: 1,
          zones: [{ zone: "sanctuary", ruleset: "fixture.world/rules" }],
        },
      },
    });
    expect(() => validateContentPackManifest(rulesManifest)).not.toThrow();
    expect(() => validateWorldEntityResource("fixture.world", "locations", {
      id: 1,
      ruleset: "fixture.world/rules",
      name: "Rules Room",
    })).not.toThrow();
    expect(() => validateContentPackManifest({
      ...rulesManifest,
      extensions: {
        "x-cosyworld-rules-context": {
          schema_version: 1,
          zones: [
            { zone: "sanctuary", ruleset: "fixture.world/rules" },
            { zone: "sanctuary", ruleset: "fixture.world/rules" },
          ],
        },
      },
    })).toThrow(/repeats zone sanctuary/);
    expect(() => validateContentPackManifest({
      ...rulesManifest,
      extensions: {
        "x-cosyworld-rules-context": {
          schema_version: 1,
          zones: [{ zone: "frontier", ruleset: "fixture.other/rules" }],
        },
      },
    })).toThrow(/not provided or required/);
  });

  it("requires asset mounts to name a declared asset provider", () => {
    expect(() => validateContentPackManifest(manifest("fixture.assets", {
      assets: [{
        provider: "fixture.assets/assets",
        mount: "cards",
        directory: "assets/cards",
        public_prefix: "/assets/fixture/cards",
        optional: true,
      }],
    }))).not.toThrow();
    expect(() => validateContentPackManifest(manifest("fixture.missing-provider", {
      assets: [{
        mount: "cards",
        directory: "assets/cards",
        public_prefix: "/assets/fixture/cards",
        optional: true,
      }],
    }))).toThrow(/required property 'provider'/);
    expect(() => validateContentPackManifest(manifest("fixture.wrong-provider", {
      assets: [{
        provider: "fixture.other/assets",
        mount: "cards",
        directory: "assets/cards",
        public_prefix: "/assets/fixture/cards",
        optional: true,
      }],
    }))).toThrow(/unavailable provider fixture\.other\/assets/);
  });

  it("requires entitlement authorities to name a declared entitlement provider", () => {
    const entitlements = {
      schema_version: 1,
      authorities: [{
        provider: "fixture.entitled/entitlements",
        id: "private-set",
        type: "signed_set",
        algorithm: "ed25519",
        public_key: "11111111111111111111111111111111",
      }],
      grants: [{ id: "fixture.entitled:library", authority_id: "private-set" }],
    };
    const capabilities = [
      { id: "fixture.entitled/assets", kind: "assets", version: "1.0.0" },
      { id: "fixture.entitled/entitlements", kind: "entitlements", version: "1.0.0" },
    ];
    expect(() => validateContentPackManifest(manifest("fixture.entitled", {
      capabilities,
      entitlements,
    }))).not.toThrow();
    expect(() => validateContentPackManifest(manifest("fixture.entitled", {
      capabilities,
      entitlements: {
        ...entitlements,
        authorities: [{ ...entitlements.authorities[0], provider: "fixture.other/entitlements" }],
      },
    }))).toThrow(/unavailable provider fixture\.other\/entitlements/);
  });

  it("keeps wallet identity fields out of authoritative world entities", () => {
    expect(() => validateWorldEntityResource("fixture.world", "actors", {
      id: 1,
      name: "Ada",
      speech_mode: "server_authored",
      title: "Keeper",
      description: "Keeps the local truth.",
      external_card_id: "ada-wallet-card",
    })).toThrow(/wallet cards and entitlements must use card_bindings/);
    expect(() => validateWorldEntityResource("fixture.world", "items", {
      id: 2,
      name: "Brass Key",
      description: "A shard-local key.",
      kind: "keepsake",
      charges: 1,
      location_id: 1,
      wallet_asset_id: "portable-key",
    })).toThrow(/unknown field wallet_asset_id/);
  });

  it("allows authored actor goals in authoritative world entities", () => {
    expect(() => validateWorldEntityResource("fixture.world", "actors", {
      id: 1,
      name: "Ada",
      speech_mode: "prose",
      title: "Seeker",
      description: "Follows a difficult road.",
      goals: [{
        objective: "Find the missing guide.",
        motivation: "She needs an answer only the guide can give.",
      }],
    })).not.toThrow();
  });

  it("resolves dependencies in deterministic topological order", () => {
    const base = manifest("fixture.base");
    const feature = manifest("fixture.feature", {
      dependencies: [{
        id: "fixture.base",
        version: ">=1.0.0 <2.0.0",
        capabilities: ["fixture.base/assets"],
      }],
    });

    const forward = resolveContentPackGraph([base, feature], "0.0.39");
    const reverse = resolveContentPackGraph([feature, base], "0.0.39");
    expect(forward.ordered.map((pack) => pack.id)).toEqual(["fixture.base", "fixture.feature"]);
    expect(reverse.ordered.map((pack) => pack.id)).toEqual(["fixture.base", "fixture.feature"]);
    expect(reverse.dependencyClosure.get("fixture.feature")).toEqual(["fixture.base"]);
  });

  it("reports dependency cycles with the complete path", () => {
    const left = manifest("fixture.left", {
      dependencies: [{
        id: "fixture.right",
        version: "1.0.0",
        capabilities: ["fixture.right/assets"],
      }],
    });
    const right = manifest("fixture.right", {
      dependencies: [{
        id: "fixture.left",
        version: "1.0.0",
        capabilities: ["fixture.left/assets"],
      }],
    });
    expect(() => resolveContentPackGraph([right, left], "0.0.39"))
      .toThrow(/dependency cycle fixture\.left -> fixture\.right -> fixture\.left/);
  });

  it("fails missing capabilities and incompatible engine ranges with pack context", () => {
    const base = manifest("fixture.base");
    const feature = manifest("fixture.feature", {
      dependencies: [{
        id: "fixture.base",
        version: ">=1.0.0 <2.0.0",
        capabilities: ["fixture.base/world"],
      }],
    });
    expect(() => resolveContentPackGraph([feature, base], "0.0.39"))
      .toThrow(/fixture\.feature@1\.0\.0 requires missing capability fixture\.base\/world/);
    expect(() => resolveContentPackGraph([
      manifest("fixture.future", { engine: ">=1.0.0 <2.0.0" }),
    ], "0.0.39")).toThrow(/fixture\.future@1\.0\.0 requires engine/);
  });

  it("fails missing dependencies and incompatible mounted pack versions", () => {
    const dependency = {
      id: "fixture.base",
      version: ">=2.0.0 <3.0.0",
      capabilities: ["fixture.base/assets"],
    };
    const feature = manifest("fixture.feature", { dependencies: [dependency] });
    expect(() => resolveContentPackGraph([feature], "0.0.39"))
      .toThrow(/fixture\.feature@1\.0\.0 is missing dependency fixture\.base/);
    expect(() => resolveContentPackGraph([
      manifest("fixture.base"),
      feature,
    ], "0.0.39")).toThrow(/requires fixture\.base >=2\.0\.0 <3\.0\.0, mounted 1\.0\.0/);
  });

  it("rejects duplicate declarations before compilation", () => {
    expect(() => validateContentPackManifest(manifest("fixture.local", {
      capabilities: [
        { id: "fixture.local/assets", kind: "assets", version: "1.0.0" },
        { id: "fixture.local/assets", kind: "assets", version: "1.0.0" },
      ],
    }))).toThrow(/duplicate capability declaration fixture\.local\/assets/);
    expect(() => resolveContentPackGraph([
      manifest("fixture.one", {
        capabilities: [{ id: "fixture.shared/assets", kind: "assets", version: "1.0.0" }],
      }),
      manifest("fixture.two", {
        capabilities: [{ id: "fixture.shared/assets", kind: "assets", version: "1.0.0" }],
      }),
    ], "0.0.39")).toThrow(/duplicate capability fixture\.shared\/assets/);
    expect(() => resolveContentPackGraph([
      manifest("fixture.same"),
      manifest("fixture.same"),
    ], "0.0.39")).toThrow(/duplicate pack declaration fixture\.same/);
  });

  it("emits byte-identical artifact digests for identical inputs", () => {
    const run = () => spawnSync(process.execPath, [compilerPath, "--check", "--artifact-digest"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    const first = run();
    const second = run();
    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    expect(first.stdout).toBe(second.stdout);
    expect(first.stdout).toMatch(/artifact digest sha256:[0-9a-f]{64}/);
  });

  it("locks every production journal epoch declared safe for replay", () => {
    const authoredWorld = JSON.parse(fs.readFileSync(
      path.join(repoRoot, "v2/worlds/official/world.json"),
      "utf8",
    ));
    expect(
      authoredWorld.persistence_compatibility.replay_compatible_bundle_hashes,
    ).toEqual([
      "sha256:1e74056abb3b5ffadf78a0f5b4ec62b511c2a727c216c0b7bd1a6cd3ca7b04f1",
      "sha256:a613a3ec525fc08e10794a775ee0baeb9239733da1c65779ab4dc1df481f9718",
      "sha256:0a1129ce8f3315946c972bb3e5f5a6e4b3f65cb7dac7d1ea3fe441f398c84d32",
      "sha256:2a9b9fb5c049a0b06dcd02131e2b74be5f5e106e6e8d78b891e40f7b093eb49a",
      "sha256:338f4d9a5eefc75d832f7cc48c40600263dc49c89a2e6aa7365ea0d6a361d960",
      "sha256:388e3aff0bd03abc7b5362bc17323f097784d61c8b15f0b0206aa46500c16ad3",
      "sha256:3a06264db7ff974bf3ff94cb60bc74e5e9e7dd3e52dfc82024140d81b0d2d997",
      "sha256:3bcecba1646a5fd6c0d1c2c0c435a35b58f1910ac50a0ea3422245fe78a22802",
      "sha256:499302d175bf38df6eadf7810afea8f98b039bead76cc27f0383c490ae668672",
      "sha256:609b2c2ab823e073450c2477cbc885d8d2c327c7cf443bc8c772a20c9f43b101",
      "sha256:b424bcf3b79f15d59afed4848c13c7f7c4ecb59098f1f0ada430da7f9412e37a",
      "sha256:c97e16400c0aee830e0b1823120b6a8820601e9a476a22d1a8a2fa68c57caa1f",
      "sha256:cddcbb74cab94750ce403037ca22b0dcf2fb4972fdc2668ddf8c9a6f95957655",
      "sha256:d68f40900aeb645e99cbdca92fe4e9ac90460c3ad8b1445e36caaf258d9a20bb",
      "sha256:df51e114ca12face0fc9aa97516826e350792db5937209b6f441df0675a0e691",
      "sha256:f97d77e008a46d79d9c9d83e607b257a16ef66d591b037297495b99f21fdafa5",
      "sha256:226996ee96150505c53df2a999297e8c5fa771b0dd81e6d03eb82e62daccc290",
      "sha256:b6060bef1242f551185ad54fbadf284f55980b6aecfe9a8f490a1467b6a23171",
      "sha256:aca13f4075a97d37ffb13c6626eb6247793a87e6f76ac217a84e417c07b687ff",
      "sha256:fd5012d745f00283c16bea59c0d014393dd064e9751c7728b0e2e6ba6a39690c",
      "sha256:02147a6629b038e2e9a28039f829bc6ad67881fe3391a0edabf744fd362427df",
      "sha256:ef70c61617e4c6f6cf905f049dddbb053e84b520f545ed2d01b3180cf39d75d1",
      "sha256:f5cd5ce7a1bb8447811afd5af6a6d31d4709a4f6ee1988a77fc254111d572f17",
      "sha256:5b66ce6369fbf04814b2812f30c5e5940bf6b08100f2aa4bf87be5ddd8d58ecc",
      "sha256:aa077d2657f65b1258f26101d0fd65c6bb672efdf688bc21b28334cd4352d628",
      "sha256:9e91a900766633f5f52b8fe58e8f409f020233553e3fe5bf24ff519553e972ac",
      "sha256:b9103b7cf66349cf12db45170c3b8f9cdaaaf1a1fc6aed95a98fb47c553ef62d",
      "sha256:7c25a5ffcec350dba6f9211c3e2866ad4c9bc77173b415e46e023214242eb1fe",
      "sha256:3e6c6a329d1b0ffd28cbc1fe138edd5825185fe0c29ad20af9b9d14c552e11d9",
      "sha256:9b955ecb68da8efde6e6f598ce73754c1377fde0ce2c21a72852d9d641ada836",
      "sha256:94464a2d997bfa589f39091a6644444f879b8f1a3a3e81c054951ba51b153170",
      "sha256:a4e8e14c025ceed0247a3e475d51399496cbad6ff386d8eccea93572fe704f7a",
      "sha256:54cdcd2ed0d23a8a1f216bf6240035d7f6cf312a910e5e10b2a323d39ac1a333",
      "sha256:936fb16d280df4e073056c41c6c81034162b4407012ae2dbc9302813d31948df",
      "sha256:fea970b0cdbb1266e4fd20bbec60ed2ff48bb8feb36a799ebd558700a7f83028",
      "sha256:531f773526919ce1da0b8713401ebf60e900f2a906f790ba9a443c6809fed0fa",
      "sha256:f760e930ed3fc83d1e363e1e10bbe7dd4e08ae7b981f8316907fcd63682cff55",
      "sha256:50205c5d58ef8e556744f5c383018ef1e2c440a7df2784ba013ecf75523d8f9f",
      "sha256:9576956c1e4e526044e6bf67996d18ada8a52f140be77ea25d763b2f386dc790",
    ]);
  });

  it("keeps persistence migration policy outside the content bundle identity", () => {
    const officialWorldDir = path.join(repoRoot, "v2/worlds/official");
    const authoredWorld = JSON.parse(fs.readFileSync(
      path.join(officialWorldDir, "world.json"),
      "utf8",
    ));
    const authoredLock = JSON.parse(fs.readFileSync(
      path.join(officialWorldDir, "pack.lock.json"),
      "utf8",
    ));
    const compile = (world) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "cosyworld-persistence-policy-"));
      const worldDir = path.join(root, "world");
      const outputDir = path.join(root, "output");
      fs.mkdirSync(worldDir, { recursive: true });
      const lock = structuredClone(authoredLock);
      for (const pack of lock.packs) {
        pack.source.path = path.resolve(officialWorldDir, pack.source.path);
      }
      fs.writeFileSync(path.join(worldDir, "world.json"), JSON.stringify(world, null, 2));
      fs.writeFileSync(path.join(worldDir, "pack.lock.json"), JSON.stringify(lock, null, 2));
      if (typeof world.avatar_naming === "string") {
        const namingTarget = path.resolve(worldDir, world.avatar_naming);
        fs.mkdirSync(path.dirname(namingTarget), { recursive: true });
        fs.copyFileSync(
          path.resolve(officialWorldDir, world.avatar_naming),
          namingTarget,
        );
      }
      if (typeof world.first_tale === "string") {
        const firstTaleTarget = path.resolve(worldDir, world.first_tale);
        fs.mkdirSync(path.dirname(firstTaleTarget), { recursive: true });
        fs.copyFileSync(
          path.resolve(officialWorldDir, world.first_tale),
          firstTaleTarget,
        );
      }
      const result = spawnSync(process.execPath, [
        compilerPath,
        "--world-dir",
        worldDir,
        "--output-dir",
        outputDir,
      ], { cwd: repoRoot, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      const compiled = JSON.parse(fs.readFileSync(
        path.join(outputDir, "worldpack.json"),
        "utf8",
      ));
      fs.rmSync(root, { recursive: true, force: true });
      return compiled;
    };

    const withoutPolicy = structuredClone(authoredWorld);
    delete withoutPolicy.persistence_compatibility;
    const baseline = compile(withoutPolicy);
    const withPolicy = compile(authoredWorld);

    expect(withPolicy.bundle_hash).toBe(baseline.bundle_hash);
    expect(withPolicy.persistence_compatibility).toEqual(
      authoredWorld.persistence_compatibility,
    );
  });
});
