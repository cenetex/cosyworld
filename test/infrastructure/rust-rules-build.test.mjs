import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const exec = promisify(execFile);
const sha256 = (body) => createHash("sha256").update(body).digest("hex");
const build = new URL("../../v2/scripts/build-rust-rules.mjs", import.meta.url);
const cargo = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { CARGO_TARGET_DIR: root, BUILD_FIXTURE: fixture } = process.env;
const args = process.argv.slice(2);
const arg = (name) => args[args.indexOf(name) + 1];
if (args[0] === "metadata") {
  console.log(JSON.stringify({
    target_directory: root,
    packages: [{ id: fixture, version: "0.1.0", manifest_path: arg("--manifest-path") }],
  }));
  process.exit();
}
const wait = (name) => {
  const deadline = Date.now() + 6000;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  while (!fs.existsSync(path.join(root, name))) {
    if (Date.now() > deadline) throw new Error("Missing " + name);
    Atomics.wait(pause, 0, 0, 20);
  }
};
if (fixture === "second") wait("first");
const target = args.includes("--target-dir") ? arg("--target-dir") : root;
const wasm = path.join(target, "wasm32-unknown-unknown", "release", "rules.wasm");
fs.mkdirSync(path.dirname(wasm), { recursive: true });
fs.writeFileSync(wasm, fixture);
fs.writeFileSync(path.join(root, fixture), "");
if (fixture === "first") wait("second");
console.log(JSON.stringify({ reason: "compiler-artifact", package_id: fixture, filenames: [wasm] }));
`;

const browser = `
export const browserRules = () => ({ op }) => op === "settle_lamp"
  ? { ok: true, lamp: { fuelRooms: 2, fuelPlace: "étang", fuelVisit: true, lit: true } }
  : null;
`;

test("concurrent rules builds publish their own artifact under a shared target root", async () => {
  const root = mkdtempSync(join(tmpdir(), "rules-build-"));
  try {
    const bin = join(root, "bin");
    const target = join(root, "target");
    mkdirSync(bin);
    mkdirSync(target);
    writeFileSync(join(bin, "cargo"), cargo, { mode: 0o755 });

    const run = (fixture) => {
      const checkout = join(root, fixture);
      const script = join(checkout, "v2", "scripts", "build-rust-rules.mjs");
      const rules = join(checkout, "v2", "rules-rust");
      mkdirSync(dirname(script), { recursive: true });
      mkdirSync(join(rules, "wasm"), { recursive: true });
      copyFileSync(build, script);
      writeFileSync(join(rules, "wasm", "Cargo.toml"), "");
      writeFileSync(join(rules, "browser.mjs"), browser);
      return exec(process.execPath, [script], {
        cwd: checkout,
        env: {
          ...process.env,
          PATH: [bin, process.env.PATH].join(delimiter),
          CARGO_TARGET_DIR: target,
          BUILD_FIXTURE: fixture,
        },
        timeout: 10_000,
      });
    };

    const inputs = ["first", "second"];
    const results = await Promise.allSettled(inputs.map(run));
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") throw result.reason;
      const input = inputs[index];
      const digest = sha256(input);
      const file = `${digest}.wasm`;
      const version = "0.1.0";
      const output = join(target, "rules-candidates", version);
      expect(result.value.stdout.trim()).toBe(join(output, file));
      expect(readFileSync(join(output, file), "utf8")).toBe(input);
      expect(
        JSON.parse(readFileSync(join(output, `${digest}.json`), "utf8")),
      ).toEqual({
        abi: 1,
        version,
        target: "wasm32-unknown-unknown",
        file,
        sha256: digest,
        size: Buffer.byteLength(input),
      });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
