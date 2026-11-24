import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { GENERATED_FILES, classify } from "../scripts/regen.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("lint", () => {
  it("skips every generated script and lints the hand-written ones", async () => {
    const tracked = execFileSync("git", ["ls-files", "*.js", "*.mjs"], {
      cwd: root,
      encoding: "utf8",
    }).split("\n");
    const generated = tracked.filter((file) => classify(file) === "generated");
    expect(generated).toEqual(
      expect.arrayContaining(GENERATED_FILES.filter((f) => /\.m?js$/.test(f))),
    );
    expect(generated.length).toBeGreaterThan(1);
    const eslint = new ESLint({ cwd: root });
    for (const file of generated)
      expect(await eslint.isPathIgnored(file), file).toBe(true);
    for (const file of ["v2/card-game/world.mjs", "scripts/regen.mjs"])
      expect(await eslint.isPathIgnored(file), file).toBe(false);
  });
});
