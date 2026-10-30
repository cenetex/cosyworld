import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { BaseSequencer } from "vitest/node";

const timings = JSON.parse(
  readFileSync(new URL("./ci-timings.json", import.meta.url), "utf8"),
).files;

// Vitest's own shards split files by count, so the long soak files could
// share one CI shard. Split by measured seconds instead: the longest file
// goes to the lightest shard first. Within a shard, run the longest first.
export class WeightedSequencer extends BaseSequencer {
  weight(spec) {
    return timings[relative(this.ctx.config.root, spec.moduleId)] ?? 1;
  }

  async shard(files) {
    const { index, count } = this.ctx.config.shard;
    const shards = Array.from({ length: count }, () => ({
      load: 0,
      files: [],
    }));
    const ordered = [...files].sort(
      (a, b) =>
        this.weight(b) - this.weight(a) || a.moduleId.localeCompare(b.moduleId),
    );
    for (const spec of ordered) {
      const lightest = shards.reduce((min, shard) =>
        shard.load < min.load ? shard : min,
      );
      lightest.load += this.weight(spec);
      lightest.files.push(spec);
    }
    return shards[index - 1].files;
  }

  async sort(files) {
    return [...files].sort((a, b) => this.weight(b) - this.weight(a));
  }
}
