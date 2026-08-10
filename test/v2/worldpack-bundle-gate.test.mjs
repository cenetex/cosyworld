import crypto from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  candidateFromRegistry,
  evaluateWorldpackGate,
  resolveBaseUrl,
} from "../../v2/scripts/check-deploy-worldpack.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const gatePath = path.join(repoRoot, "v2/scripts/check-deploy-worldpack.mjs");
const compiledRegistryPath = path.join(
  repoRoot,
  "v2/content/official/registry.json",
);
const lanternRegistryPath = path.join(
  repoRoot,
  "v2/content/lantern-keeper/registry.json",
);
const elysiumRegistryPath = path.join(
  repoRoot,
  "v2/content/elysium-only/registry.json",
);

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

const LIVE_HASH = digest("live-journal-bundle");
const CANDIDATE_HASH = digest("candidate-bundle");
const OLDER_HASH = digest("older-declared-bundle");
const LANTERN_ACTIVE_HASH = "sha256:84f1b7deb52511a47f66e827b1edc13912a01f345d2468edf14bbcb8db5060bd";
const LANTERN_PERSISTED_HASH = "sha256:f16b48db1690307acb9861bc2d5005f143ec776060d98315dd95fa21befb7911";
const ELYSIUM_ACTIVE_HASH = "sha256:c70da6c7f66140154fcd8038a03b650ecad5edcb500f61b985299f698a28c548";
const ELYSIUM_PERSISTED_HASH = "sha256:f4579bd48d2dfb99498c1af83a9008702ce7f54dd2b036e446c98d38a991fbbf";

function registry(overrides = {}) {
  return {
    manifest: {
      bundle_hash: CANDIDATE_HASH,
      persistence_compatibility: {
        schema_version: 1,
        replay_compatible_bundle_hashes: [OLDER_HASH],
      },
      ...overrides,
    },
  };
}

describe("worldpack deploy gate evaluation", () => {
  it("passes when the candidate matches the live journal bundle", () => {
    const decision = evaluateWorldpackGate({
      candidateHash: LIVE_HASH,
      candidateReplayCompatible: [],
      liveHash: LIVE_HASH,
    });
    expect(decision).toMatchObject({ ok: true, status: "exact" });
  });

  it("passes when the candidate declares the live bundle replay-compatible", () => {
    const decision = evaluateWorldpackGate({
      candidateHash: CANDIDATE_HASH,
      candidateReplayCompatible: [OLDER_HASH, LIVE_HASH],
      liveHash: LIVE_HASH,
    });
    expect(decision).toMatchObject({ ok: true, status: "declared_migration" });
  });

  it("fails closed on an undeclared mismatch and names both hashes", () => {
    const decision = evaluateWorldpackGate({
      candidateHash: CANDIDATE_HASH,
      candidateReplayCompatible: [OLDER_HASH],
      liveHash: LIVE_HASH,
    });
    expect(decision.ok).toBe(false);
    expect(decision.status).toBe("incompatible");
    expect(decision.reason).toContain(CANDIDATE_HASH);
    expect(decision.reason).toContain(LIVE_HASH);
  });

  it("blocks a rollback across a migration boundary", () => {
    // The older bundle was authored before the live hash existed, so it
    // cannot declare it — the gate stops the rollback that would crash-loop.
    const decision = evaluateWorldpackGate({
      candidateHash: OLDER_HASH,
      candidateReplayCompatible: [],
      liveHash: LIVE_HASH,
    });
    expect(decision).toMatchObject({ ok: false, status: "incompatible" });
  });

  it("fails closed when the live app reports no usable bundle hash", () => {
    for (const liveHash of ["", "not-a-digest", undefined]) {
      const decision = evaluateWorldpackGate({
        candidateHash: CANDIDATE_HASH,
        candidateReplayCompatible: [LIVE_HASH],
        liveHash,
      });
      expect(decision).toMatchObject({ ok: false, status: "unverifiable" });
    }
  });
});

describe("candidate registry validation", () => {
  it("reads the bundle hash and declared compatibility list", () => {
    expect(candidateFromRegistry(registry())).toEqual({
      bundleHash: CANDIDATE_HASH,
      replayCompatible: [OLDER_HASH],
    });
  });

  it("accepts a manifest without declared compatibility", () => {
    const candidate = candidateFromRegistry({
      manifest: { bundle_hash: CANDIDATE_HASH },
    });
    expect(candidate.replayCompatible).toEqual([]);
  });

  it("rejects a manifest without a valid bundle hash", () => {
    expect(() => candidateFromRegistry({ manifest: {} })).toThrow(/bundle hash/);
    expect(() =>
      candidateFromRegistry({ manifest: { bundle_hash: "deadbeef" } }),
    ).toThrow(/bundle hash/);
  });

  it("rejects malformed declared hashes", () => {
    expect(() =>
      candidateFromRegistry(
        registry({
          persistence_compatibility: {
            replay_compatible_bundle_hashes: ["sha256:zzz"],
          },
        }),
      ),
    ).toThrow(/sha256 digest/);
  });
});

describe("target resolution", () => {
  it("maps fly app names to their fly.dev origin", () => {
    expect(resolveBaseUrl("cosyworld")).toBe("https://cosyworld.fly.dev");
    expect(resolveBaseUrl("cosyworld-lonelyforest")).toBe(
      "https://cosyworld-lonelyforest.fly.dev",
    );
  });

  it("keeps explicit base URLs and strips trailing slashes", () => {
    expect(resolveBaseUrl("https://lonelyforest.com/")).toBe(
      "https://lonelyforest.com",
    );
  });

  it("rejects missing or unsafe targets", () => {
    expect(() => resolveBaseUrl(undefined)).toThrow(/required/);
    expect(() => resolveBaseUrl("app;rm -rf")).toThrow(/base URL/);
  });
});

describe("worldpack deploy gate CLI", () => {
  let tempRoot;
  let registryPath;
  let metaPath;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "cosyworld-deploy-gate-"));
    registryPath = path.join(tempRoot, "registry.json");
    metaPath = path.join(tempRoot, "meta.json");
    await writeFile(registryPath, JSON.stringify(registry()));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  function runGate(extraArgs) {
    const result = spawnSync(
      process.execPath,
      [gatePath, "cosyworld", "--registry", registryPath, "--meta-file", metaPath, ...extraArgs],
      { encoding: "utf8" },
    );
    return {
      status: result.status,
      output: `${result.stdout}\n${result.stderr}`,
    };
  }

  async function writeMeta(bundleHash) {
    await writeFile(metaPath, JSON.stringify({ worldpack: { bundle_hash: bundleHash } }));
  }

  it("exits 0 when the candidate matches the live bundle", async () => {
    await writeMeta(CANDIDATE_HASH);
    const result = runGate([]);
    expect(result.status).toBe(0);
    expect(result.output).toContain("status=exact");
  });

  it("exits 0 with a notice for a declared migration", async () => {
    await writeMeta(OLDER_HASH);
    const result = runGate([]);
    expect(result.status).toBe(0);
    expect(result.output).toContain("status=declared_migration");
    expect(result.output).toContain("::notice::");
  });

  it("exits 1 on an undeclared mismatch and names both hashes and the remedy", async () => {
    await writeMeta(LIVE_HASH);
    const result = runGate([]);
    expect(result.status).toBe(1);
    expect(result.output).toContain(LIVE_HASH);
    expect(result.output).toContain(CANDIDATE_HASH);
    expect(result.output).toContain("v2/docs/worldpacks.md");
    expect(result.output).toContain("fresh-seed");
  });

  it("exits 1 when the live app reports no bundle hash", async () => {
    await writeMeta("");
    const result = runGate([]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("refusing to deploy blind");
  });

  it("exits 2 when the candidate registry is missing", () => {
    const result = spawnSync(
      process.execPath,
      [
        gatePath,
        "cosyworld",
        "--registry",
        path.join(tempRoot, "missing.json"),
        "--meta-file",
        metaPath,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(2);
    expect(`${result.stdout}\n${result.stderr}`).toContain("cannot read candidate registry");
  });

  it("exits 2 when the meta file cannot be read", () => {
    const result = runGate([]);
    expect(result.status).toBe(2);
    expect(result.output).toContain("--meta-file");
  });

  it("exits 2 without a target", () => {
    const result = spawnSync(
      process.execPath,
      [gatePath, "--registry", registryPath, "--meta-file", metaPath],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(2);
    expect(`${result.stdout}\n${result.stderr}`).toContain("usage:");
  });

  it("loads the committed official registry against its own declared history", () => {
    // The compiled bundle must always be able to state its own identity;
    // this catches a registry shape drift that would break the deploy gate.
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `import("node:fs").then(async (fs) => {
          const { candidateFromRegistry } = await import(${JSON.stringify(gatePath)});
          const registry = JSON.parse(fs.readFileSync(${JSON.stringify(compiledRegistryPath)}, "utf8"));
          const candidate = candidateFromRegistry(registry);
          console.log(candidate.bundleHash, candidate.replayCompatible.length);
        })`,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^sha256:[0-9a-f]{64} \d+$/);
  });

  it("accepts the exact deployed Lantern Keeper journal bundle migration", async () => {
    const registry = JSON.parse(await readFile(lanternRegistryPath, "utf8"));
    const candidate = candidateFromRegistry(registry);
    expect(candidate.bundleHash).toBe(LANTERN_ACTIVE_HASH);
    expect(candidate.replayCompatible).toContain(LANTERN_PERSISTED_HASH);
    expect(evaluateWorldpackGate({
      candidateHash: candidate.bundleHash,
      candidateReplayCompatible: candidate.replayCompatible,
      liveHash: LANTERN_PERSISTED_HASH,
    })).toMatchObject({ ok: true, status: "declared_migration" });
  });

  it("accepts the exact deployed Elysium journal bundle migration", async () => {
    const registry = JSON.parse(await readFile(elysiumRegistryPath, "utf8"));
    const candidate = candidateFromRegistry(registry);
    expect(candidate.bundleHash).toBe(ELYSIUM_ACTIVE_HASH);
    expect(candidate.replayCompatible).toContain(ELYSIUM_PERSISTED_HASH);
    expect(evaluateWorldpackGate({
      candidateHash: candidate.bundleHash,
      candidateReplayCompatible: candidate.replayCompatible,
      liveHash: ELYSIUM_PERSISTED_HASH,
    })).toMatchObject({ ok: true, status: "declared_migration" });
  });
});
