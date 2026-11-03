// The server repacks every shared world onto the current content as it
// loads it (full_store.rs). A content change that a world saved on main
// cannot take, such as a resident added to a mounted pack, would make every
// shared world on .dev unloadable, so it fails here before it merges.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const dir = "v2/orchestrator-rust/src/card_shared";
const here = (path) =>
  readFileSync(new URL(`../${dir}/${path}`, import.meta.url), "utf8");
const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 << 20,
    stdio: ["ignore", "pipe", "ignore"],
  });
const versionOf = (text) =>
  text.match(/const VERSION: &str = "full-card-world\/(\d+)"/)[1];

// Main as this branch left it: the fork point, or main itself in a PR's
// merge checkout. CI fetches full history, so it always has one.
function mainTree() {
  try {
    return git("merge-base", "HEAD", "origin/main").trim();
  } catch {
    return null;
  }
}
const base = mainTree();
const at = (path) =>
  base ? git("show", `${base}:${dir}/${path}`) : here(path);

// A released bundle hosted as Rust hosts it, with the given pack content.
function engine(bundle, files) {
  const runtime = vm.createContext({ structuredClone, cardContent: files });
  vm.runInContext(bundle, runtime);
  return (request) => JSON.parse(runtime.cardShared(JSON.stringify(request)));
}
const version = versionOf(here("engine.rs"));
const current = engine(
  here(`engine-v${version}.js`),
  JSON.parse(here("content.json")),
);
// The upgrade a world journals when it loads: new rules, or the same rules
// onto new content (a repack).
const load = (world, from, rules = current) =>
  rules({
    op: "upgrade",
    from: `full-card-world/${from}`,
    to: `full-card-world/${version}`,
    world,
  });

describe("a shared world saved on main loads on this branch", () => {
  it.skipIf(!base && !process.env.CI)("repacks onto this content", () => {
    expect(base, "fetch origin/main").toBeTruthy();
    const from = versionOf(at("engine.rs"));
    const saved = engine(
      at(`engine-v${from}.js`),
      JSON.parse(at("content.json")),
    );
    const { world } = saved({ op: "create", seed: 7 });
    const result = load(world, from);
    expect(result.error).toBeUndefined();
    expect(current({ op: "validate", world: result.world }).error).toBe(
      undefined,
    );
  });

  // The authoring rule in v2/docs/card-packs.md: a new resident goes in a
  // new pack, or ships with its pack's save upgrade.
  it("refuses a resident added to a mounted pack", () => {
    const content = JSON.parse(here("content.json"));
    const { world } = current({ op: "create", seed: 7 });
    const greek = content.files["v2/card-game/packs.json"].packs.find(
      (p) => p.id === "greek-drama",
    );
    greek.avatars["greek-test-baker"] = {
      ...structuredClone(greek.avatars["greek-baker"]),
      name: "Test Baker",
    };
    const grown = engine(here(`engine-v${version}.js`), content);
    expect(load(world, version, grown).error).toMatch(/fresh start/);
  });
});
