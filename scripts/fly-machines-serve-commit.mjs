#!/usr/bin/env node

// Exit 0 when every started app machine of a Fly app carries the commit a
// rollout just deployed; otherwise name the machines that do not and exit 1.
//
// `flyctl deploy` can report success and still lose its machines: a release
// started outside the train (a `fly secrets set` without `--stage`) reads the
// machine config before the rollout updates it, waits for the machine lease,
// and then writes that older config back, restoring the previous image. On
// 2026-11-02 that left .dev on 0456b60d9 after two trains.
//
// Usage: node scripts/fly-machines-serve-commit.mjs <app> <commit>

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The started app-group machines. Stopped helper machines are ignored.
export function servingMachines(machines) {
  return machines.filter(
    (machine) =>
      machine.state === "started" &&
      machine.config?.metadata?.fly_process_group === "app",
  );
}

// The serving machines whose COSYWORLD_SOURCE_COMMIT is not `commit`, as
// `{ id, commit }`.
export function staleMachines(machines, commit) {
  return servingMachines(machines)
    .map((machine) => ({
      id: machine.id,
      commit: machine.config?.env?.COSYWORLD_SOURCE_COMMIT ?? "",
    }))
    .filter((machine) => machine.commit !== commit);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [app, commit] = process.argv.slice(2);
  if (!app || !commit) {
    console.error("Usage: fly-machines-serve-commit.mjs <app> <commit>");
    process.exit(2);
  }
  const machines = JSON.parse(
    execFileSync("flyctl", ["machine", "list", "--app", app, "--json"], {
      encoding: "utf8",
    }),
  );
  const stale = staleMachines(machines, commit);
  if (!servingMachines(machines).length) {
    console.error(`${app}: no started app machines`);
    process.exit(1);
  }
  for (const machine of stale) {
    console.error(
      `${app}: machine ${machine.id} serves ${machine.commit.slice(0, 12) || "no commit"}, not ${commit.slice(0, 12)}`,
    );
  }
  process.exit(stale.length ? 1 : 0);
}
