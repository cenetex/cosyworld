import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
const glossary = read("v2/docs/player-lexicon.md");

describe("player-facing action, card, linked-avatar, world-pack, and Journal lexicon", () => {
  it("checks in ownership, lifecycle, affordance, accessibility, and analytics guidance", () => {
    for (const section of [
      "## Canonical concepts",
      "Ownership and authority",
      "Lifecycle",
      "Primary affordance",
      "## Accessibility and analytics",
      "## Six-task comprehension check",
      "## Architecture relationship",
    ]) {
      expect(glossary).toContain(section);
    }
    for (const noun of ["**action**", "**card**", "**linked avatar**", "**item**", "**world pack**", "**Journal**"]) {
      expect(glossary).toContain(noun);
    }
  });
});
