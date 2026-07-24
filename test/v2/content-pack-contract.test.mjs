import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveContentPackGraph,
  validateContentPackManifest,
  validateWorldEntityResource,
} from "../../v2/scripts/content-pack-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const compilerPath = path.join(repoRoot, "v2/scripts/compile-worldpack.mjs");

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
