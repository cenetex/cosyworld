import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveContentPackGraph,
  validateContentPackManifest,
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
    engine: ">=0.0.20 <0.1.0",
    capabilities: [{ id: `${id}/assets`, kind: "assets", version: "1.0.0" }],
    dependencies: [],
    provenance: { source_name: "contract test" },
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

  it("locks the exact official dependency closure, capabilities, IDs, and licenses", () => {
    const lock = JSON.parse(fs.readFileSync(
      path.join(repoRoot, "v2/worlds/official/pack.lock.json"),
      "utf8",
    ));
    expect(lock.manifest_contract).toBe("cosyworld.content-pack/1");
    expect(lock.canonical_id_mapping_version).toBe(1);
    expect(lock.dependency_order).toEqual(lock.packs.map((pack) => pack.id));
    expect(lock.license_records.map((record) => record.pack_id)).toEqual(lock.dependency_order);
    expect(lock.packs.every((pack) => (
      /^sha256:[0-9a-f]{64}$/.test(pack.integrity)
      && Array.isArray(pack.dependency_closure)
      && pack.capabilities.length > 0
    ))).toBe(true);
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
});
