import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  realpathSync,
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
const fixtureEnv = (inherited = process.env) =>
  Object.fromEntries(
    Object.entries(inherited).filter(([key]) => !key.startsWith("GIT_")),
  );
function fixture(inherited = process.env) {
  const folder = mkdtempSync(join(tmpdir(), "cosy-version-"));
  temporary.push(folder);
  for (const file of files) {
    mkdirSync(dirname(join(folder, file)), { recursive: true });
    copyFileSync(new URL(`../${file}`, import.meta.url), join(folder, file));
  }
  execFileSync("git", ["init", "-b", "main", "--quiet"], {
    cwd: folder,
    env: fixtureEnv(inherited),
  });
  return folder;
}
const check = (cwd, inherited = process.env) =>
  spawnSync(process.execPath, ["scripts/check-version-bump.mjs"], {
    cwd,
    encoding: "utf8",
    env: fixtureEnv(inherited),
  });
afterEach(() =>
  temporary
    .splice(0)
    .forEach((folder) => rmSync(folder, { recursive: true, force: true })),
);

describe("one release version for web and Mac", () => {
  it("keeps fixture commands inside their own repository during a Git hook", () => {
    const parent = fixture();
    const hook = {
      ...process.env,
      GIT_DIR: join(parent, ".git"),
      GIT_WORK_TREE: parent,
    };
    const folder = fixture(hook);
    const packagePath = join(folder, "package.json");
    const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
    writeFileSync(packagePath, JSON.stringify({ ...pkg, version: "0.0.1" }));
    expect(check(folder, hook).status).toBe(1);
    expect(
      execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: folder,
        env: fixtureEnv(hook),
        encoding: "utf8",
      }).trim(),
    ).toBe(realpathSync(folder));
    expect(
      execFileSync("git", ["config", "--get", "core.bare"], {
        cwd: parent,
        env: fixtureEnv(),
        encoding: "utf8",
      }).trim(),
    ).toBe("false");
  });
  it("accepts a branch that keeps main's version", () => {
    const folder = fixture();
    const git = (...args) =>
      execFileSync("git", args, { cwd: folder, env: fixtureEnv() });
    git("add", ".");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "main");
    git("checkout", "-qb", "feature");
    expect(check(folder).status).toBe(0);
  });
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
