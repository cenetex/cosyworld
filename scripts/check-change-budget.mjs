#!/usr/bin/env node
// Keep each branch small: fail when hand-written changes against the merge
// base exceed the budget in scripts/change-budget.json. The pre-push hook and
// CI both run this. Assets, lockfiles, and generated outputs never count.
//
//   node scripts/check-change-budget.mjs [--base origin/main] [--head HEAD]
//
// Override, rarely: COSYWORLD_LARGE_CHANGE=<reason>, or in CI a
// `Large-Change: <reason>` line in the pull request body (COSYWORLD_PR_BODY).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CONFIG_PATH = fileURLToPath(
  new URL("./change-budget.json", import.meta.url),
);

export function loadConfig(file = CONFIG_PATH) {
  return JSON.parse(readFileSync(file, "utf8"));
}

// The excluded group a path belongs to, or null when it counts.
export function classify(file, config) {
  for (const [group, { paths }] of Object.entries(config.excluded)) {
    if (
      paths.some(
        (glob) =>
          path.posix.matchesGlob(file, glob) ||
          path.posix.matchesGlob(file.toLowerCase(), glob),
      )
    )
      return group;
  }
  return null;
}

// Parse `git diff --numstat -z`: "added\tdeleted\tpath\0", or for a rename
// "added\tdeleted\t\0from\0to\0". Binary files report "-".
export function parseNumstat(text) {
  const fields = text.split("\0");
  const entries = [];
  for (let i = 0; i < fields.length; i += 1) {
    if (!fields[i]) continue;
    const [added, deleted, file] = fields[i].split("\t");
    const target = file || fields[(i += 2)];
    const binary = added === "-" || deleted === "-";
    entries.push({
      file: target,
      lines: binary ? 0 : Number(added) + Number(deleted),
      binary,
    });
  }
  return entries;
}

export function measure(entries, config) {
  const totals = { code: 0, excluded: {}, codeFiles: [] };
  for (const { file, lines, binary } of entries) {
    const group = binary ? "binary" : classify(file, config);
    if (group) totals.excluded[group] = (totals.excluded[group] ?? 0) + lines;
    else {
      totals.code += lines;
      totals.codeFiles.push({ file, lines });
    }
  }
  totals.codeFiles.sort((a, b) => b.lines - a.lines);
  return totals;
}

export function overrideReason(env) {
  const direct = env.COSYWORLD_LARGE_CHANGE?.trim();
  if (direct) return direct;
  return (
    env.COSYWORLD_PR_BODY?.match(/^Large-Change:[ \t]*(\S.*)$/im)?.[1].trim() ??
    null
  );
}

// Returns { ok, lines } where lines are the report to print.
export function evaluate(totals, config, env = {}) {
  const { budget } = config;
  const excluded = Object.entries(totals.excluded)
    .map(([group, lines]) => `${group} ${lines}`)
    .join(", ");
  const lines = [
    `[change-budget] ${totals.code}/${budget} hand-written lines changed` +
      (excluded ? ` (not counted: ${excluded})` : ""),
  ];
  if (totals.code <= budget) return { ok: true, lines };
  const reason = overrideReason(env);
  if (reason) {
    lines.push(
      `[change-budget] WARNING: over budget, allowed by override: ${reason}`,
    );
    return { ok: true, lines };
  }
  lines.push(
    `[change-budget] Over budget by ${totals.code - budget} lines. Split this branch into smaller changes that each land on main.`,
    "[change-budget] Largest files:",
    ...totals.codeFiles
      .slice(0, 8)
      .map(({ file, lines: n }) => `  ${n}\t${file}`),
    '[change-budget] Exclusions live in scripts/change-budget.json. A rare deliberate exception: COSYWORLD_LARGE_CHANGE=<reason> locally, or a "Large-Change: <reason>" line in the PR body.',
  );
  return { ok: false, lines };
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function main(args) {
  const base = option(args, "--base", "origin/main");
  const head = option(args, "--head", "HEAD");
  const numstat = execFileSync(
    "git",
    ["diff", "--numstat", "-z", "-M", `${base}...${head}`],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const config = loadConfig();
  const result = evaluate(
    measure(parseNumstat(numstat), config),
    config,
    process.env,
  );
  for (const line of result.lines)
    (result.ok ? console.log : console.error)(line);
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2));
