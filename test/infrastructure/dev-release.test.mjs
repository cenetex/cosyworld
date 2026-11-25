import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { imageInput, neededMedia, pack } from "../../scripts/dev-release.mjs";

const tool = fileURLToPath(new URL("../../scripts/dev-release.mjs", import.meta.url));
const store = fileURLToPath(new URL("../../deploy/release-store.sh", import.meta.url));
const sha256 = (body) => createHash("sha256").update(body).digest("hex");
let root;
afterEach(() => root && rmSync(root, { recursive: true, force: true }));

describe("a .dev release without an image", () => {
  it("needs an image only for files built into it", () => {
    for (const file of [
      "Dockerfile",
      "deploy/entrypoint.sh",
      "v2/orchestrator-rust/Cargo.toml",
      "v2/orchestrator-rust/src/card_shared/engine.rs",
      "v2/orchestrator-rust/src/card_narrative/authored.rs",
      "v2/core-c/kernel.c",
      "models/card-policy/incumbent.cwrank",
      "scripts/compile-release-binary.sh",
    ])
      expect(imageInput(file), file).toBe(true);
    for (const file of [
      "v2/orchestrator-rust/src/card_shared/engine-v205.js",
      "v2/orchestrator-rust/src/card_shared/rules.json",
      "v2/orchestrator-rust/src/card_narrative/authored-text.json",
      "v2/card-game/app.mjs",
      "v2/card-game/assets/pond.webp",
      "v2/content/greek-drama/pack.json",
      "v2/scripts/build-card-assets.mjs",
      "fly.toml",
      "scripts/plan-dev-deploy.sh",
    ])
      expect(imageInput(file), file).toBe(false);
  });

  it("compares the image's commit with the new one, and needs an image when it cannot", () => {
    root = mkdtempSync(join(tmpdir(), "dev-release-git-"));
    const git = (...args) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8" }).stdout.trim();
    git("init", "-q");
    const commit = (file) => {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), file);
      git("add", "-A");
      git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", file);
      return git("rev-parse", "HEAD");
    };
    const image = commit("v2/orchestrator-rust/src/main.rs");
    const assets = commit("v2/card-game/app.mjs");
    const rust = commit("v2/orchestrator-rust/src/card_shared/engine.rs");
    const ask = (from, to) => spawnSync("node", [tool, "image-input", from, to], { cwd: root, encoding: "utf8" }).stdout;
    expect(ask(image, assets)).toBe(`image=false\nreason=no image input changed since ${image.slice(0, 7)}\n`);
    expect(ask(image, rust)).toContain("image=true\nreason=v2/orchestrator-rust/src/card_shared/engine.rs is built into the image");
    expect(ask("0".repeat(40), assets)).toBe("image=true\nreason=no image commit to compare with\n");
  });

  it("reads the media .dev lacks or serves cut differently, or all of it without .dev's commit", () => {
    const assets = [
      { file: "app.mjs", contentType: "text/javascript" },
      { file: "logo.svg", contentType: "image/svg+xml" },
      { file: "same.webp", contentType: "image/webp" },
      { file: "new.webp", contentType: "image/webp" },
      { file: "edited.webp", contentType: "image/webp" },
      { file: "cut.mp3", contentType: "audio/mpeg", source: "mix.mp3", offset: 9 },
      { file: "mix.mp3", contentType: "audio/mpeg" },
    ];
    const serving = {
      "card-game/same.webp": {},
      "card-game/edited.webp": {},
      "card-game/cut.mp3": { source: "card-game/mix.mp3", offset: 4 },
      "card-game/mix.mp3": {},
    };
    const changed = new Set(["v2/card-game/edited.webp"]);
    expect(neededMedia(assets, serving, changed)).toEqual([
      "v2/card-game/new.webp",
      "v2/card-game/edited.webp",
      "v2/card-game/mix.mp3",
    ]);
    expect(neededMedia(assets, serving, null)).toHaveLength(4);
  });

  it("sends only the files .dev lacks, links the rest into the image, and stages", () => {
    root = mkdtempSync(join(tmpdir(), "dev-release-"));
    const image = join(root, "app/assets");
    const checkout = join(root, "checkout");
    const write = (dir, files) => {
      for (const [file, body] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, file)), { recursive: true });
        writeFileSync(join(dir, file), body);
      }
    };
    const manifest = (files, dirs, extra = {}) => ({
      sha256: sha256(JSON.stringify(Object.keys(files))),
      dirs,
      files: {
        ...Object.fromEntries(
          Object.entries(files).map(([key, body]) => [key, { type: "x", sha256: sha256(body), size: body.length }]),
        ),
        ...extra,
      },
    });
    const named = { "card-game": "card-game" };
    const shipped = { "card-game/app.mjs": "app", "card-game/a.png": "a" };
    write(image, shipped);
    const imageManifest = manifest(shipped, named);
    const imageText = `${JSON.stringify(imageManifest, null, 1)}\n`;
    writeFileSync(join(image, "manifest.json"), imageText);
    const next = { "card-game/app.mjs": "app 2", "card-game/a.png": "a", "card-game/copy.png": "a" };
    write(join(checkout, "card-game"), Object.fromEntries(Object.entries(next).map(([k, v]) => [k.slice(10), v])));
    const cut = { "card-game/cut.mp3": { type: "audio/mpeg", sha256: "c", size: 1, source: "card-game/a.png", offset: 0 } };
    const built = manifest(next, { "card-game": join(checkout, "card-game") }, cut);
    const archive = join(root, "release.tgz");
    const first = pack({ manifest: built, image: imageManifest, imageDir: image, serving: imageManifest, servingText: imageText, out: archive });
    expect(first).toMatchObject({ objects: 1, unchanged: false });
    const out = mkdtempSync(join(root, "out-"));
    spawnSync("tar", ["-xzf", archive, "-C", out]);
    expect(readlinkSync(join(out, "tree/card-game/a.png"))).toBe(join(image, "card-game/a.png"));
    expect(readlinkSync(join(out, "tree/card-game/copy.png"))).toBe(join(image, "card-game/a.png"));
    expect(existsSync(join(out, "tree/card-game/cut.mp3"))).toBe(false);
    expect(readFileSync(join(out, "links"), "utf8")).toBe(`${sha256("app 2")} card-game/app.mjs\n`);
    expect(readFileSync(join(out, "objects", sha256("app 2")), "utf8")).toBe("app 2");
    const text = readFileSync(join(out, "tree/manifest.json"), "utf8");
    expect(JSON.parse(text).dirs).toEqual(named);

    writeFileSync(join(root, "server"), "#!/bin/sh\ntest -L \"$COSYWORLD_ASSETS_DIR/card-game/a.png\"\n");
    chmodSync(join(root, "server"), 0o755);
    const commit = "2".repeat(40);
    const staged = spawnSync("sh", [store, "stage", commit, String(first.bytes), "1".repeat(40)], {
      input: readFileSync(archive),
      encoding: "utf8",
      env: {
        ...process.env,
        COSYWORLD_RELEASE_STORE: join(root, "releases"),
        COSYWORLD_IMAGE_ASSETS: image,
        COSYWORLD_SERVER_BINARY: join(root, "server"),
        COSYWORLD_RELEASE_STORE_LIMIT: "100",
      },
    });
    expect(staged.stdout).toBe(`staged ${commit}\n`);
    expect(readFileSync(join(root, "releases", commit, "card-game/app.mjs"), "utf8")).toBe("app 2");

    const again = pack({ manifest: built, image: imageManifest, imageDir: image, serving: JSON.parse(text), servingText: text, out: archive });
    expect(again).toMatchObject({ objects: 0, unchanged: true });
  });
});
