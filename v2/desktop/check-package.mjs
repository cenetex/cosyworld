import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publicAssets } from "../card-game/public-assets.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (file) => new URL(`../card-game/${file}`, import.meta.url);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pkg = JSON.parse(
  await readFile(new URL("../../package.json", import.meta.url)),
);
const engine = await readFile(
  new URL("../orchestrator-rust/src/card_shared/engine.rs", import.meta.url),
  "utf8",
);
const assets = [];
for (const asset of publicAssets) {
  const bytes = (await readFile(source(asset.source || asset.file))).subarray(
    asset.offset || 0,
  );
  assets.push([asset.file, hash(bytes)]);
}
const manifest = {
  version: pkg.version,
  sharedRulesVersion: engine.match(/const VERSION: &str = "([^"]+)"/)[1],
  assetsSha256: hash(JSON.stringify(assets)),
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  assetCount: assets.length,
};

if (process.argv.includes("--manifest")) {
  console.log(JSON.stringify(manifest, null, 2));
} else {
  const appArg = process.argv.indexOf("--app");
  assert(
    appArg >= 0 && process.argv[appArg + 1],
    "Choose the packaged app with --app.",
  );
  const app = resolve(process.argv[appArg + 1]);
  const plist = JSON.parse(
    execFileSync(
      "plutil",
      ["-convert", "json", "-o", "-", `${app}/Contents/Info.plist`],
      { encoding: "utf8" },
    ),
  );
  assert.equal(
    plist.CFBundleShortVersionString,
    manifest.version,
    "The app uses the common release version.",
  );
  const bundled = JSON.parse(
    await readFile(`${app}/Contents/Resources/game/build-info.json`),
  );
  assert.deepEqual(
    bundled,
    manifest,
    "The package comes from this source commit.",
  );
  const origin =
    process.env.COSYWORLD_LOCAL_SMOKE_ORIGIN || "http://127.0.0.1:3110";
  const meta = await (await fetch(`${origin}/meta`)).json();
  assert.equal(
    meta.version,
    manifest.version,
    "The running game uses the common release version.",
  );
  assert.equal(
    meta.card_game.shared_rules_version,
    manifest.sharedRulesVersion,
  );
  assert.equal(meta.card_game.assets_sha256, manifest.assetsSha256);
  const cast = JSON.parse(await readFile(source("voices.json")));
  for (const file of [
    "voices.json",
    ...Object.values(cast.voices).map((voice) => voice.file),
  ]) {
    assert.deepEqual(
      await readFile(`${app}/Contents/Resources/voices/${file}`),
      await readFile(source(file)),
      `Current voice reference: ${file}`,
    );
  }
  for (const [file, expectedHash] of assets) {
    const response = await fetch(`${origin}/card-game/${file}`);
    assert.equal(response.status, 200, `Packaged asset: ${file}`);
    assert.equal(
      response.headers.get("x-cosyworld-card-version"),
      manifest.version,
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    if (file === "index.html") {
      // The local marker and model deadline are the two runtime page settings.
      const normalize = (text) =>
        text
          .replace('<meta name="cosy-local-app" content="1">', "")
          .replace(/(name="cosy-story-budget-ms" content=")\d+"/, '$1RUNTIME"');
      assert.equal(
        normalize(bytes.toString()),
        normalize(await readFile(source(file), "utf8")),
      );
    } else {
      assert.equal(hash(bytes), expectedHash, `Current game bytes: ${file}`);
      assert.equal(
        response.headers.get("etag").replace(/^W\//, ""),
        `"${expectedHash}"`,
      );
    }
  }
  const [media, mediaHash] = assets.find(([file]) => file.endsWith(".webp"));
  const cached = await fetch(`${origin}/card-game/${media}?v=${mediaHash}`, {
    method: "HEAD",
  });
  assert.match(cached.headers.get("cache-control"), /immutable/);
  const unchanged = await fetch(`${origin}/card-game/${media}`, {
    headers: { "If-None-Match": `"${mediaHash}"` },
  });
  assert.equal(unchanged.status, 304);
  const range = await fetch(`${origin}/card-game/${media}`, {
    headers: { Range: "bytes=0-15" },
  });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 16);
  if (process.env.COSYWORLD_PACKAGE_REPORT)
    await writeFile(
      process.env.COSYWORLD_PACKAGE_REPORT,
      JSON.stringify({ ...manifest, checked: true }, null, 2) + "\n",
    );
  console.log(
    `Package matches web source: ${manifest.version}, ${manifest.sharedRulesVersion}, ${assets.length} assets, ${manifest.sourceCommit}.`,
  );
}
