// Build the worldpack store: verify, validate, import and admit third-party packs.
//
//   node v2/scripts/build-card-store.mjs                # verify + admit store packs
//   node v2/scripts/build-card-store.mjs --check        # fail if anything drifts
//   node v2/scripts/build-card-store.mjs --import warren
//                # fetch source.repo at source.commit, vendor the payload, pin it
//   node v2/scripts/build-card-store.mjs --refresh-ratings
//                # also refresh GitHub star/fork signals
//
// A worldpack lives in its own repository (the source of truth). Publishing
// it to the store is a PR that vendors a copy under v2/worldpacks/<id>/ and
// pins the source commit plus a content hash. This script is the gate:
//  1. the index schema is valid (contract known, revision matches the pack
//     manifest, mounted honored),
//  2. the vendored copy must hash to the pin (nothing edits a pack in place),
//  3. the pack must pass the full card-table validator,
//  4. admitted packs are materialized (assets copied to card-game/assets/)
//     and listed in v2/worldpacks/vendor-manifest.json for the worldpack build.
// In --check mode NOTHING is written; instead the stored manifest and the
// published assets are compared field-by-field against what admission would
// produce, so a stale manifest or a drifted published asset fails the check.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packProblems } from "../card-game/pack-schema.mjs";

const v2 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storeDir = path.join(v2, "worldpacks");
const storeFile = path.join(storeDir, "store.json");
const manifestFile = path.join(storeDir, "vendor-manifest.json");
const check = process.argv.includes("--check");
const refreshRatings = process.argv.includes("--refresh-ratings");
const importArg = process.argv.indexOf("--import");
const importId = importArg >= 0 ? process.argv[importArg + 1] : undefined;

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const storeLoaded = (() => {
  try {
    const s = read(storeFile);
    return s?.schemaVersion === 1 && Array.isArray(s.packs) ? s : null;
  } catch {
    return null;
  }
})();

// Contracts this store knows how to compile. A pin claiming another contract
// is rejected at the gate, not discovered by the compiler.
const KNOWN_CONTRACTS = new Set(["cosyworld.card-table/1"]);

// The vendored payload: exactly these paths are hashed, imported and published.
function payloadFiles(dir) {
  if (!fs.existsSync(path.join(dir, "card-world.json")) || !fs.existsSync(path.join(dir, "card-bridge.json")))
    return null;
  const files = ["card-world.json", "card-bridge.json"];
  const assets = path.join(dir, "assets");
  if (fs.existsSync(assets)) {
    const walk = (rel) => {
      for (const name of fs.readdirSync(path.join(assets, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const next = rel ? rel + "/" + name.name : name.name;
        if (name.isDirectory()) walk(next);
        else files.push("assets/" + next);
      }
    };
    walk("");
  }
  return files;
}

// Content hash: every payload file, sorted by path, hashed as
// "<path>\n<size>\n<sha256 of bytes>\n". Deterministic across platforms.
function hashPack(dir) {
  const files = payloadFiles(dir);
  if (!files) return null;
  const h = crypto.createHash("sha256");
  for (const rel of files) {
    const bytes = fs.readFileSync(path.join(dir, rel));
    h.update(rel + "\n" + bytes.length + "\n" + sha256(bytes) + "\n");
  }
  return h.digest("hex");
}

function filesUnder(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const walk = (rel) => {
    for (const name of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const next = rel ? rel + "/" + name.name : name.name;
      if (name.isDirectory()) walk(next);
      else out.push(next);
    }
  };
  walk("");
  return out;
}

// --import: fetch the exact source commit and vendor its payload. Evidence of
// the fetch lands in worldpacks/<id>/.import-evidence.json so the PR review
// can tie the vendored bytes to the upstream commit.
if (importId !== undefined) {
  const entry = storeLoaded?.packs.find((p) => p.id === importId);
  if (!entry) {
    console.error('--import: no store entry for "' + importId + '"');
    process.exit(1);
  }
  const { execFileSync } = await import("node:child_process");
  const tmp = fs.mkdtempSync(path.join(storeDir, "import-" + importId + "-"));
  const tarball = path.join(tmp, "pack.tar.gz");
  console.log("Fetching " + entry.source.repo + "@" + entry.source.commit + " ...");
  execFileSync("curl", ["-sSL", "-o", tarball, "https://codeload.github.com/" + entry.source.repo + "/tar.gz/" + entry.source.commit], { stdio: "inherit" });
  fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
  execFileSync("tar", ["-xzf", "pack.tar.gz", "-C", "src", "--strip-components=1"], { cwd: tmp });
  const srcDir = path.join(tmp, "src");
  const files = payloadFiles(srcDir);
  if (!files) {
    console.error("--import: fetched tree has no card-world.json/card-bridge.json");
    process.exit(1);
  }
  const dir = path.join(storeDir, importId);
  fs.mkdirSync(dir, { recursive: true });
  for (const rel of files) {
    const from = path.join(srcDir, rel);
    const to = path.join(dir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  // carry the pack manifest + provenance for review, outside the hash
  for (const meta of ["worldpack.json", "PROVENANCE.md"]) {
    if (fs.existsSync(path.join(srcDir, meta))) fs.copyFileSync(path.join(srcDir, meta), path.join(dir, meta));
  }
  const evidence = {
    repo: entry.source.repo,
    commit: entry.source.commit,
    fetchedAt: new Date().toISOString(),
    payloadFiles: files,
    payloadSha256: hashPack(dir),
  };
  if (evidence.payloadSha256 !== entry.pinned.sha256) {
    evidence.warning = "fetched payload does not match the pin — re-pin before build";
  }
  fs.writeFileSync(path.join(dir, ".import-evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log("Imported " + importId + " from " + entry.source.repo + "@" + entry.source.commit.slice(0, 10) + ": " + files.length + " payload files, sha256 " + evidence.payloadSha256 + ".");
  fs.rmSync(tmp, { recursive: true, force: true });
}

const problems = [];
const admitted = [];

if (
  !fs.existsSync(storeFile) ||
  read(storeFile)?.schemaVersion !== 1 ||
  !Array.isArray(read(storeFile).packs)
) {
  console.error("v2/worldpacks/store.json needs schemaVersion 1 and a packs list.");
  process.exit(1);
}
const store = read(storeFile);
const hub = JSON.parse(fs.readFileSync(path.join(v2, "worlds/card-table.json"), "utf8")).hub;
const seen = new Set();

for (const entry of store.packs) {
  const id = entry.id;
  if (!/^[a-z0-9-]+$/.test(id) || seen.has(id)) {
    problems.push(id + ": store entry needs a distinct lowercase-hyphen id");
    continue;
  }
  seen.add(id);
  // 0. Index schema: the selection fields must be real before anything trusts them.
  const pin = entry.pinned;
  if (!pin || pin.contract === undefined || pin.revision === undefined) {
    problems.push(id + ": store entry needs pinned.contract and pinned.revision");
    continue;
  }
  if (!KNOWN_CONTRACTS.has(pin.contract)) {
    problems.push(id + ': pinned.contract "' + pin.contract + '" is not a known contract (' + [...KNOWN_CONTRACTS].join(", ") + ")");
    continue;
  }
  if (typeof pin.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(pin.sha256)) {
    problems.push(id + ": pinned.sha256 must be a 64-hex content hash");
    continue;
  }
  if (!entry.source?.repo || !entry.source?.commit || !/^[0-9a-f]{40}$/.test(entry.source.commit)) {
    problems.push(id + ": source needs a repo and a 40-hex commit");
    continue;
  }
  const dir = path.join(storeDir, id);
  const packManifestFile = path.join(dir, "worldpack.json");
  if (!fs.existsSync(packManifestFile)) {
    problems.push(id + ": vendored copy needs worldpack.json (the pack manifest)");
    continue;
  }
  let manifest;
  try {
    manifest = read(packManifestFile);
  } catch {
    problems.push(id + ": worldpack.json is not valid JSON");
    continue;
  }
  if (manifest.id !== id) {
    problems.push(id + ": worldpack.json id must match the store entry");
    continue;
  }
  if (manifest.revision !== pin.revision) {
    problems.push(id + ": pinned.revision " + pin.revision + " does not match the pack manifest revision " + manifest.revision);
    continue;
  }
  if (manifest.engine?.contract !== pin.contract) {
    problems.push(id + ": pinned.contract " + pin.contract + " does not match the pack manifest contract " + manifest.engine?.contract);
    continue;
  }
  // 0b. Import evidence: the pin proves a local directory matches a local
  //     hash field. The evidence file (written by --import) is what ties the
  //     vendored bytes to source.repo@source.commit. Admission without it is
  //     refused; --import produces it from a real fetch.
  const evidenceFile = path.join(dir, ".import-evidence.json");
  if (!fs.existsSync(evidenceFile)) {
    problems.push(`${id}: no import evidence (run build-card-store.mjs --import ${id})`);
    continue;
  }
  let evidence;
  try {
    evidence = read(evidenceFile);
  } catch {
    problems.push(`${id}: .import-evidence.json is not valid JSON`);
    continue;
  }
  if (evidence.repo !== entry.source.repo || evidence.commit !== entry.source.commit) {
    problems.push(`${id}: import evidence is for ${evidence.repo}@${String(evidence.commit).slice(0, 10)}, not the pinned ${entry.source.repo}@${entry.source.commit.slice(0, 10)}`);
    continue;
  }
  if (evidence.payloadSha256 !== pin.sha256) {
    problems.push(`${id}: import evidence hash does not match the pin`);
    continue;
  }
  // 1. The pin must match the vendored bytes.
  const actual = hashPack(dir);
  if (actual !== pin.sha256) {
    problems.push(id + ": vendored copy does not match the pin (" + actual + " != " + pin.sha256 + "). Re-pin or re-vendor.");
    continue;
  }
  // 2. The pack must validate against the hub like any in-tree pack.
  const source = JSON.parse(fs.readFileSync(path.join(dir, "card-world.json"), "utf8"));
  const bridge = JSON.parse(fs.readFileSync(path.join(dir, "card-bridge.json"), "utf8"));
  if (bridge.schemaVersion !== 1 || bridge.pack !== id) {
    problems.push(id + ': bridge needs schemaVersion 1 and pack "' + id + '"');
    continue;
  }
  const { schemaVersion: _s, pack: _p, id: bridgeId, description, entries: _entries, ...joins } = bridge;
  const pack = {
    ...source,
    bridge: { id: bridgeId, description },
    ...joins,
  };
  problems.push(...packProblems(pack, hub, []));
  if (problems.length) continue;

  if (!entry.mounted) {
    // Declared off: verified, listed, never compiled or published.
    admitted.push({ id, revision: pin.revision, source: entry.source, pinned: pin, mounted: false, dir: "worldpacks/" + id });
    continue;
  }

  // 3. Assets. Build mode materializes the published copy first (a fresh tree
  //    has none yet); check mode requires the published copy to already equal
  //    the vendored pack — same file list, same bytes, both directions.
  const artFrom = path.join(dir, "assets");
  const artTo = path.join(v2, "card-game", "assets", id);
  const vendoredAssets = filesUnder(artFrom);
  if (!check) {
    for (const rel of vendoredAssets) {
      fs.mkdirSync(path.dirname(path.join(artTo, rel)), { recursive: true });
      fs.copyFileSync(path.join(artFrom, rel), path.join(artTo, rel));
    }
  } else {
    const publishedAssets = filesUnder(artTo);
    const vendoredSet = new Set(vendoredAssets);
    const publishedSet = new Set(publishedAssets);
    for (const rel of vendoredAssets)
      if (!publishedSet.has(rel)) problems.push(id + ": published asset missing: assets/" + rel);
    for (const rel of publishedAssets)
      if (!vendoredSet.has(rel)) problems.push(id + ": stale published asset (not in the vendored pack): assets/" + rel);
    for (const rel of vendoredAssets) {
      if (!publishedSet.has(rel)) continue;
      const a = fs.readFileSync(path.join(artFrom, rel));
      const b = fs.readFileSync(path.join(artTo, rel));
      if (!a.equals(b)) problems.push(id + ": published asset differs from the vendored pack: assets/" + rel);
    }
    if (problems.length) continue;
  }
  admitted.push({ id, revision: pin.revision, source: entry.source, pinned: pin, mounted: true, dir: "worldpacks/" + id });
}

if (problems.length) {
  console.error("Worldpack store is invalid:\n- " + problems.join("\n- "));
  process.exit(1);
}

// 5. Manifest binding: the stored vendor manifest must equal what these
//    verified entries produce — every field, both directions. A manifest that
//    lists a pack the index dropped, misses one it added, or carries a stale
//    pin fails the check.
const expectedManifest = {
  schemaVersion: 1,
  packs: admitted.map(({ id, revision, source, pinned, mounted, dir }) => ({ id, revision, source, pinned, mounted, dir })),
};
let storedManifest = null;
try {
  storedManifest = read(manifestFile);
} catch {
  /* missing or broken manifest handled below */
}
const sameManifest =
  storedManifest &&
  storedManifest.schemaVersion === 1 &&
  JSON.stringify(storedManifest.packs) === JSON.stringify(expectedManifest.packs);
if (!sameManifest) {
  if (check) {
    console.error(
      "vendor-manifest.json does not match the verified store index (expected " +
        (expectedManifest.packs.map((p) => p.id).join(", ") || "(empty)") +
        "). Run the build to re-admit, then commit the manifest.",
    );
    process.exit(1);
  }
  fs.writeFileSync(manifestFile, JSON.stringify(expectedManifest, null, 2) + "\n");
}

if (refreshRatings) {
  for (const entry of store.packs) {
    try {
      const res = await fetch("https://api.github.com/repos/" + entry.source.repo, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "cosyworld-store-build" },
      });
      if (res.ok) {
        const repo = await res.json();
        entry.rating = {
          ...entry.rating,
          source: "github",
          stars: repo.stargazers_count ?? entry.rating?.stars ?? 0,
          forks: repo.forks_count ?? entry.rating?.forks ?? 0,
          updated: new Date().toISOString().slice(0, 10),
        };
      }
    } catch {
      // Ratings are advisory: a failed fetch never blocks the build.
    }
  }
  if (!check) fs.writeFileSync(storeFile, JSON.stringify(store, null, 2) + "\n");
}

if (!check) {
  console.log("Worldpack store admitted: " + (admitted.map((p) => p.id).join(", ") || "(empty)") + ".");
} else {
  console.log("Worldpack store verified: " + (admitted.map((p) => p.id).join(", ") || "(empty)") + " (manifest and published assets match).");
}
