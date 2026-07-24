import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
const index = read("v2/orchestrator-rust/src/index.html");
const gates = read("v2/content/ruby-high-first-bell/access_gates.json");
const glossary = read("v2/docs/player-lexicon.md");

describe("player-facing action, keepsake, pass, bundle, and world-pack lexicon", () => {
  it("passes the five-task comprehension copy contract", () => {
    const tasks = [
      {
        task: "make the avatar do something now",
        concept: 'data-player-concept="action"',
        cue: "Chat with someone here or explore the room.",
        analytics: 'data-analytics-event="action.select"',
      },
      {
        task: "inspect or keep a collected memory close",
        concept: 'data-player-concept="keepsake"',
        cue: "your keepsakes",
        analytics: 'data-analytics-event="keepsake.open"',
      },
      {
        task: "explain why a school room is locked",
        concept: 'data-player-concept="pass"',
        cue: "pass required",
      },
      {
        task: "reveal the contents produced by a Box",
        concept: 'data-player-concept="bundle"',
        cue: "open bundle",
        analytics: 'data-analytics-event="bundle.open"',
      },
      {
        task: "find mounted experience content",
        concept: 'data-player-concept="world-pack"',
        cue: "world packs mounted",
        analytics: 'data-analytics-event="world_pack.library.open"',
      },
    ];

    for (const task of tasks) {
      expect(index, task.task).toContain(task.concept);
      expect(`${index}\n${gates}`, task.task).toContain(task.cue);
      if (task.analytics) expect(index, task.task).toContain(task.analytics);
    }
  });

  it("uses the same distinctions in accessibility labels and collection copy", () => {
    expect(index).toContain('aria-label="Open current location keepsake"');
    expect(index).toContain('aria-label="Close keepsake details"');
    expect(index).toContain("Open ${escapeAttr(cardName)} keepsake details");
    expect(index).toContain("Keep a few keepsakes close—up to three.");
    expect(index).toContain("Opened avatar bundle:");
    expect(gates).toContain("Ruby High: First Bell location pass required.");
  });

  it("removes the former ambiguous player copy while preserving API compatibility", () => {
    for (const ambiguous of [
      "Choose a card below",
      "Your next cards are ready",
      "location card required",
      "Opened pack",
      "Avatar Pack",
      "your first card",
      "Keep a few cards close",
      "The card passes the room turn",
      "fresh pack of avatar cards",
    ]) {
      expect(`${index}\n${gates}`).not.toContain(ambiguous);
    }

    expect(index).toContain('${otherCardCount === 1 ? "action" : "actions"}');
    expect(index).toContain('${packs === 1 ? "bundle" : "bundles"}');
    expect(index).toContain('/nft/packs/open');
    expect(index).toContain("data-account-open-pack");
    expect(index).toContain("required_card_id");
  });

  it("checks in ownership, lifecycle, affordance, accessibility, and analytics guidance", () => {
    for (const section of [
      "## Canonical concepts",
      "Ownership and authority",
      "Lifecycle",
      "Primary affordance",
      "## Accessibility and analytics",
      "## Five-task comprehension check",
      "## Architecture relationship",
    ]) {
      expect(glossary).toContain(section);
    }
    for (const noun of ["**action**", "**keepsake**", "**pass**", "**bundle**", "**world pack**"]) {
      expect(glossary).toContain(noun);
    }
  });
});
