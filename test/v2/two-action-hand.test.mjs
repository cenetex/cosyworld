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
  it("keeps exactly two action slots and exposes a turn-free draw control", () => {
    expect(browser).not.toContain('id="command-toggle"');
    expect(browser).not.toContain('id="command-palette"');
    expect(browser).not.toContain('id="command-input"');
    expect(browser).not.toContain('id="all-actions-modal"');
    expect(browser).toContain('id="primary"');
    expect(browser).toContain('id="secondary"');
    expect(browser).not.toContain('id="tertiary"');
    expect(browser).toContain('id="shuffle"');
    expect(browser).toContain('const buttonIds = ["primary", "secondary"];');
    expect(browser).toContain('command: "shuffle"');
    expect(browser).toContain("advanceHandPage();");
    expect(browser).toContain('event.type === "hand.shuffled"');
    expect(browser).toMatch(/function handCapacity\(\) \{\s+return 2;\s+\}/);
  });

  it("submits room-feature Use offers through the typed item endpoint", () => {
    const featureUseBlock = browser.slice(
      browser.indexOf('if (options.has("use_feature"))'),
      browser.indexOf("const routeExits"),
    );
    expect(featureUseBlock).toContain('action("/actions/use-item", {');
    expect(featureUseBlock).toContain("location_id: currentLocationId");
    expect(featureUseBlock).toContain("feature_key: featureKey");
    expect(featureUseBlock).not.toContain("runCommandText(command)");
  });
});
