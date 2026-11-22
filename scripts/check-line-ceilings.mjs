import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { classify } from "./check-change-budget.mjs";

const CONFIG = "scripts/line-ceilings.json";
const BUDGET = "scripts/change-budget.json";
const CODE = /\.(?:mjs|cjs|js|ts|rs|css|html|sh)$/u;

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const lines = (file) => {
  try {
    return (readFileSync(file, "utf8").match(/\n/gu) ?? []).length;
  } catch {
    return null;
  }
};

export function audit({ config, budget, files, count, changed = null }) {
  const errors = [],
    notes = [],
    listed = config.ceilings;
  for (const [file, ceiling] of Object.entries(listed)) {
    const now = count(file);
    const touched = changed?.has(file);
    if (now === null) {
      (touched ? errors : notes).push(
        `${file} is gone; drop its ceiling (--write).`,
      );
      continue;
    }
    if (now > ceiling)
      errors.push(
        `${file} grew from ${ceiling} to ${now} lines. Put the new code in its own module, or raise its ceiling in ${CONFIG} in the same diff and say why in the pull request.`,
      );
    else if (now < ceiling)
      (touched ? errors : notes).push(
        `${file} shrank from ${ceiling} to ${now} lines; lower its ceiling (node scripts/check-line-ceilings.mjs --write).`,
      );
  }
  for (const file of files) {
    if (
      Object.hasOwn(listed, file) ||
      !CODE.test(file) ||
      classify(file, budget)
    )
      continue;
    const now = count(file);
    if (now !== null && now > config.threshold)
      errors.push(
        `${file} has ${now} lines, over the ${config.threshold}-line threshold. Split it, or list it in ${CONFIG} in the same diff and say why in the pull request.`,
      );
  }
  return { errors, notes };
}

export function lowered(config, count) {
  const ceilings = {};
  for (const [file, ceiling] of Object.entries(config.ceilings)) {
    const now = count(file);
    if (now !== null) ceilings[file] = Math.min(ceiling, now);
  }
  return { ...config, ceilings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const base = args.includes("--base")
    ? args[args.indexOf("--base") + 1]
    : null;
  const config = JSON.parse(readFileSync(CONFIG, "utf8"));
  if (args.includes("--write")) {
    writeFileSync(
      CONFIG,
      `${JSON.stringify(lowered(config, lines), null, 2)}\n`,
    );
    console.log(`[line-ceilings] ${CONFIG} lowered to the current sizes.`);
    process.exit(0);
  }
  const budget = JSON.parse(readFileSync(BUDGET, "utf8"));
  const files = git("ls-files").split("\n");
  const changed = base
    ? new Set(git("diff", "--name-only", `${base}...HEAD`).split("\n"))
    : null;
  const { errors, notes } = audit({
    config,
    budget,
    files,
    count: lines,
    changed,
  });
  for (const note of notes) console.log(`[line-ceilings] note: ${note}`);
  if (errors.length) {
    for (const error of errors) console.error(`[line-ceilings] ${error}`);
    process.exit(1);
  }
  console.log(
    `[line-ceilings] ok: ${Object.keys(config.ceilings).length} large files at or under their ceilings; no other code file over ${config.threshold} lines.`,
  );
}
