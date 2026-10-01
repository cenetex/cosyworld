import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const browser = fs.readFileSync(
  path.join(repoRoot, "v2/orchestrator-rust/src/index.html"),
  "utf8",
);

function functionBody(source, signature) {
  const start = source.indexOf(signature);
  expect(start, `${signature} exists`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error(`${signature} is unbalanced`);
}

describe("pending class choice in the Story Hand", () => {
  it("shows the standalone class card instead of leaving every card with only Think", () => {
    // Once an avatar's first qualifying action makes its class choice ready,
    // buildActions replaces the action list with one standalone progression
    // card. The pairing hand is built from dealt noun cards, so without this
    // branch that card has nowhere to appear and each noun card offers only
    // Think, with no way to reach the choice.
    const body = functionBody(browser, "function actionBarActions()");
    const standalone = body.indexOf("standaloneHandProjection === true");
    const nouns = body.indexOf("const nounEntries");
    expect(standalone).toBeGreaterThan(0);
    expect(nouns).toBeGreaterThan(0);
    expect(standalone, "the standalone card is chosen before noun cards").toBeLessThan(nouns);
    expect(body).toContain("handKey: actionHandKey(standalone)");
  });

  it("still builds the class card as a standalone hand projection", () => {
    expect(browser).toContain("standaloneHandProjection: true");
    expect(browser).toContain('kind: "choose-class"');
  });
});
