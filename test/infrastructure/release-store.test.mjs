import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(
  new URL("../../deploy/release-store.sh", import.meta.url),
);
const entrypoint = fileURLToPath(
  new URL("../../deploy/entrypoint.sh", import.meta.url),
);
const sha256 = (body) => createHash("sha256").update(body).digest("hex");
const commit = (digit) => String(digit).repeat(40);
const imageCommit = commit(1);
const checker = `#!/usr/bin/env node
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const root = process.env.COSYWORLD_ASSETS_DIR;
const m = JSON.parse(fs.readFileSync(path.join(root, "manifest.json")));
for (const [key, e] of Object.entries(m.files)) {
  const [dir, ...rest] = key.split("/");
  const body = fs.readFileSync(path.join(root, m.dirs[dir], ...rest));
  if (body.length !== e.size || crypto.createHash("sha256").update(body).digest("hex") !== e.sha256) {
    console.error(key + " does not match manifest.json"); process.exit(1);
  }
}
console.log(m.sha256);
`;

let root;
afterEach(() => root && rmSync(root, { recursive: true, force: true }));

function volume(extra = {}) {
  root = mkdtempSync(join(tmpdir(), "cosyworld-release-store-"));
  const image = join(root, "app/assets");
  const files = { "card-game/app.mjs": "export {};", "card-game/a.png": "a" };
  for (const [key, body] of Object.entries(files)) {
    mkdirSync(dirname(join(image, key)), { recursive: true });
    writeFileSync(join(image, key), body);
  }
  writeFileSync(join(image, "manifest.json"), manifest(files));
  writeFileSync(join(root, "server"), checker);
  chmodSync(join(root, "server"), 0o755);
  const env = {
    ...process.env,
    COSYWORLD_RELEASE_STORE: join(root, "data/releases"),
    COSYWORLD_IMAGE_ASSETS: image,
    COSYWORLD_SERVER_BINARY: join(root, "server"),
    COSYWORLD_RELEASE_STORE_LIMIT: "100",
    ...extra,
  };
  const run = (args, options = {}) =>
    spawnSync("sh", [script, ...args], { encoding: "utf8", env, ...options });
  return { image, store: env.COSYWORLD_RELEASE_STORE, env, run, files };
}

function manifest(files, lie = {}) {
  const entries = Object.entries(files).map(([key, body]) => [
    key,
    { type: "x", sha256: lie[key] ?? sha256(body), size: body.length },
  ]);
  return `${JSON.stringify({ sha256: sha256(JSON.stringify(entries)), dirs: { "card-game": "card-game" }, files: Object.fromEntries(entries) }, null, 1)}\n`;
}

function archive({ image, files }, changed, { lie, name } = {}) {
  const work = mkdtempSync(join(root, "archive-"));
  const all = { ...files, ...changed };
  mkdirSync(join(work, "objects"));
  mkdirSync(join(work, "tree/card-game"), { recursive: true });
  writeFileSync(join(work, "tree/manifest.json"), manifest(all, lie));
  const links = [];
  for (const [key, body] of Object.entries(all)) {
    if (key in changed) {
      writeFileSync(join(work, "objects", name ?? sha256(body)), body);
      links.push(`${sha256(body)} ${key}`);
    } else symlinkSync(join(image, key), join(work, "tree", key));
  }
  writeFileSync(join(work, "links"), links.map((line) => `${line}\n`).join(""));
  return spawnSync("tar", ["-czf", "-", "-C", work, "tree", "objects", "links"])
    .stdout;
}

const stage = (store, sha, body) =>
  store.run(["stage", sha, String(body.length), imageCommit], { input: body });
const serve = (store, sha) =>
  store.run(["choose"], {
    env: { ...store.env, COSYWORLD_SOURCE_COMMIT: sha, COSYWORLD_IMAGE_COMMIT: imageCommit },
  });

describe(".dev's release store", () => {
  it("serves the image's assets on a fresh volume and creates no store", () => {
    const store = volume();
    expect(store.run(["choose"]).stdout.trim()).toBe(store.image);
    const unstaged = serve(store, commit(2));
    expect(unstaged.stdout.trim()).toBe(store.image);
    expect(unstaged.stderr).toContain("was not checked on this image");
    expect(existsSync(store.store)).toBe(false);
  });

  it("checks a release before keeping it and serves it only on the image that checked it", () => {
    const store = volume();
    const result = stage(store, commit(2), archive(store, { "card-game/b.webp": "b" }));
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`staged ${commit(2)}\n`);
    const release = join(store.store, commit(2));
    expect(readlinkSync(join(release, "card-game/app.mjs"))).toBe(
      join(store.image, "card-game/app.mjs"),
    );
    expect(statSync(join(release, "card-game/b.webp")).nlink).toBe(2);
    expect(readFileSync(join(release, "image"), "utf8")).toBe(`${imageCommit}\n`);
    expect(serve(store, commit(2)).stdout.trim()).toBe(release);
    expect(readlinkSync(join(store.store, "current"))).toBe(release);
    expect(serve(store, imageCommit).stdout.trim()).toBe(store.image);
    expect(store.run(["choose"], { env: { ...store.env, COSYWORLD_SOURCE_COMMIT: commit(2) } }).stdout.trim()).toBe(store.image);
    expect(readlinkSync(join(store.store, "previous"))).toBe(release);
    writeFileSync(join(root, "server"), `${checker}// another build\n`);
    expect(serve(store, commit(2)).stdout.trim()).toBe(store.image);
  });

  it("keeps nothing from a release that fails its check or carries a damaged object", () => {
    const store = volume();
    const lie = { "card-game/a.png": sha256("not a") };
    const failed = stage(store, commit(2), archive(store, {}, { lie }));
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("card-game/a.png does not match manifest.json");
    expect(failed.stderr).toContain(`${commit(2)} failed the assets check`);
    const damaged = stage(store, commit(3), archive(store, { "card-game/b.webp": "b" }, { name: sha256("c") }));
    expect(damaged.stderr).toContain("does not match its name");
    for (const sha of [commit(2), commit(3), "incoming"]) expect(existsSync(join(store.store, sha))).toBe(false);
    expect(stage(store, "main", archive(store, {})).stderr).toContain("stage needs a commit and its image's commit");
  });

  it("refuses to stage onto a nearly full volume", () => {
    const store = volume({ COSYWORLD_RELEASE_STORE_LIMIT: "1" });
    const result = stage(store, commit(2), archive(store, {}));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("past 1%; extend the volume");
  });

  it("counts use as df does and stops below the production deploy guard", () => {
    const store = volume({ COSYWORLD_RELEASE_STORE_LIMIT: "" });
    const bin = mkdtempSync(join(root, "bin-"));
    const df = (used, available) => {
      writeFileSync(join(bin, "df"), `#!/bin/sh\necho "Filesystem 1024-blocks Used Available Capacity Mounted"\necho "/dev/vdb 1000000 ${used} ${available} 0% /data"\n`);
      chmodSync(join(bin, "df"), 0o755);
      const body = archive(store, {});
      const env = { ...store.env, PATH: `${bin}${delimiter}${process.env.PATH}` };
      return store.run(["stage", commit(2), String(body.length), imageCommit], { input: body, env });
    };
    expect(df(700000, 50000).stderr).toContain("past 75%; extend the volume");
    expect(df(700000, 300000).stdout).toBe(`staged ${commit(2)}\n`);
  });

  it("keeps the release .dev serves and the one before it, and drops unused objects", () => {
    const store = volume();
    const object = (body) => join(store.store, "objects", sha256(body));
    for (const [digit, body] of [[2, "two"], [3, "three"], [4, "four"], [5, "five"]]) {
      expect(stage(store, commit(digit), archive(store, { "card-game/b.webp": body })).status).toBe(0);
      expect(serve(store, commit(digit)).stdout.trim()).toBe(join(store.store, commit(digit)));
    }
    expect(stage(store, commit(5), archive(store, {})).stderr).toContain("is the release .dev serves");
    expect(stage(store, commit(6), archive(store, { "card-game/b.webp": "six" })).status).toBe(0);
    for (const digit of [2, 3]) expect(existsSync(join(store.store, commit(digit)))).toBe(false);
    for (const digit of [4, 5, 6]) expect(existsSync(join(store.store, commit(digit)))).toBe(true);
    expect(existsSync(object("three"))).toBe(false);
    expect(existsSync(object("four"))).toBe(true);
    expect(lstatSync(object("six")).mode & 0o777).toBe(0o444);
    expect(existsSync(join(store.store, "incoming"))).toBe(false);
  });

  it("reports the manifest .dev serves beside the image's", () => {
    const store = volume();
    stage(store, commit(2), archive(store, { "card-game/b.webp": "b" }));
    serve(store, commit(2));
    const out = mkdtempSync(join(root, "serving-"));
    spawnSync("tar", ["-xzf", "-", "-C", out], { input: store.run(["serving"], { encoding: "buffer" }).stdout });
    expect(readFileSync(join(out, "serving"), "utf8")).toBe(`${store.image}\n${commit(2)}\n`);
    expect(readFileSync(join(out, "image.json"), "utf8")).toBe(manifest(store.files));
    expect(JSON.parse(readFileSync(join(out, "serving.json"))).files).toHaveProperty("card-game/b.webp");
  });

  it("the entrypoint exports the chosen assets and leaves an image without a store alone", () => {
    const store = volume({ COSYWORLD_ASSETS_DIR: "/app/assets" });
    const bin = mkdtempSync(join(root, "bin-"));
    writeFileSync(join(bin, "id"), "#!/bin/sh\necho 1000\n");
    chmodSync(join(bin, "id"), 0o755);
    const boot = (env) =>
      spawnSync("sh", [entrypoint, "sh", "-c", "echo $COSYWORLD_ASSETS_DIR"], {
        encoding: "utf8",
        env: { ...store.env, PATH: `${bin}${delimiter}${process.env.PATH}`, ...env },
      }).stdout.trim();
    expect(boot({})).toBe("/app/assets");
    stage(store, commit(2), archive(store, {}));
    const release = { COSYWORLD_SOURCE_COMMIT: commit(2), COSYWORLD_IMAGE_COMMIT: imageCommit };
    expect(boot(release)).toBe(join(store.store, commit(2)));
    expect(boot({ COSYWORLD_SERVER_BINARY: join(bin, "id"), ...release })).toBe(store.image);
  });
});
