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
  it("keeps exactly two current card slots and exposes certified Think/Pass as the only cycle action", () => {
    expect(browser).not.toContain('id="command-toggle"');
    expect(browser).not.toContain('id="command-palette"');
    expect(browser).not.toContain('id="command-input"');
    expect(browser).not.toContain('id="all-actions-modal"');
    expect(browser).not.toContain("data-all-action-index");
    expect(browser).toContain('id="primary"');
    expect(browser).toContain('id="secondary"');
    expect(browser).not.toContain('id="tertiary"');
    expect(browser).toContain('id="shuffle"');
    expect(browser).toContain('data-player-concept="pass"');
    expect(browser).toContain('aria-label="Think: pass these two actions and commit the turn"');
    expect(browser).toContain('const buttonIds = ["primary", "secondary"];');
    expect(browser).toContain('async function passHand()');
    expect(browser).toContain('offer_id: handPassSubmission.offer_id');
    expect(browser).toContain('postResult("/commands", withAccess({');
    expect(browser).not.toContain('post("/actions/draw"');
    expect(browser).not.toContain("advanceHandPage");
    expect(browser).not.toContain("drawNextHandCard");
    expect(browser).toContain('event.type === "hand.shuffled"');
    expect(browser).toMatch(/function handCapacity\(\) \{\s+return 2;\s+\}/);
  });

  it("keeps same-kind Search and Scout targets bound to their dealt certificates", () => {
    expect(browser).toContain('const projectedSearchOfferIds = new Set((view.action_hand?.entries || [])');
    expect(browser).toContain('&& (!projectedSearchOfferIds.size || projectedSearchOfferIds.has(String(offer.offer_id || "")))');
    expect(browser).toContain('const searchGroups = projectedSearchOfferIds.size > 1');
    expect(browser).toContain('inspectAction.selectedTarget = () => searchCandidates.find((candidate) => (');
    expect(browser).toContain('const scoutOffers = (view.action_offers || []).filter((offer) => (');
    expect(browser).toContain('const projectedScoutOfferIds = new Set((view.action_hand?.entries || [])');
    expect(browser).toContain('const scoutGroups = projectedScoutOfferIds.size > 1');
    expect(browser).toContain('scoutAction.selectedTarget = () => scoutCandidates.find((candidate) => (');
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
