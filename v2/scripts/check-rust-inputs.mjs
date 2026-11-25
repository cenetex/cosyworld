#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, utimesSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const crate = join(repo, "v2/orchestrator-rust");
const strict = process.argv.includes("--strict");
const dirs = process.argv.slice(2).filter((arg) => arg !== "--strict");
if (!dirs.length) dirs.push("v2/card-game");
const build = () =>
  execFileSync("cargo", ["build", "--message-format=json"], {
    cwd: crate,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 1 << 28,
  })
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter(({ package_id = "" }) => package_id.includes("orchestrator-rust"));
const bin = build().find(
  ({ target }) =>
    target?.name === "cosyworld-orchestrator" && target.kind.includes("bin"),
);
const inputs = new Set(
  readFileSync(`${bin.executable}.d`, "utf8")
    .split(/(?<!\\):\s/)[1]
    .split(/(?<!\\)\s+/)
    .filter(Boolean)
    .map((file) => relative(repo, file.replaceAll("\\ ", " "))),
);
const walk = (dir) =>
  readdirSync(join(repo, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
const files = dirs.flatMap(walk).filter((file) => !file.endsWith(".rs"));
const embedded = files.filter((file) => inputs.has(file));
const touched = files
  .filter((file) => !inputs.has(file))
  .map((file) => [file, statSync(join(repo, file))]);
const later = new Date(Date.now() + 2000);
for (const [file] of touched) utimesSync(join(repo, file), later, later);
let rebuilt;
try {
  rebuilt = build()
    .filter(({ reason, fresh }) => reason === "compiler-artifact" && !fresh)
    .map(({ target }) => target.name);
} finally {
  for (const [file, { atime, mtime }] of touched)
    utimesSync(join(repo, file), atime, mtime);
}
console.log(
  `Touched ${touched.length} files under ${dirs.join(", ")}; Cargo rebuilt: ${rebuilt.join(", ") || "nothing"}.`,
);
if (embedded.length)
  console.log(`Still compiled into the binary:\n  ${embedded.join("\n  ")}`);
if (rebuilt.length || (strict && embedded.length)) process.exit(1);
