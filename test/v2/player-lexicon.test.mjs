import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
const index = read("v2/orchestrator-rust/src/index.html");

describe("player-facing action, card, linked-avatar, world-pack, and Journal lexicon", () => {
  it("passes the six-task comprehension copy contract", () => {
    const tasks = [
      {
        task: "make the avatar do something now",
        concept: 'data-player-concept="action"',
        cue: "Chat with someone here or explore the room.",
        analytics: 'data-analytics-event="action.select"',
      },
      {
        task: "inspect the person, item, or place being shown",
        concept: 'data-player-concept="card"',
        cue: "Open current location card",
        analytics: 'data-analytics-event="card.open"',
      },
      {
        task: "understand why a wallet-linked character appears",
        concept: 'data-player-concept="linked-avatar"',
        cue: "link avatar wallet",
        analytics: 'data-analytics-event="linked_avatar.link"',
      },
      {
        task: "understand official place access",
        concept: 'data-player-concept="world-pack"',
        cue: "Ordinary places are public and need no wallet.",
      },
      {
        task: "find mounted experience content",
        concept: 'data-player-concept="world-pack"',
        cue: "world packs mounted",
        analytics: 'data-analytics-event="world_pack.library.open"',
      },
      {
        task: "review what changed in the current place",
        concept: 'data-player-concept="journal"',
        cue: 'aria-label="Journal"',
        analytics: 'data-analytics-event="journal.open"',
      },
    ];

    for (const task of tasks) {
      expect(index, task.task).toContain(task.concept);
      expect(index, task.task).toContain(task.cue);
      if (task.analytics) expect(index, task.task).toContain(task.analytics);
    }
  });

  it("uses the same distinctions in accessibility labels and identity copy", () => {
    expect(index).toContain('aria-label="Open current location card"');
    expect(index).toContain('aria-label="Close card details"');
    expect(index).toContain("supported linked avatars");
    expect(index).toContain('<span>Identity</span>${identityAction}');
    expect(index).toContain('data-passkey-continue>Sign in</button>');
    expect(index).toContain('class="minimal-menu-value">Passkey</span>');
  });

  it("removes the retired collection and wallet-gate surface", () => {
    for (const retired of [
      'data-player-concept="keepsake"',
      'data-player-concept="bundle"',
      "keepsake.open",
      "bundle.open",
      "/nft/packs/open",
      "data-account-open-pack",
      "required_card_id",
      "owned_card_ids",
      "materialize",
    ]) {
      expect(index).not.toContain(retired);
    }

    expect(index).not.toContain('id="all-actions-title">all actions</h2>');
    expect(index).not.toContain("data-all-action-index");
    expect(index).not.toContain('data-player-concept="action-menu"');
    expect(index).not.toContain('data-player-concept="think"');
    expect(index).toContain('id="action-modal-discard"');
    expect(index).toContain('data-hand-discard="primary"');
    expect(index).toContain('data-meld-select="primary"');
    expect(index).toContain('`Think past this ${discardCertificate.slot || action.storyHandSlot || "Story Hand"} card;');
    expect(index).toContain('command: "think"');
    expect(index).not.toContain('command: "pass"');
  });
});
