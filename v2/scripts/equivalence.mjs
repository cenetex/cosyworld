/**
 * Equivalence harness for the card rules (#1387).
 *
 * Plays identical seeded games through two versions of the rules and asserts
 * the observable surface — encodeSave, legalActions, narrativeContext, and a
 * decodeSave round-trip — is byte-for-byte identical. Until the world.mjs
 * facade split (#1390) lands, both sides default to the same module and the
 * check proves determinism; afterward, point --new at the facade.
 *
 * Usage:
 *   node v2/scripts/equivalence.mjs [--old <world.mjs>] [--new <world.mjs>]
 *                                   [--seeds 7,42,1729] [--steps 400]
 */
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Load one side of the rules: the world module plus its sibling narrative.mjs
 * (which exports narrativeContext).
 */
export async function loadSide(worldFile) {
  const dir = new URL(".", worldFile);
  const rules = await import(worldFile);
  const narr = await import(new URL("narrative.mjs", dir));
  return { rules, narr };
}

/**
 * Play a deterministic, seeded walk through one side and return a canonical
 * text trace. The same seed always produces the same trace for a given rules
 * version, so two versions are equivalent when their traces are identical.
 */
export function playTrace({ rules, narr }, { seed, steps }) {
  const out = [];
  let rng = seed >>> 0;
  let s = rules.createWorld({ seed });
  out.push(rules.encodeSave(s));
  for (let i = 0; i < steps; i++) {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    const actions = rules.legalActions(s);
    if (actions.length === 0) break;
    const action =
      i % 5 === 0 ? rules.plan(s).action : actions[rng % actions.length];
    if (!action) break;
    const result = rules.play(s, action);
    if (!result.ok) break;
    s = result.state;
    out.push(rules.encodeSave(s));
    out.push(JSON.stringify(actions.map((a) => a.key)));
    out.push(JSON.stringify(narr.narrativeContext(s, action)));
    if (i % 97 === 0) {
      const round = rules.decodeSave(rules.encodeSave(s));
      out.push(rules.encodeSave(round));
      s = round;
    }
  }
  return out.join("\n");
}

/**
 * Compare two rules versions across a set of seeds. Returns one report per
 * seed; `equal` is true only when the full traces are byte-for-byte identical.
 */
export async function compare(
  oldFile,
  newFile,
  { seeds = [7, 42, 1729], steps = 400 } = {},
) {
  const oldSide = await loadSide(oldFile);
  const newSide = await loadSide(newFile);
  const reports = [];
  for (const seed of seeds) {
    const a = playTrace(oldSide, { seed, steps });
    const b = playTrace(newSide, { seed, steps });
    if (a !== b) {
      const al = a.split("\n");
      const bl = b.split("\n");
      const idx = al.findIndex((line, i) => line !== bl[i]);
      reports.push({ seed, equal: false, firstDiff: idx, bytes: a.length });
    } else {
      reports.push({ seed, equal: true, bytes: a.length });
    }
  }
  return reports;
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const flag = process.argv[i];
    if (flag.startsWith("--")) args[flag.slice(2)] = process.argv[++i];
  }
  const oldFile = new URL(args.old ?? "../card-game/world.mjs", import.meta.url);
  const newFile = new URL(args.new ?? "../card-game/world.mjs", import.meta.url);
  const seeds = (args.seeds ?? "7,42,1729").split(",").map(Number);
  const steps = Number(args.steps ?? "400");
  const reports = await compare(oldFile, newFile, { seeds, steps });
  for (const r of reports) {
    if (r.equal) console.log(`seed ${r.seed}: EQUIVALENT (${r.bytes} bytes)`);
    else console.error(`seed ${r.seed}: DIFFERS at trace line ${r.firstDiff}`);
  }
  process.exit(reports.every((r) => r.equal) ? 0 : 1);
}
