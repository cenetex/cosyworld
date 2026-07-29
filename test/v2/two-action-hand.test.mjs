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
  it("keeps exactly two action slots and exposes every action through an accessible chooser", () => {
    expect(browser).not.toContain('id="command-toggle"');
    expect(browser).not.toContain('id="command-palette"');
    expect(browser).not.toContain('id="command-input"');
    expect(browser).toContain('id="all-actions-modal"');
    expect(browser).toContain('aria-labelledby="all-actions-title"');
    expect(browser).toContain('aria-describedby="all-actions-summary"');
    expect(browser).toContain("data-all-action-index");
    expect(browser).toContain('id="all-actions-draw"');
    expect(browser).toContain('id="primary"');
    expect(browser).toContain('id="secondary"');
    expect(browser).not.toContain('id="tertiary"');
    expect(browser).toContain('id="shuffle"');
    expect(browser).toContain('aria-label="Open all actions"');
    expect(browser).toContain('const buttonIds = ["primary", "secondary"];');
    expect(browser).toContain('command: "shuffle"');
    expect(browser).toContain("advanceHandPage();");
    expect(browser).toContain('event.type === "hand.shuffled"');
    expect(browser).toMatch(/function handCapacity\(\) \{\s+return 2;\s+\}/);
  });

  it("groups every same-kind Search and Scout target before the hand is ranked", () => {
    expect(browser).toContain('const searchOffers = (view.action_offers || []).filter((offer) => offer.kind === "search");');
    expect(browser).toContain('choices: searchCandidates.map((candidate) => ({');
    expect(browser).toContain('const scoutOffers = (view.action_offers || []).filter((offer) => (');
    expect(browser).toContain('choices: scoutCandidates.map((candidate) => ({');
    expect(browser).toContain('scoutAction.selectedPayload = () => ({');
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
