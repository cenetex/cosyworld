// Network acquisition only: never check out or execute an upstream file.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  gitObjectId,
  selectSourceFiles,
  verifySourceProof,
} from "./card-store-proof.mjs";
const MiB = 1024 * 1024;
const maxObject = (type) => (type === "blob" ? 16 * MiB : MiB / 4);

export function sourceUrl(source) {
  assert.deepEqual(Object.keys(source || {}).sort(), ["commit", "repo"]);
  assert(
    typeof source.repo === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(
        source.repo,
      ),
    "Invalid source repository",
  );
  assert(
    typeof source.commit === "string" &&
      /^[a-f0-9]{40}$/.test(source.commit) &&
      !/^0+$/.test(source.commit),
    "Pin an exact source commit",
  );
  return `https://github.com/${source.repo}.git`;
}

export function isolatedGit(dir) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(PATH|SystemRoot|TEMP|TMP|TMPDIR|SSL_CERT_FILE|SSL_CERT_DIR|CURL_CA_BUNDLE|https?_proxy|all_proxy|no_proxy)$/i.test(
        key,
      ),
    ),
  );
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: os.devNull,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_ALLOW_PROTOCOL: "https",
    LC_ALL: "C",
  });
  const config = [
    "credential.helper=",
    "core.askPass=",
    `core.hooksPath=${os.devNull}`,
    "http.followRedirects=false",
    "protocol.allow=never",
    "protocol.https.allow=always",
    "fetch.recurseSubmodules=false",
    "submodule.recurse=false",
    "fetch.fsckObjects=true",
    "transfer.fsckObjects=true",
    "fetch.unpackLimit=0",
    "gc.auto=0",
    "maintenance.auto=false",
    "protocol.version=2",
  ].flatMap((value) => ["-c", value]);
  const deadline = Date.now() + 60_000;
  return (args, maxBytes = MiB / 4) => {
    const timeout = Math.min(20_000, deadline - Date.now());
    assert(timeout > 0, "Source import exceeded its time limit");
    return execFileSync("git", [...config, ...args], {
      cwd: dir,
      env,
      timeout,
      maxBuffer: maxBytes,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  };
}

export function objectInventory(bytes, wanted) {
  const lines = bytes.toString("utf8").trim().split("\n");
  assert(lines.length <= 1537, "Too many fetched source objects");
  const objects = new Map();
  let total = 0;
  for (const line of lines) {
    const match = /^([a-f0-9]{40}) (commit|tree|blob) ([0-9]+)$/.exec(line);
    assert(match, "Invalid fetched object inventory");
    const [, oid, type, length] = match;
    const size = Number(length);
    assert(
      Number.isSafeInteger(size) &&
        size <= maxObject(type) &&
        (total += size) <= 160 * MiB,
      "Fetched source exceeds size limit",
    );
    assert(!objects.has(oid), "Duplicate fetched source object");
    objects.set(oid, { type, size });
  }
  assert.deepEqual(
    [...objects.keys()].sort(),
    [...wanted].sort(),
    "Fetch included unexpected source objects",
  );
  return objects;
}

export function fetchGitSource(source) {
  const url = sourceUrl(source);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cosyworld-source-"));
  try {
    const git = isolatedGit(dir);
    git(["init", "--bare", "--template=", "--object-format=sha1", "."]);
    const wanted = new Set();
    let objects = new Map();
    const acquire = (ids) => {
      const missing = [...new Set(ids)].filter((id) => !wanted.has(id));
      if (!missing.length) return;
      for (const id of missing) wanted.add(id);
      assert(wanted.size <= 1537, "Too many requested source objects");
      git([
        "fetch",
        "--quiet",
        "--no-tags",
        "--depth=1",
        "--filter=tree:0",
        "--no-write-fetch-head",
        "--",
        url,
        ...missing,
      ]);
      objects = objectInventory(
        git([
          "cat-file",
          "--batch-all-objects",
          "--batch-check=%(objectname) %(objecttype) %(objectsize)",
        ]),
        wanted,
      );
      const stats = git(["count-objects", "-v"]).toString();
      const sizes = [
        ...stats.matchAll(/^(?:size|size-pack|size-garbage): ([0-9]+)$/gm),
      ];
      assert(sizes.length === 3, "Invalid fetched repository size report");
      const kib = sizes.reduce((sum, match) => sum + Number(match[1]), 0);
      assert(kib <= 160 * 1024, "Fetched repository exceeds disk limit");
    };
    const raw = (type, oid) => {
      const info = objects.get(oid);
      assert(info?.type === type, "Unexpected source object type");
      const bytes = git(["cat-file", type, oid], maxObject(type) + 1);
      assert.equal(bytes.length, info.size, "Source object length changed");
      assert.equal(
        gitObjectId(type, bytes),
        oid,
        "Source object bytes changed",
      );
      return bytes;
    };
    acquire([source.commit]);
    const commit = raw("commit", source.commit);
    const trees = {};
    const selected = selectSourceFiles(commit, source.commit, (oid) => {
      acquire([oid]);
      const bytes = raw("tree", oid);
      trees[oid] = bytes.toString("base64");
      return bytes;
    });
    acquire(selected.map((file) => file.gitBlob));
    let total = 0;
    const files = selected.map((file) => {
      const bytes = raw("blob", file.gitBlob);
      assert(
        (total += bytes.length) <= 128 * MiB,
        "Source payload exceeds total size limit",
      );
      return { ...file, bytes };
    });
    const proof = {
      schemaVersion: 1,
      source: { ...source },
      commit: commit.toString("base64"),
      trees,
    };
    assert(
      Buffer.byteLength(JSON.stringify(proof)) <= 4 * MiB,
      "Source proof exceeds size limit",
    );
    verifySourceProof(source, proof, files);
    return { proof, files };
  } finally {
    fs.rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
}
