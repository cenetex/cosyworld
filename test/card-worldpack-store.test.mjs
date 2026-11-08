// Worldpack store gate regression tests.
//
// These reproduce the review probes on PR #2129: a gate that only checked the
// vendored hash, while the manifest and the published assets drifted, was
// passing checks that should have failed. Each test mutates one thing in a
// temp copy of the store and requires `build-card-store.mjs --check` (run
// against the temp tree) to fail, or requires the specific pass behavior.
//
// The tests point the script at a sandbox by copying v2/worldpacks plus the
// two compiled inputs the script reads (worlds/card-table.json and the
// pack-schema import chain) — heavy but hermetic; CI runs it as one file.
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repoRoot, "v2", "scripts", "build-card-store.mjs");

let sandbox;

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "worldpack-store-test-"));
  // The script resolves v2 from its own location; instead of copying the whole
  // tree, we copy the script into the sandbox's v2/scripts and bring the
  // pieces it reads. pack-schema.mjs imports siblings by relative path, so
  // the card-game directory must be complete enough to import.
  fs.mkdirSync(path.join(dir, "v2", "scripts"), { recursive: true });
  fs.cpSync(path.join(repoRoot, "v2", "card-game"), path.join(dir, "v2", "card-game"), { recursive: true });
  fs.cpSync(path.join(repoRoot, "v2", "worldpacks"), path.join(dir, "v2", "worldpacks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "v2", "worlds"), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "v2", "worlds", "card-table.json"), path.join(dir, "v2", "worlds", "card-table.json"));
  fs.copyFileSync(script, path.join(dir, "v2", "scripts", "build-card-store.mjs"));
  // assets dir (published copy) + docs are not read by the script except the
  // published assets comparison, which reads v2/card-game/assets (copied).
  return dir;
}

function runCheck(dir) {
  return run(dir, ["--check"]);
}

function run(dir, args) {
  try {
    execFileSync("node", [path.join(dir, "v2", "scripts", "build-card-store.mjs"), ...args], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output: "" };
  } catch (e) {
    return { ok: false, output: String(e.stderr || e.stdout || e.message) };
  }
}

const storePath = (dir) => path.join(dir, "v2", "worldpacks", "store.json");
const manifestPath = (dir) => path.join(dir, "v2", "worldpacks", "vendor-manifest.json");

function writeStore(dir, store) {
  fs.writeFileSync(storePath(dir), JSON.stringify(store, null, 2) + "\n");
}

function payloadHash(dir, id) {
  const base = path.join(dir, "v2", "worldpacks", id);
  const files = ["card-world.json", "card-bridge.json"];
  const assets = path.join(base, "assets");
  if (fs.existsSync(assets))
    for (const name of fs.readdirSync(assets).sort()) files.push(`assets/${name}`);
  const h = crypto.createHash("sha256");
  for (const rel of files) {
    const bytes = fs.readFileSync(path.join(base, rel));
    h.update(`${rel}\n${bytes.length}\n${crypto.createHash("sha256").update(bytes).digest("hex")}\n`);
  }
  return h.digest("hex");
}

beforeEach(() => {
  sandbox = makeSandbox();
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("worldpack store gate", () => {
  it("passes on the committed store (nothing drifted)", () => {
    const r = runCheck(sandbox);
    expect(r.ok, r.output).toBe(true);
  });

  it("fails when the vendored payload is tampered with", () => {
    const world = path.join(sandbox, "v2", "worldpacks", "warren", "card-world.json");
    const bytes = fs.readFileSync(world, "utf8");
    fs.writeFileSync(world, bytes.replace("the", "teh"));
    const r = runCheck(sandbox);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/does not match the pin/);
  });

  it("fails when a published asset drifts from the vendored copy", () => {
    const published = path.join(sandbox, "v2", "card-game", "assets", "warren", "threshold.png");
    const bytes = fs.readFileSync(published);
    bytes[bytes.length - 1] ^= 0xff;
    fs.writeFileSync(published, bytes);
    const r = runCheck(sandbox);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/published asset differs/);
  });

  it("fails when a published asset is stale (not in the vendored pack)", () => {
    const publishedDir = path.join(sandbox, "v2", "card-game", "assets", "warren");
    fs.writeFileSync(path.join(publishedDir, "smuggled.png"), Buffer.alloc(64, 7));
    const r = runCheck(sandbox);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/stale published asset/);
  });

  it("fails when a published asset goes missing", () => {
    fs.rmSync(path.join(sandbox, "v2", "card-game", "assets", "warren", "sifter.png"));
    const r = runCheck(sandbox);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/published asset missing/);
  });

  it("fails when the manifest loses a pack the index still has", () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath(sandbox), "utf8"));
    manifest.packs = [];
    fs.writeFileSync(manifestPath(sandbox), JSON.stringify(manifest, null, 2) + "\n");
    const r = runCheck(sandbox);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/vendor-manifest\.json does not match/);
  });

  it("fails when the manifest carries a stale pin", () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath(sandbox), "utf8"));
    manifest.packs[0].pinned.sha256 = "0".repeat(64);
    fs.writeFileSync(manifestPath(sandbox), JSON.stringify(manifest, null, 2) + "\n");
    const r = runCheck(sandbox);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/vendor-manifest\.json does not match/);
  });

  it("fails when the manifest gains a pack the index dropped", () => {
    const store = JSON.parse(fs.readFileSync(storePath(sandbox), "utf8"));
    const manifest = JSON.parse(fs.readFileSync(manifestPath(sandbox), "utf8"));
    // index empties, manifest keeps the pack
    store.packs = [];
    writeStore(sandbox, store);
    fs.writeFileSync(manifestPath(sandbox), JSON.stringify(manifest, null, 2) + "\n");
    const r = runCheck(sandbox);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/vendor-manifest\.json does not match/);
  });

  it("rejects an unknown pinned contract", () => {
    const store = JSON.parse(fs.readFileSync(storePath(sandbox), "utf8"));
    store.packs[0].pinned.contract = "unsupported/999";
    writeStore(sandbox, store);
    const r = runCheck(sandbox);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/not a known contract/);
  });

  it("rejects a revision mismatch between the index and the pack manifest", () => {
    const store = JSON.parse(fs.readFileSync(storePath(sandbox), "utf8"));
    store.packs[0].pinned.revision = 999;
    writeStore(sandbox, store);
    const r = runCheck(sandbox);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/does not match the pack manifest revision/);
  });

  it("rejects an invented source with an all-zero commit", () => {
    const store = JSON.parse(fs.readFileSync(storePath(sandbox), "utf8"));
    store.packs[0].source = { repo: "invented/nowhere", commit: "0".repeat(40) };
    writeStore(sandbox, store);
    const r = runCheck(sandbox);
    // The gate no longer trusts a local hash field alone: an entry whose
    // import evidence is absent AND whose source changed must fail.
    expect(r.ok).toBe(false);
  });

  it("requires import evidence tying the vendored bytes to the source commit", () => {
    // .import-evidence.json absent -> the pin proves only self-consistency.
    // The gate demands evidence on first admission: without it, --check fails.
    const evidence = path.join(sandbox, "v2", "worldpacks", "warren", ".import-evidence.json");
    if (fs.existsSync(evidence)) fs.rmSync(evidence);
    const r = runCheck(sandbox);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/import evidence/);
  });

  it("respects mounted:false — verified, listed, never compiled", () => {
    const store = JSON.parse(fs.readFileSync(storePath(sandbox), "utf8"));
    store.packs[0].mounted = false;
    writeStore(sandbox, store);
    // build mode re-admits and rewrites the manifest with mounted:false
    const build = run(sandbox, []);
    expect(build.ok, build.output).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath(sandbox), "utf8"));
    expect(manifest.packs[0].mounted).toBe(false);
    // check then passes with nothing compiled
    const r = runCheck(sandbox);
    expect(r.ok, r.output).toBe(true);
  });
});
