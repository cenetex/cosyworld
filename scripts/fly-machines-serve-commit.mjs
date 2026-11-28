#!/usr/bin/env node

// Exit 0 when every started app machine of a Fly app carries the commit a
// rollout just deployed; otherwise name the machines that do not and exit 1.
// `--serving` prints the commit, image, image commit and machine they serve.
// A release started outside the train (a `fly secrets set` without `--stage`)
// can write an older config back after flyctl reports success, as it did on
// 2026-11-02. Usage: node scripts/fly-machines-serve-commit.mjs <app> <commit|--serving>

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function servingMachines(machines) {
  return machines.filter(
    (machine) =>
      machine.state === "started" &&
      machine.config?.metadata?.fly_process_group === "app",
  );
}

export function staleMachines(machines, commit) {
  return servingMachines(machines)
    .map((machine) => ({
      id: machine.id,
      commit: machine.config?.env?.COSYWORLD_SOURCE_COMMIT ?? "",
    }))
    .filter((machine) => machine.commit !== commit);
}

export function servingRelease(machines) {
  const agreed = (read) => {
    const values = new Set(servingMachines(machines).map(read));
    return values.size === 1 ? [...values][0] : "";
  };
  const sha = (read) => {
    const value = agreed((machine) => read(machine.config?.env ?? {}) ?? "");
    return image && /^[0-9a-f]{40}$/.test(value) ? value : "";
  };
  const image = agreed((machine) => machine.config?.image ?? "");
  const commit = sha((env) => env.COSYWORLD_SOURCE_COMMIT);
  const serving = servingMachines(machines);
  return {
    commit,
    image,
    imageCommit: commit && (sha((env) => env.COSYWORLD_IMAGE_COMMIT) || commit),
    machine: serving.length === 1 ? serving[0].id : "",
  };
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
  if (commit === "--serving") {
    const release = servingRelease(machines);
    console.log(
      `commit=${release.commit}\nimage=${release.image}\nimage_commit=${release.imageCommit}\nmachine=${release.machine}`,
    );
    process.exit(0);
  }
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
