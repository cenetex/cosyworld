import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const checkerPath = path.join(repoRoot, "v2/scripts/check-worldpack.mjs");
const compiledWorldpackRoot = path.join(repoRoot, "v2/content/official");
const temporaryRoots = [];

function worldpackFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cosyworld-worldpack-access-"));
  fs.cpSync(compiledWorldpackRoot, root, { recursive: true });
  const assets = JSON.parse(fs.readFileSync(path.join(root, "assets.json"), "utf8"));
  writeJson(root, "assets.json", assets.map((asset) => ({ ...asset, optional: true })));
  temporaryRoots.push(root);
  return root;
}

function writeJson(root, fileName, value) {
  fs.writeFileSync(path.join(root, fileName), `${JSON.stringify(value, null, 2)}\n`);
}

function runChecker(root) {
  return spawnSync(process.execPath, [checkerPath, root], { encoding: "utf8" });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("worldpack progression access validation", () => {
  it("accepts the compiled official world", () => {
    const result = runChecker(worldpackFixture());

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("worldpack ok");
  });

  it("rejects an evolution item seeded behind an undeclared access gate", () => {
    const root = worldpackFixture();
    const items = JSON.parse(fs.readFileSync(path.join(root, "items.json"), "utf8"));
    items.find((item) => item.id === 2004).location_id = 10;
    writeJson(root, "items.json", items);

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "evolution track 1001 requirement item 2004 uses gated or unreachable location 10 without required_grant_id",
    );
  });

  it("rejects a recipe output placed behind an undeclared access gate", () => {
    const root = worldpackFixture();
    const recipes = JSON.parse(fs.readFileSync(path.join(root, "recipes.json"), "utf8"));
    recipes[0].output.target_id = 11;
    recipes[0].balance.target_id = 11;
    writeJson(root, "recipes.json", recipes);

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "recipe 3001 output uses gated or unreachable location 11 without required_grant_id",
    );
  });
});
