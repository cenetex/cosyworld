import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { BaseSequencer } from "vitest/node";

const { seconds } = JSON.parse(
  readFileSync(new URL("../durations.json", import.meta.url), "utf8"),
);

// Longest files first, and each file to the shard with the least time so far,
// so every shard and worker ends at about the same moment.
export class DurationSequencer extends BaseSequencer {
  weight(spec) {
    return seconds[relative(this.ctx.config.root, spec.moduleId)] ?? 0.3;
  }

  async sort(specs) {
    return [...specs].sort(
      (a, b) =>
        this.weight(b) - this.weight(a) ||
        (a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : 0),
    );
  }

  async shard(specs) {
    const { index, count } = this.ctx.config.shard;
    const loads = new Array(count).fill(0);
    const mine = [];
    for (const spec of await this.sort(specs)) {
      const least = loads.indexOf(Math.min(...loads));
      loads[least] += this.weight(spec);
      if (least === index - 1) mine.push(spec);
    }
    return mine;
  }
}
