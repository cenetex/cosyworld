#!/usr/bin/env node
// No new recorded saves. A recorded save is a file that stores a played world so
// a test can load it instead of playing there. A tracked file counts when:
//   envelope  it is .json or .json.gz and, within three object levels, holds a
//             world state: an object with `actors`, `items` and `locations`
//             plus `schema` or `eventSeq` (the save envelope; ordinary test data
//             and pack content lack this triple), or
//   gzip      it is any .json.gz, or
//   name      its file name has a `save` word (`east-save.json`, `card-save-x.json`).
// Matches must be listed in scripts/recorded-saves-allowlist.json with their
// size in bytes. A new match fails; a listed file that grew by more than 5% (or
// 2 KB) fails; a listed entry whose file is gone or no longer matches fails
// (delete the entry in the same PR). The list can only shrink.
//
//   node scripts/check-recorded-saves.mjs [--ref <git-ref>] [--root <dir>] [--list] [--allowlist <file>]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSources } from "./check-test-skips.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ALLOWLIST = path.join(here, "recorded-saves-allowlist.json");
const MARGIN = { ratio: 0.05, bytes: 2048 };

const isState = (o) =>
  o && typeof o === "object" && !Array.isArray(o) &&
  ["actors", "items", "locations"].every((k) => o[k] && typeof o[k] === "object") &&
  ("schema" in o || "eventSeq" in o);

function holdsState(value, depth = 0) {
  if (isState(value)) return true;
  if (depth >= 3 || !value || typeof value !== "object") return false;
  return Object.values(value).some((v) => holdsState(v, depth + 1));
}

/** Why a file is a recorded save, or "" when it is not. */
export function savedBecause(name, bytes) {
  if (!/\.json(\.gz)?$/.test(name) || /(^|\/)package(-lock)?\.json$/.test(name)) return "";
  if (name.endsWith(".gz")) return "gzip";
  if (/(^|[^a-z])save([^a-z]|$)/i.test(path.basename(name))) return "name";
  if (bytes.length < 2048 || !bytes.includes('"actors"')) return "";
  try {
    return holdsState(JSON.parse(bytes.toString("utf8"))) ? "envelope" : "";
  } catch {
    return "";
  }
}

export function scanSaves(sources) {
  const found = {};
  for (const n of sources.names) {
    if (!/\.json(\.gz)?$/.test(n)) continue;
    const bytes = sources.read(n);
    const why = savedBecause(n, bytes);
    if (why) found[n] = { bytes: bytes.length, why };
  }
  return found;
}

/** { ok, messages } comparing what exists with the allow-list ({ path: bytes }). */
export function judgeSaves(found, allowed) {
  const messages = [];
  const fix = "Build the start state by play from createWorld, a journey (test/journeys, npm run test:journeys:build) or a synthetic world instead of recording a save.";
  for (const [n, { bytes, why }] of Object.entries(found)) {
    if (!(n in allowed)) messages.push(`${n}: new recorded save (${why}). ${fix}`);
    else if (bytes > Math.max(allowed[n] * (1 + MARGIN.ratio), allowed[n] + MARGIN.bytes))
      messages.push(`${n}: recorded save grew from ${allowed[n]} to ${bytes} bytes. ${fix}`);
  }
  for (const n of Object.keys(allowed))
    if (!(n in found)) messages.push(`${n}: allow-listed but gone or no longer a recorded save; remove the entry from scripts/recorded-saves-allowlist.json.`);
  return { ok: messages.length === 0, messages };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
  const found = scanSaves(loadSources({ ref: arg("--ref"), root: arg("--root") }));
  if (process.argv.includes("--list"))
    for (const [n, { bytes, why }] of Object.entries(found)) console.log(`${why}\t${bytes}\t${n}`);
  const allowed = JSON.parse(readFileSync(arg("--allowlist") ?? ALLOWLIST, "utf8")).files;
  const { ok, messages } = judgeSaves(found, allowed);
  for (const m of messages) console.error(m);
  console.log(`recorded saves: ${Object.keys(found).length} (allow-list: ${Object.keys(allowed).length})`);
  process.exit(ok ? 0 : 1);
}
