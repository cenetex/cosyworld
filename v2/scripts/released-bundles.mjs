// Guard the shared rules bundles that journals replay (CLAUDE.md, #2168).
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// A bundle that is pinned for replay, or already on main (main's newest
// bundle is live on .dev), is fixed: rebuilding it in place would change how
// saved journals replay. Changed rules get a new version from the mint script.
export async function releasedBundleRefusal(file, next, root) {
  const name = fileURLToPath(file).split("/").pop();
  const version = /^engine-v(\d+)\.js$/u.exec(name)?.[1];
  let current = null;
  try {
    current = await readFile(file, "utf8");
  } catch {
    return null;
  }
  if (current === next) return null;
  const mint =
    "Rules changed: mint the next version with npm run v2:card:shared:next instead.";
  const pins = await readFile(
    join(root, "test/card-released-rules.test.mjs"),
    "utf8",
  ).catch(() => "");
  if (
    version &&
    new RegExp(`^\\s*${version}: "[0-9a-f]{64}",$`, "mu").test(pins)
  )
    return `${name} is a released, pinned bundle. ${mint}`;
  try {
    execFileSync(
      "git",
      [
        "cat-file",
        "-e",
        `origin/main:v2/orchestrator-rust/src/card_shared/${name}`,
      ],
      { cwd: root, stdio: "ignore" },
    );
    return `${name} is already on main and live on .dev. ${mint}`;
  } catch {
    return null;
  }
}
