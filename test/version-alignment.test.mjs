import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const temporary = [];
const files = [
  "package.json",
  "package-lock.json",
  "v2/orchestrator-rust/Cargo.toml",
  "v2/orchestrator-rust/Cargo.lock",
  "v2/desktop/src-tauri/Cargo.toml",
  "v2/desktop/src-tauri/Cargo.lock",
  "v2/desktop/src-tauri/tauri.conf.json",
  "scripts/bump-version.mjs",
  "scripts/check-version-bump.mjs",
];
function fixture() {
  const folder = mkdtempSync(join(tmpdir(), "cosy-version-"));
  temporary.push(folder);
  for (const file of files) {
    mkdirSync(dirname(join(folder, file)), { recursive: true });
    copyFileSync(new URL(`../${file}`, import.meta.url), join(folder, file));
  }
  execFileSync("git", ["init", "-b", "main", "--quiet"], { cwd: folder });
  return folder;
}
const check = (cwd) =>
  spawnSync(process.execPath, ["scripts/check-version-bump.mjs"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, VERSION_BASE_BRANCH: "main" },
  });
afterEach(() =>
  temporary
    .splice(0)
    .forEach((folder) => rmSync(folder, { recursive: true, force: true })),
);

describe("one release version for web and Mac", () => {
  it("bumps the package, game helper, and native shell together", () => {
    const folder = fixture();
    execFileSync(process.execPath, ["scripts/bump-version.mjs", "2.3.4"], {
      cwd: folder,
    });
    expect(check(folder).status).toBe(0);
    expect(JSON.parse(readFileSync(join(folder, "package.json"))).version).toBe(
      "2.3.4",
    );
    expect(
      readFileSync(join(folder, "v2/desktop/src-tauri/Cargo.lock"), "utf8"),
    ).toContain('name = "cosyworld-desktop"\nversion = "2.3.4"');
  });
  for (const file of files.slice(0, 7)) {
    it(`catches a stale version in ${file}`, () => {
      const folder = fixture();
      const path = join(folder, file);
      const original = readFileSync(path, "utf8");
      const version = JSON.parse(
        readFileSync(join(folder, "package.json")),
      ).version;
      writeFileSync(
        path,
        file.endsWith("tauri.conf.json")
          ? original.replace("../../../package.json", "0.0.1")
          : original.replaceAll(version, "0.0.1"),
      );
      expect(check(folder).status).toBe(1);
    });
  }
});
