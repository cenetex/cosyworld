import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { publicAssets } from "../v2/card-game/public-assets.mjs";
import { createServer } from "../v2/card-game/serve.mjs";

const root = new URL("../v2/card-game/", import.meta.url);
describe("one public card asset list", () => {
  it("includes every local import used by the browser", () => {
    const files = new Set(publicAssets.map(({ file }) => file));
    for (const { file } of publicAssets.filter((asset) =>
      asset.file.endsWith(".mjs"),
    )) {
      const source = readFileSync(new URL(file, root), "utf8");
      for (const [, dependency] of source.matchAll(
        /(?:from\s+|import\s*)["'](\.[^"']+)["']/g,
      )) {
        const resolved = new URL(dependency, new URL(file, root));
        expect(
          files.has(resolved.href.slice(root.href.length)),
          `${file} imports ${dependency}`,
        ).toBe(true);
      }
    }
  });

  it("keeps the checked-in Rust assets current", () => {
    expect(() =>
      execFileSync(process.execPath, [
        "v2/scripts/build-card-assets.mjs",
        "--check",
      ]),
    ).not.toThrow();
  });

  it("serves every listed file with the expected type and bytes", async () => {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      for (const {
        file,
        contentType,
        source = file,
        offset = 0,
      } of publicAssets) {
        const response = await fetch(`${base}/card-game/${file}`);
        expect(response.status, file).toBe(200);
        expect(response.headers.get("content-type"), file).toBe(contentType);
        const actual = Buffer.from(await response.arrayBuffer());
        expect(
          actual.equals(readFileSync(new URL(source, root)).subarray(offset)),
          file,
        ).toBe(true);
      }
      for (const file of ["serve.mjs", "public-assets.mjs", "README.md"]) {
        const response = await fetch(`${base}/card-game/${file}`);
        expect(response.status, file).toBe(404);
        await response.arrayBuffer();
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
