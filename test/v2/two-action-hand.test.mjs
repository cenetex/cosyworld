import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const browser = fs.readFileSync(
  path.join(repoRoot, "v2/orchestrator-rust/src/index.html"),
  "utf8",
);

describe("three-slot Story Hand", () => {
  it("keeps Story, Self, and Anchor visible and puts targeted Discard inside card details", () => {
    expect(browser).not.toContain('id="command-toggle"');
    expect(browser).not.toContain('id="command-palette"');
    expect(browser).not.toContain('id="command-input"');
    expect(browser).not.toContain('id="all-actions-modal"');
    expect(browser).not.toContain("data-all-action-index");
    expect(browser).toContain('id="primary"');
    expect(browser).toContain('id="secondary"');
    expect(browser).toContain('id="tertiary"');
    expect(browser).not.toContain('id="shuffle"');
    expect(browser).not.toContain('data-player-concept="think"');
    expect(browser).toContain('id="action-modal-discard"');
    expect(browser).toContain('data-analytics-event="action.discard"');
    expect(browser).toContain('const buttonIds = ["primary", "secondary", "tertiary"];');
    expect(browser).toContain('async function discardActionCard(focused = visibleFocusedAction())');
    expect(browser).toContain('const think = entry?.think;');
    expect(browser).toContain('command: "think"');
    expect(browser).toContain('postResult("/commands", withAccess({');
    expect(browser).not.toContain('post("/actions/draw"');
    expect(browser).not.toContain("advanceHandPage");
    expect(browser).not.toContain("drawNextHandCard");
    expect(browser).toContain('event.type === "hand.thought"');
    expect(browser).toContain('Discard this ${discardCertificate.slot || action.storyHandSlot || "Story Hand"} card');
    expect(browser).toMatch(/function handCapacity\(\) \{\s+return state\?\.branch \? 2 : Number\(state\?\.action_hand\?\.capacity \|\| 3\);\s+\}/);
  });

  it("declares combat before offering an attack", () => {
    expect(browser).toContain('const declaringCombat = !view.combat;');
    expect(browser).toContain('declaringCombat ? "/actions/declare-combat" : "/actions/attack"');
    expect(browser).toContain('No attack is made yet; ordinary advancement pauses while combat is active.');
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

  it("shows Travel and the destination without route-type copy in the hand", () => {
    const routeBlock = browser.slice(
      browser.indexOf("const projectedRouteOfferIds"),
      browser.indexOf('if (options.has("use_item"))'),
    );
    const cardRenderBlock = browser.slice(
      browser.indexOf("function renderButton"),
      browser.indexOf("function actionBarActions"),
    );

    expect(routeBlock).toContain(
      "? (firstPathwayDirection?.endpointName || firstExit.destination_location_name)",
    );
    expect(routeBlock).toContain("destinationOnlyCardAriaLabel: destinationOnlyCardLabel");
    expect(routeBlock).not.toContain("conciseRouteLabel");
    expect(cardRenderBlock).toContain(
      'String(action?.intention || "").toLowerCase() === "travel"',
    );
    expect(cardRenderBlock).toContain('? "Travel"');
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
