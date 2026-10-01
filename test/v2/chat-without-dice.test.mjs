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

describe("room chat without dice", () => {
  it("does not render roll events in the chat timeline", () => {
    const body = functionBody(browser, "function timelineEventHtml(event)");
    expect(body).toContain('if (isRollEvent(event)) return "";');
    expect(body).not.toContain("rollHtml(event)");
  });

  it("keeps the roll renderer for room memory and the combat dock", () => {
    expect(browser).toContain("function rollHtml(event)");
    expect(browser).toContain("function isRollEvent(event)");
    expect(browser).toContain("function rollMeta(event)");
  });
});
