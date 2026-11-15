#!/usr/bin/env node
import { createWorld } from "../card-game/world.mjs";
import { probe, table, walker, waitOnly } from "../../test/helpers/emergence-probe.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const seeds = arg("seeds", "1,2,3").split(",").map(Number);
const turns = Number(arg("turns", "200"));
const scripts = { wait: waitOnly, walk: walker() };

for (const name of arg("player", "wait,walk").split(",")) {
  const result = probe({
    makeWorld: (seed) => createWorld({ seed }),
    seeds,
    turns,
    script: scripts[name],
  });
  console.log(`player: ${name}\n${table(result)}\n`);
}
