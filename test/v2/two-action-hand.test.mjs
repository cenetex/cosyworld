import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const browser = fs.readFileSync(
  path.join(repoRoot, "v2/orchestrator-rust/src/index.html"),
  "utf8",
);

describe("two-action browser hand", () => {
  it("keeps chat beside exactly two action slots without a third or shuffle card", () => {
    expect(browser).toContain('id="command-toggle"');
    expect(browser).toContain('id="primary"');
    expect(browser).toContain('id="secondary"');
    expect(browser).not.toContain('id="tertiary"');
    expect(browser).not.toContain('id="shuffle"');
    expect(browser).toContain('const buttonIds = ["primary", "secondary"];');
    expect(browser).toMatch(/function handCapacity\(\) \{\s+return 2;\s+\}/);
  });
});
