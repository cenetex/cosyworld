#!/usr/bin/env node
// Skip ledger: counts skipped tests by static scan (nothing is executed) against
// scripts/test-skip-ceiling.txt, which may only go down. Counted once per
// occurrence, on lines that are not comments:
//   JS   it/test/describe/suite (+ .concurrent/.sequential/.each) then .skip or
//        .todo; any .skipIf( call (an alias like `const it = check.skipIf(...)`
//        counts once, where made); xit( xtest( xdescribe(; ctx.skip( t.skip(
//   Rust #[ignore] and #[ignore = "reason"]
// Scanned: *.test.* / *.spec.* and files under test/ or tests/ (JS), every .rs.
// Every skip needs a reason: a // or /* comment on its line or directly above
// (Rust: anywhere in the attribute/doc block above, or an `= "..."` string);
// one without fails with file:line. Like the lint-warning ceiling, a count above
// the ceiling fails; below it only prints a note to lower the ceiling.
//
//   node scripts/check-test-skips.mjs [--ref <git-ref>] [--root <dir>] [--list]
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, "..");
export const CEILING_FILE = path.join(here, "test-skip-ceiling.txt");

const OUT = /(^|\/)(node_modules|target|\.git|\.claude)\//;
const JS_FILE = /\.(m?js|cjs|ts)$/;
const JS_SKIP =
  /\b(?:it|test|describe|suite)(?:\.(?:concurrent|sequential|each|for))*\.(?:skip|todo)\b|\.skipIf\s*\(|\b(?:xit|xtest|xdescribe)\s*\(|\b(?:ctx|context|t)\.skip\s*\(/g;
const RUST_IGNORE = /#\[ignore\b/g;
const isComment = (l) => /^\s*(\/\/|\/\*|\*)/.test(l);

/** Files to scan: [{ path, text }] from the working tree, a git ref, or a dir. */
export function loadSources({ ref, root } = {}) {
  let names, read;
  if (root) {
    const walk = (d) =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)],
      );
    names = walk(root).map((f) => path.relative(root, f).split(path.sep).join("/"));
    read = (n) => readFileSync(path.join(root, n));
  } else if (ref) {
    const git = (...a) => execFileSync("git", a, { cwd: REPO, maxBuffer: 1 << 30 });
    names = git("ls-tree", "-r", "--name-only", ref).toString().split("\n").filter(Boolean);
    read = (n) => git("show", `${ref}:${n}`);
  } else {
    names = execFileSync("git", ["ls-files"], { cwd: REPO, maxBuffer: 1 << 28 })
      .toString().split("\n").filter(Boolean);
    read = (n) => readFileSync(path.join(REPO, n));
  }
  return { names: names.filter((n) => !OUT.test(n)), read };
}

const isTestSource = (n) =>
  n.endsWith(".rs") ||
  (JS_FILE.test(n) && /(\.test\.|\.spec\.|(^|\/)tests?\/)/.test(n));

/** Skips in one file: [{ file, line, kind, reason }]. */
export function skipsIn(file, text) {
  const lines = text.split("\n");
  const rust = file.endsWith(".rs");
  const found = [];
  lines.forEach((line, i) => {
    if (isComment(line)) return;
    for (const m of line.matchAll(rust ? RUST_IGNORE : JS_SKIP)) {
      let reason = /(\/\/|\/\*)/.test(line.slice(m.index + m[0].length));
      if (rust) {
        reason ||= /^\s*(=\s*"|\(\s*")/.test(line.slice(m.index + m[0].length));
        for (let j = i - 1; !reason && j >= 0 && /^\s*(#\[|\/\/)/.test(lines[j]); j--)
          reason = /^\s*\/\//.test(lines[j]);
      } else reason ||= i > 0 && isComment(lines[i - 1]);
      found.push({ file, line: i + 1, kind: m[0].trim(), reason });
    }
  });
  return found;
}

export function scanSkips(sources) {
  return sources.names.filter(isTestSource).flatMap((n) => {
    const text = sources.read(n).toString("utf8");
    return /ignore|skip|todo|\bx(it|test|describe)\b/.test(text) ? skipsIn(n, text) : [];
  });
}

export function readCeiling(file = CEILING_FILE) {
  const first = readFileSync(file, "utf8").split("\n").find((l) => l.trim() && !l.startsWith("#"));
  if (!/^\d+$/.test((first ?? "").trim())) throw new Error(`Invalid skip ceiling in ${file}: '${first}'`);
  return Number(first.trim());
}

/** { ok, messages } for a list of skips and a ceiling. */
export function judge(skips, ceiling) {
  const messages = [];
  let ok = true;
  const bare = skips.filter((s) => !s.reason);
  for (const s of bare) messages.push(`${s.file}:${s.line}: ${s.kind} has no reason; add a comment on the same or previous line.`);
  if (bare.length) ok = false;
  messages.push(`test skips: ${skips.length} (ceiling: ${ceiling})`);
  if (skips.length > ceiling) {
    ok = false;
    messages.push(
      `Skips rose from ${ceiling} to ${skips.length}. Fix the starting state (journey, createWorld) or delete the test with a stated reason. Raising the ceiling is an owner decision made visibly in the PR: change the number in scripts/test-skip-ceiling.txt in the same diff.`,
    );
  } else if (skips.length < ceiling) {
    messages.push(`Skips dropped by ${ceiling - skips.length}; lower scripts/test-skip-ceiling.txt to ${skips.length} in this PR to lock in the win.`);
  }
  return { ok, messages };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
  const skips = scanSkips(loadSources({ ref: arg("--ref"), root: arg("--root") }));
  if (process.argv.includes("--list")) for (const s of skips) console.log(`${s.file}:${s.line} ${s.kind}${s.reason ? "" : " (no reason)"}`);
  const { ok, messages } = judge(skips, existsSync(CEILING_FILE) ? readCeiling() : 0);
  for (const m of messages) (ok ? console.log : console.error)(m);
  process.exit(ok ? 0 : 1);
}
