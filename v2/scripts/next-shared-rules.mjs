// Give a branch's shared rules the next free version after main's live rules.
// Main's newest rules bundle may already be live, so its bytes are fixed for
// journal replay. Branches that change rule modules all want the next
// version. Run this after rebasing or merging main:
//
//   node v2/scripts/next-shared-rules.mjs [base-ref]
//
// It restores main's released bundles and version wiring, rebuilds the rules,
// and adds one new version only when the rebuilt bytes differ from main's.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { wireRules } from "./rules-wiring.mjs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const base = process.argv[2] || "origin/main";
const dir = "v2/orchestrator-rust/src/card_shared";
const wiring = [
  `${dir}/engine.rs`,
  `${dir}/full_world.rs`,
  "test/card-released-rules.test.mjs",
  "v2/scripts/build-card-shared-engine.mjs",
];
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" });
const read = (path) => readFileSync(new URL(path, `file://${root}`), "utf8");
const write = (path, text) =>
  writeFileSync(new URL(path, `file://${root}`), text);
const sha = (text) => createHash("sha256").update(text).digest("hex");

const bundles = (names) =>
  names
    .map((name) => /^engine-v(\d+)\.js$/u.exec(name)?.[1])
    .filter(Boolean)
    .map(Number);
const live = Math.max(
  ...bundles(git("ls-tree", "--name-only", `${base}:${dir}`).split("\n")),
);

// A version line, a bundle path or a pinned hash is wiring. Any other change
// to these files is real work, so stop instead of replacing it.
const isWiring = (line) =>
  /VERSION|SOURCE|engine-v\d+\.js|^\s*\d+: "[0-9a-f]{64}",$|^\/\/ Rules /u.test(
    line,
  );
for (const path of wiring) {
  const diff = git("diff", "-U0", base, "--", path)
    .split("\n")
    .filter((l) => /^[+-](?![+-])/u.test(l))
    .map((l) => l.slice(1).trim())
    .filter((l) => l && !isWiring(l));
  if (diff.length)
    throw new Error(
      `${path} has changes besides rules version wiring:\n${diff.join("\n")}`,
    );
}

// Restore main's released bundles and wiring, and drop versions this branch
// claimed before main moved on.
for (const version of bundles(readdirSync(new URL(dir, `file://${root}`))))
  if (version > live)
    unlinkSync(new URL(`${dir}/engine-v${version}.js`, `file://${root}`));
git(
  "checkout",
  base,
  "--",
  ...wiring,
  ...Array.from(
    { length: live - 1 },
    (_, i) => `${dir}/engine-v${i + 2}.js`,
  ).filter(
    (path) =>
      existsSync(new URL(path, `file://${root}`)) || git("ls-tree", base, path),
  ),
);

// Build into the live path only to compare with main; it is restored next.
execFileSync("node", ["v2/scripts/build-card-shared-engine.mjs"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, COSYWORLD_MINT_PROBE: "1" },
});
const livePath = `${dir}/engine-v${live}.js`;
const built = read(livePath);
git("checkout", base, "--", livePath);
if (built === read(livePath)) {
  console.log(
    `Shared rules match live version ${live}; no new version needed.`,
  );
  process.exit(0);
}

const wired = wireRules(
  Object.fromEntries(wiring.map((path) => [path, read(path)])),
  live,
  sha(read(livePath)),
);
for (const [path, text] of Object.entries(wired)) write(path, text);
write(`${dir}/engine-v${live + 1}.js`, built);
console.log(
  `Rules ${live} stay live and pinned; this branch now builds rules ${live + 1}.` +
    "\nRebuild card assets and commit the generated files.",
);
