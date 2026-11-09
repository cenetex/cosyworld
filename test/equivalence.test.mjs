import { describe, it, expect } from "vitest";
import { copyFile, mkdtemp, readdir, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { compare } from "../v2/scripts/equivalence.mjs";

// A real pre-refactor versus post-refactor comparison (#1390). The fixture is
// the world.mjs monolith captured before the facade split began; its sibling
// imports resolve through symlinks to the current v2/card-game files (which
// the split did not change). The facade — world.mjs plus world/*.mjs — must
// reproduce the monolith's observable surface byte-for-byte.
const cardDir = fileURLToPath(new URL("../v2/card-game/", import.meta.url));
const fixture = fileURLToPath(
  new URL("./fixtures/pre-refactor/world.mjs", import.meta.url),
);
const currentWorld = new URL("../v2/card-game/world.mjs", import.meta.url);

async function preRefactorWorld() {
  const dir = await mkdtemp(path.join(tmpdir(), "cosyworld-pre-"));
  await copyFile(fixture, path.join(dir, "world.mjs"));
  for (const name of await readdir(cardDir)) {
    if (name === "world.mjs") continue;
    const src = path.join(cardDir, name);
    const dst = path.join(dir, name);
    await symlink(src, dst, (await stat(src)).isFile() ? "file" : "dir");
  }
  return pathToFileURL(path.join(dir, "world.mjs"));
}

describe("equivalence harness (#1387)", () => {
  it(
    "plays the pre-refactor monolith and post-refactor facade identically",
    async () => {
      const oldWorld = await preRefactorWorld();
      const reports = await compare(oldWorld, currentWorld, {
        seeds: [7, 42, 1729],
        steps: 400,
      });
      for (const r of reports) {
        expect(
          r.equal,
          `seed ${r.seed} firstDiff ${r.firstDiff}`,
        ).toBe(true);
      }
    },
    300_000,
  );
});
