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
  it("keeps Location, Item, and Avatar cards selectable with per-card Think", () => {
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
    expect(browser).toContain('data-meld-select="primary"');
    expect(browser).toContain('data-hand-discard="primary"');
    expect(browser).toContain('data-meld-select="secondary"');
    expect(browser).toContain('data-hand-discard="tertiary"');
    expect(browser).toContain("function selectStoryHandCardForMeld(id)");
    expect(browser).toContain("function playSceneMeld()");
    expect(browser).toContain("async function discardStoryHandCard(id)");
    expect(browser).toContain('prompt.classList.toggle("hand-expanded", expanded);');
    expect(browser).not.toMatch(/function usesInlineStoryHand\(\) \{\s+return false;\s+\}/);
    expect(browser).toContain('if (!usesInlineStoryHand()) {');
    expect(browser).toContain('openActionModal(action, { handCard: true });');
    expect(browser).toContain('setStoryHandExpanded(true, action);');
    expect(browser).toContain('discardStoryHandCard(discard.getAttribute("data-hand-discard") || "")');
    expect(browser).not.toContain("function travellingPartyHeaderHtml");
    expect(browser).not.toContain('writeStatus(`${statusActivity.label} · ${statusActivity.text}`');
    expect(browser).toContain('const buttonIds = ["primary", "secondary", "tertiary"];');
    expect(browser).toContain('async function discardActionCard(focused = visibleFocusedAction())');
    expect(browser).toContain('const think = entry?.think;');
    expect(browser).toContain('command: "think"');
    expect(browser).toContain('postResult("/commands", withAccess({');
    expect(browser).not.toContain('post("/actions/draw"');
    expect(browser).not.toContain("advanceHandPage");
    expect(browser).not.toContain("drawNextHandCard");
    expect(browser).toContain('event.type === "hand.thought"');
    expect(browser).toContain('Think past this ${discardCertificate.slot || action.storyHandSlot || "Story Hand"} card');
    expect(browser).toMatch(/function handCapacity\(\) \{\s+return state\?\.branch \? 2 : Number\(state\?\.action_hand\?\.capacity \|\| 3\);\s+\}/);
  });

  it("declares combat before offering an attack", () => {
    expect(browser).toContain('const declaringCombat = !view.combat;');
    expect(browser).toContain('declaringCombat ? "/actions/declare-combat" : "/actions/attack"');
    expect(browser).toContain('No attack is made yet; ordinary advancement pauses while combat is active.');
  });

  it("shows Think cost and shares one expandable turn log", () => {
    expect(browser).toContain('id="turn-rope-toggle"');
    expect(browser).toContain('id="turn-log"');
    expect(browser).not.toContain('id="combat-dock"');
    expect(browser).toContain('think?.available ? `Think · ${discardCost}` : "Think"');
    expect(browser).toContain('discardCertificate.free ? "think · free" : "think · turn"');
    expect(browser).toContain('const spendsTurn = think.consumes_turn === true || think.free === false;');
    expect(browser).toContain('if (spendsTurn) holdStoryHandForAction(focused, { kind: "discard" });');
    expect(browser).toContain('function turnEventsForPresentation(events, view = state)');
    expect(browser).toContain('if (view?.combat) return combatEventsForPresentation(events);');
    expect(browser).toContain('const canReviewLatestTurn = Boolean(actorId && view?.turn?.enabled && latestBeat);');
    expect(browser).toContain('if (!combat && !progress && !canReviewLatestTurn)');
  });

  it("builds a one-to-three noun meld and infers one exact verb without options", () => {
    expect(browser).toContain('id="scene-meld"');
    expect(browser).not.toContain("data-meld-approach");
    expect(browser).not.toContain('id="scene-meld-verbs"');
    expect(browser).toContain("function exactActionForOffer(offer)");
    expect(browser).toContain("function sceneMeldResolutionRank(kind)");
    expect(browser).toContain("const selectedIds = new Set(selected.map(sceneMeldEntityKey));");
    expect(browser).toContain("const chosenOffer = candidates[0] || null;");
    expect(browser).toContain("const chosenVerb = exactActionForOffer(chosenOffer);");
    expect(browser).toContain("sceneMeldKeys = [...sceneMeldKeys, key];");
    expect(browser).toContain("sceneMeldKeys = sceneMeldKeys.filter");
    expect(browser).toContain("const nounOrder = { location: 0, avatar: 1, item: 2 };");
    expect(browser).toContain("const action = originalStoryHandAction(resolution.chosenVerb);");
    expect(browser).toContain("action.selectedCardIds = resolution.selected.map(sceneMeldEntityKey);");
    expect(browser).toContain("selected_card_ids: (pendingAction?.selectedCardIds || []).map(String)");
    expect(browser).toContain("void runAction(action);");
  });

  it("renders noun cards without action mechanics or choices", () => {
    const nounRender = browser.slice(
      browser.indexOf("if (action.nounCard)"),
      browser.indexOf('if (action.kind === "model-interaction"'),
    );
    expect(nounRender).toContain('const label = String(action?.nounEntry?.label');
    expect(nounRender).toContain('button.title = `${sceneCardLabel}: ${label}`;');
    expect(nounRender).not.toContain("exactVerb");
    expect(nounRender).not.toContain("effectText");
    expect(nounRender).not.toContain("sourceText");
    expect(nounRender).not.toContain("choices");
    expect(browser).toContain("const firstChat = actorTargets.find");
    expect(browser).not.toContain('detail: "choose someone nearby"');
  });

  it("shows each action result once without a second narration panel", () => {
    expect(browser).not.toContain("actionOutcome");
    expect(browser).not.toContain("action-outcome-scene");
    expect(browser).not.toContain("This result is final");
  });

  it("keeps free campaign Class selection playable outside room initiative", () => {
    expect(browser).toContain('kind: "choose-class",\n            concurrencyPolicy: "concurrent",');
    expect(browser).toContain("function storyHandActionWaitsForTurn(action)");
    expect(browser).toContain('String(action?.concurrencyPolicy || "") !== "concurrent"');
    expect(browser).toContain("const waitingForTurn = storyHandActionWaitsForTurn(original);");
    expect(browser).toContain("if (!action || actionBusy || storyHandActionWaitsForTurn(action)) return;");
  });

  it("keeps same-kind Search and Scout targets bound to their dealt certificates", () => {
    expect(browser).toContain('const projectedSearchOfferIds = handOfferIdsForKind("search");');
    expect(browser).toContain('&& (!projectedSearchOfferIds.size || projectedSearchOfferIds.has(String(offer.offer_id || "")))');
    expect(browser).toContain('const searchGroups = projectedSearchOfferIds.size > 1');
    expect(browser).toContain('inspectAction.selectedTarget = () => searchCandidates.find((candidate) => (');
    expect(browser).toContain('const scoutOffers = (view.action_offers || []).filter((offer) => (');
    expect(browser).toContain('const projectedScoutOfferIds = handOfferIdsForKind("explore_path");');
    expect(browser).toContain('const scoutGroups = projectedScoutOfferIds.size > 1');
    expect(browser).toContain('scoutAction.selectedTarget = () => scoutCandidates.find((candidate) => (');
    expect(browser).toContain('scoutAction.selectedPayload = () => ({');
  });

  it("keeps the pending campaign Class card visible and playable outside room initiative", () => {
    const classSelectionBlock = browser.slice(
      browser.indexOf("if (characterIdentity?.class_selection_ready"),
      browser.indexOf("const turn = view.turn || {}"),
    );
    const handOrderBlock = browser.slice(
      browser.indexOf("function orderedActionIndexesForHand"),
      browser.indexOf("function handCapacity"),
    );

    expect(classSelectionBlock).toContain('kind: "choose-class"');
    expect(classSelectionBlock).toContain("standaloneHandProjection: true");
    expect(classSelectionBlock).toContain('concurrencyPolicy: "concurrent"');
    expect(handOrderBlock).toContain("actions[index]?.standaloneHandProjection === true");
    expect(handOrderBlock).toContain("if (standaloneIndexes.length) return standaloneIndexes;");
    expect(browser).toContain("function storyHandActionWaitsForTurn(action)");
    expect(browser).toContain('String(action?.concurrencyPolicy || "") !== "concurrent"');
    expect(browser).toContain("const waitingForTurn = storyHandActionWaitsForTurn(original);");
    expect(browser).toContain("if (!action || actionBusy || storyHandActionWaitsForTurn(action)) return;");
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
      "const routeDestinationName = firstPathwayDirection?.endpointName || firstExit.destination_location_name",
    );
    expect(routeBlock).toContain("destinationOnlyCardAriaLabel: destinationOnlyCardLabel");
    expect(routeBlock).toContain("`Begin route to ${routeDestinationName}`");
    expect(routeBlock).toContain("minimalTravelPresentation: onePath && !searchingPathway && !fleeing");
    expect(routeBlock).not.toContain("conciseRouteLabel");
    expect(cardRenderBlock).toContain(
      'String(action?.intention || "").toLowerCase() === "travel"',
    );
    expect(cardRenderBlock).toContain('? "Travel"');
    expect(cardRenderBlock).toContain('const visibleCostText = minimalTravelCard && !orbCost ? "" : costText');
  });

  it("shows suit emojis instead of suit names on action cards", () => {
    const cardRenderBlock = browser.slice(
      browser.indexOf("function renderButton"),
      browser.indexOf("function actionBarActions"),
    );

    expect(browser).toContain('head: "🧠"');
    expect(browser).toContain('heart: "❤️"');
    expect(browser).toContain('honor: "🛡️"');
    expect(browser).toContain('hustle: "🛠️"');
    expect(cardRenderBlock).toContain("const suitEmoji = actionCardSuitEmoji(suit);");
    expect(cardRenderBlock).toContain('suitEmoji ? `${suitEmoji} ${exactVerb}` : exactVerb');
    expect(cardRenderBlock).not.toContain('suit ? `${suit} ${exactVerb}` : exactVerb');
    expect(cardRenderBlock).toContain("const sceneCardLabel = sceneMeldCardTypeLabel(action);");
    expect(cardRenderBlock).toContain('suit ? `${suit} suit` : "control"');
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
