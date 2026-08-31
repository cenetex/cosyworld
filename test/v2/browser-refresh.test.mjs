import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const browser = fs.readFileSync(
  path.join(repoRoot, "v2/orchestrator-rust/src/index.html"),
  "utf8",
);

describe("browser refresh", () => {
  it("renders the playable room before hydrating its journal", () => {
    const refresh = browser
      .split("async function refresh()")[1]
      .split("function queueRefresh()")[0];

    expect(refresh.indexOf("render();")).toBeLessThan(
      refresh.indexOf("await recentEventsRequest"),
    );
    expect(refresh).toContain(
      "The room is ready. Its journal is still catching up.",
    );
  });
});
