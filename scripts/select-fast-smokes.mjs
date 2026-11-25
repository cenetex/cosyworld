#!/usr/bin/env node
// Choose the browser smokes for the fast check from the changed paths, using
// scripts/fast-smokes.json, and pack them into jobs. Prints a JSON array of
// packs, each a space-separated list of smokes; `--run` runs one pack.
// Usage: node scripts/select-fast-smokes.mjs changed-files.txt
//        node scripts/select-fast-smokes.mjs --run "smoke-a smoke-b@390"
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const CONFIG = fileURLToPath(new URL("./fast-smokes.json", import.meta.url));
const SHARDS = fileURLToPath(new URL("./browser-shards.json", import.meta.url));

// Every change runs the core smokes, then every smoke a changed path selects;
// a core smoke a path also selects runs once. A journey the full suite splits
// by width (scripts/browser-shards.json) runs one width per entry here too.
export function selectSmokes(changed, config, shardChecks = {}) {
  const rust = new Set(config.needsRust);
  const runs = (smoke) => {
    const widths = Object.keys(shardChecks).filter((check) =>
      check.startsWith(`${smoke}@`),
    );
    return rust.has(smoke) ? [] : widths.length ? widths : [smoke];
  };
  const core = [...new Set(config.core.flatMap(runs))];
  const picked = [];
  const add = (smoke) => {
    for (const run of runs(smoke))
      if (!core.includes(run) && !picked.includes(run)) picked.push(run);
  };
  for (const file of changed) {
    const own = file.match(
      /^v2\/scripts\/((?:smoke-card|smoke-shared|check-card)-[\w-]+)\.mjs$/,
    );
    if (own) add(own[1]);
  }
  for (const rule of config.rules) {
    const pattern = new RegExp(rule.paths);
    if (changed.some((file) => pattern.test(file))) rule.smokes.forEach(add);
  }
  return [...core, ...picked];
}

// Longest first, each smoke to the job with the least measured time, in as
// few jobs as keep each lane near targetSeconds and never more than `jobs`.
export function packSmokes(smokes, { packing }) {
  const time = (smoke) => packing.seconds[smoke] ?? packing.defaultSeconds;
  const total = smokes.reduce((sum, smoke) => sum + time(smoke), 0);
  const count = Math.max(
    1,
    Math.min(
      packing.jobs,
      smokes.length,
      Math.ceil(total / (packing.lanes * packing.targetSeconds)),
    ),
  );
  const packs = Array.from({ length: count }, () => ({
    seconds: 0,
    smokes: [],
  }));
  const longest = [...smokes].sort(
    (a, b) => time(b) - time(a) || (a < b ? -1 : 1),
  );
  for (const smoke of longest) {
    const least = packs.reduce((a, b) => (b.seconds < a.seconds ? b : a));
    least.smokes.push(smoke);
    least.seconds += time(smoke);
  }
  return packs.map((pack) => pack.smokes.join(" "));
}

function startSmoke(smoke) {
  const [name, widths] = smoke.split("@");
  const env = widths
    ? { ...process.env, COSYWORLD_SMOKE_WIDTHS: widths }
    : process.env;
  return new Promise((resolve) => {
    const began = Date.now();
    let output = "";
    const child = spawn(process.execPath, [`v2/scripts/${name}.mjs`], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (data) => (output += data));
    child.stderr.on("data", (data) => (output += data));
    child.on("close", (code) =>
      resolve({
        code: code ?? 1,
        output,
        seconds: Math.round((Date.now() - began) / 1000),
      }),
    );
  });
}

export async function runSmokes(
  smokes,
  lanes,
  start = startSmoke,
  log = console.log,
) {
  const queue = [...smokes];
  const failed = [];
  const lane = async () => {
    for (let smoke = queue.shift(); smoke; smoke = queue.shift()) {
      const { code, output, seconds } = await start(smoke);
      const text = output.endsWith("\n") || !output ? output : `${output}\n`;
      if (code) {
        failed.push(smoke);
        log(
          `::error title=Browser smoke failed::${smoke} (${seconds} s)\n${text}`,
        );
      } else
        log(`::group::${smoke} passed (${seconds} s)\n${text}::endgroup::`);
    }
  };
  await Promise.all(Array.from({ length: lanes }, lane));
  return failed;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const config = JSON.parse(readFileSync(CONFIG, "utf8"));
  if (process.argv[2] === "--run") {
    const smokes = process.argv[3].split(" ").filter(Boolean);
    const failed = await runSmokes(smokes, config.packing.lanes);
    process.exitCode = failed.length ? 1 : 0;
  } else {
    const changed = readFileSync(process.argv[2], "utf8")
      .split("\n")
      .filter(
        (file) => file && (!file.startsWith("v2/scripts/") || existsSync(file)), // deleted smokes
      );
    const { checks } = JSON.parse(readFileSync(SHARDS, "utf8"));
    const smokes = selectSmokes(changed, config, checks);
    console.log(JSON.stringify(packSmokes(smokes, config)));
  }
}
