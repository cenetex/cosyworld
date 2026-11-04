import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { releasedBundleRefusal } from "../v2/scripts/released-bundles.mjs";

// A scratch root with a pinned rules 5 and an unpinned rules 6, outside git,
// so only the pin decides.
function scratch() {
  const root = mkdtempSync(join(tmpdir(), "bundles-"));
  mkdirSync(join(root, "test"));
  writeFileSync(
    join(root, "test/card-released-rules.test.mjs"),
    `const released = {\n  5: "${"a".repeat(64)}",\n};\n`,
  );
  for (const v of [5, 6]) writeFileSync(join(root, `engine-v${v}.js`), "old");
  const file = (v) => pathToFileURL(join(root, `engine-v${v}.js`));
  return { root, file };
}

describe("the plain engine build never rewrites a released bundle", () => {
  it("refuses a pinned bundle whose bytes would change", async () => {
    const { root, file } = scratch();
    expect(await releasedBundleRefusal(file(5), "new", root)).toMatch(
      /released, pinned bundle.*v2:card:shared:next/u,
    );
  });
  it("allows identical bytes and an unpinned bundle", async () => {
    const { root, file } = scratch();
    expect(await releasedBundleRefusal(file(5), "old", root)).toBeNull();
    expect(await releasedBundleRefusal(file(6), "new", root)).toBeNull();
  });
});
