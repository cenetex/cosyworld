import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  buildDocs,
  currentDocuments,
  checkCurrentLinks,
} from "../../scripts/build-docs.mjs";

const temporary = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cosy-docs-"));
  temporary.push(root);
  await mkdir(path.join(root, "docs/archive/classic"), { recursive: true });
  await mkdir(path.join(root, "v2/docs"), { recursive: true });
  await writeFile(
    path.join(root, "docs/current-docs.json"),
    JSON.stringify({
      current: ["readme.md", "docs/current.md"],
      history: "docs/archive/classic/README.md",
    }),
  );
  await writeFile(
    path.join(root, "readme.md"),
    "# Current game\n\n[Play](docs/current.md#playing)\n",
  );
  await writeFile(
    path.join(root, "docs/current.md"),
    "# Playing\n\nCurrent card rules. ![Card](card.svg)\n",
  );
  await writeFile(
    path.join(root, "docs/card.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  );
  await writeFile(
    path.join(root, "docs/archive/classic/README.md"),
    "# Historical game\n\nClassic cast details.\n",
  );
  await writeFile(
    path.join(root, "docs/unselected.md"),
    "# Old notes\n\nOld prototype details.\n",
  );
  return root;
}

describe("current game documentation", () => {
  it("builds the selected AI reading list and keeps history separate", async () => {
    const root = await fixture();
    const { output } = await buildDocs(root);
    const combined = await readFile(
      path.join(output, "cosyworld-docs-combined.md"),
      "utf8",
    );
    expect(combined).toContain("Current card rules.");
    expect(combined).not.toContain("Classic cast details.");
    expect(combined).not.toContain("Old prototype details.");
    const current = await readFile(path.join(output, "readme.html"), "utf8");
    expect(current).toContain('href="docs/current.html#playing"');
    expect(current).toContain("History</h2>");
    expect(
      await readFile(path.join(output, "docs/current.html"), "utf8"),
    ).toContain('id="playing"');
    expect(
      await readFile(
        path.join(output, "docs/archive/classic/README.html"),
        "utf8",
      ),
    ).toContain("Classic cast details.");
    expect(
      await readFile(path.join(output, "docs/card.svg"), "utf8"),
    ).toContain("<svg");
  });
  it("requires valid current links and a separate historical reading list", async () => {
    const root = await fixture();
    await writeFile(
      path.join(root, "docs/current.md"),
      "# Current\n\n[Missing](missing.md)\n",
    );
    await expect(checkCurrentLinks(root)).rejects.toThrow(
      "docs/current.md: missing.md",
    );
    await writeFile(
      path.join(root, "docs/current-docs.json"),
      JSON.stringify({
        current: ["docs/archive/classic/README.md"],
        history: "docs/archive/classic/README.md",
      }),
    );
    await expect(currentDocuments(root)).rejects.toThrow(
      "History pages belong",
    );
  });
  it("keeps the repository's current source map and complete cast reading paths", async () => {
    const manifest = await checkCurrentLinks();
    expect(manifest.current).toContain("docs/current-game.md");
    expect(manifest.current).toContain("v2/docs/card-table/shared-worlds.md");
    const map = await readFile(
      new URL("../../docs/current-game.md", import.meta.url),
      "utf8",
    );
    for (const file of [
      "forest.json",
      "shared-cast.json",
      "entity-profiles.json",
      "packs.json",
    ]) {
      expect(map).toContain(file);
    }
  });
});
