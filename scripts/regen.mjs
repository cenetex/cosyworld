#!/usr/bin/env node
// Rebuild every committed generated output, in dependency order, with one
// command. Also settles a merge or rebase whose only conflicts are generated.
//   npm run regen              rebuild all outputs from their sources
//   npm run regen:check        fail if any output is stale (no writes)
//   npm run regen -- --base origin/main --radio   (--radio also redoes the radio catalog)
// A branch that changes rule modules, pack data, authored text or a public
// file regenerates large files, so two such branches conflict in them. Those
// files are never hand-merged. After `git merge origin/main` (or a rebase that
// stops), run `npm run regen`: it takes the branch's side of each conflicted
// generated file, rebuilds all of them from the merged sources, stages them,
// and tells you to continue. Anything else in conflict stops it.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classify, realWiringChanges } from "./lib/generated-files.mjs";

// Build order follows the data: packs, then the images and music they name,
// then the asset hashes, then the rules and dialogue bundles, then the
// catalogs and journeys that read the finished sources. `check` is what the
// drift check runs for the same output.
export function steps(base = "origin/main") {
  const node = (script, ...args) => ({ script, args });
  return [
    {
      name: "packs",
      build: node("v2/scripts/build-card-worldpacks.mjs"),
      check: node("v2/scripts/build-card-worldpacks.mjs", "--check"),
    },
    {
      name: "images",
      build: node("v2/scripts/build-card-images.mjs"),
      check: node("v2/scripts/build-card-images.mjs", "--check"),
    },
    {
      name: "music",
      build: node("v2/scripts/build-card-music.mjs"),
      check: node("v2/scripts/build-card-music.mjs", "--check"),
    },
    // Needs ffprobe, and track lengths differ between ffprobe versions, so it
    // only rebuilds with --radio (after changing the radio's music).
    {
      name: "radio",
      optional: true,
      build: node("v2/scripts/build-card-radio.mjs"),
      check: node("v2/scripts/build-card-radio.mjs", "--check"),
    },
    {
      name: "assets",
      build: node("v2/scripts/build-card-assets.mjs"),
      check: node("v2/scripts/build-card-assets.mjs", "--check"),
    },
    {
      name: "history",
      build: node("v2/scripts/build-card-world-history.mjs"),
      check: node("v2/scripts/build-card-world-history.mjs", "--check"),
    },
    {
      name: "rules",
      build: node("v2/scripts/next-shared-rules.mjs", base),
      check: node("v2/scripts/build-card-shared-engine.mjs", "--check"),
    },
    {
      name: "narrator",
      build: node("v2/scripts/build-card-shared-narrator.mjs"),
      check: node("v2/scripts/build-card-shared-narrator.mjs", "--check"),
    },
    {
      name: "content",
      build: node("v2/scripts/build-card-shared-content.mjs"),
      check: node("v2/scripts/build-card-shared-content.mjs", "--check"),
    },
    {
      name: "authored-text",
      build: node("v2/scripts/build-card-authored-text.mjs"),
      check: node("v2/scripts/build-card-authored-text.mjs", "--check"),
    },
    {
      name: "journeys",
      build: node("v2/scripts/build-test-journeys.mjs", "--write"),
      check: node("v2/scripts/build-test-journeys.mjs", "--check"),
    },
    // Reads the compiled packs, so it follows the packs step.
    {
      name: "level-maps",
      build: node("scripts/build-level-maps.mjs"),
      check: node("scripts/build-level-maps.mjs", "--check"),
    },
  ];
}

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const git = (args) =>
  execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
const gitPath = (name) =>
  path.resolve(repoRoot, git(["rev-parse", "--git-path", name]).trim());

function run({ script, args }) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.status !== 0)
    throw new Error(`node ${script} ${args.join(" ")} failed.`);
}

// While rebasing, the branch's own commit is "theirs"; while merging main
// into the branch, it is "ours".
function branchSide() {
  return existsSync(gitPath("rebase-merge")) ||
    existsSync(gitPath("rebase-apply"))
    ? "--theirs"
    : "--ours";
}

function settleConflicts(base) {
  const unmerged = git(["diff", "--name-only", "--diff-filter=U"])
    .split("\n")
    .filter(Boolean);
  if (!unmerged.length) return;
  const other = unmerged.filter((file) => classify(file) === "other");
  if (other.length) {
    throw new Error(
      `Resolve these by hand first (not generated files):\n  ${other.join("\n  ")}`,
    );
  }
  const mergeBase = git(["merge-base", "HEAD", base]).trim();
  for (const file of unmerged) {
    if (classify(file) === "wiring") {
      // The rules builder rewrites wiring from main. Refuse only when main's
      // side changed more than version bookkeeping, because that is real work
      // this would drop.
      const real = realWiringChanges(
        git(["diff", "-U0", mergeBase, base, "--", file]),
      );
      if (real.length)
        throw new Error(
          `${file} changed on ${base} beyond rules version wiring; merge it by hand:\n${real.join("\n")}`,
        );
      git(["checkout", base, "--", file]);
    } else {
      try {
        git(["checkout", branchSide(), "--", file]);
      } catch {
        // Deleted on one side: main's copy is the right start for a rebuild.
        git(["checkout", base, "--", file]);
      }
    }
    console.log(`[regen] settled ${file}`);
  }
}

function main(argv) {
  const check = argv.includes("--check");
  const baseAt = argv.indexOf("--base");
  const base = baseAt >= 0 ? argv[baseAt + 1] : "origin/main";
  if (check) {
    for (const step of steps(base)) {
      console.log(`[regen] check ${step.name}`);
      run(step.check);
    }
    console.log("[regen] every generated output is current.");
    return;
  }
  settleConflicts(base);
  for (const step of steps(base).filter(
    (s) => !s.optional || argv.includes(`--${s.name}`),
  )) {
    console.log(`[regen] ${step.name}`);
    run(step.build);
  }
  const changed = git(["status", "--porcelain", "--untracked-files=all"])
    .split("\n")
    .filter(Boolean);
  const generated = changed
    .map((line) => line.slice(3))
    .filter((file) => classify(file) !== "other");
  // Stage only generated outputs and files that were in conflict.
  if (generated.length) git(["add", "--", ...generated]);
  const merging = existsSync(gitPath("MERGE_HEAD"));
  const rebasing =
    existsSync(gitPath("rebase-merge")) || existsSync(gitPath("rebase-apply"));
  console.log(
    `[regen] rebuilt; ${generated.length} generated file(s) differ from HEAD.`,
  );
  if (merging) console.log("[regen] Finish with: git commit --no-edit");
  else if (rebasing) console.log("[regen] Finish with: git rebase --continue");
  else
    console.log(
      "[regen] Review with git diff --stat, then commit the generated files with your change.",
    );
}

const invoked =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`[regen] ${error.message}`);
    process.exitCode = 1;
  }
}
