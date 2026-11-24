import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DurationSequencer } from "./helpers/duration-sequencer.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const { seconds } = JSON.parse(
  readFileSync(new URL("./durations.json", import.meta.url), "utf8"),
);
const files = [
  ...Object.keys(seconds),
  ...Array.from({ length: 300 }, (_, i) => `test/small-${i}.test.mjs`),
];
const specs = files.map((file) => ({ moduleId: `${root}${file}` }));
const shard = (index, count) =>
  new DurationSequencer({ config: { root, shard: { index, count } } }).shard(
    specs,
  );

describe("unit shards", () => {
  it("give every file to exactly one shard, longest first", async () => {
    const shards = await Promise.all([1, 2, 3].map((i) => shard(i, 3)));
    const ids = shards.flat().map((spec) => spec.moduleId);
    expect(new Set(ids).size).toBe(files.length);
    expect(ids.length).toBe(files.length);
    const first = shards[0].map((spec) => spec.moduleId.slice(root.length));
    const longest = Object.entries(seconds).sort((a, b) => b[1] - a[1])[0][0];
    expect(first[0]).toBe(longest);
  });

  it("balance the measured time between shards", async () => {
    const total = (list) =>
      list.reduce(
        (sum, spec) => sum + (seconds[spec.moduleId.slice(root.length)] ?? 0.3),
        0,
      );
    const times = await Promise.all(
      [1, 2].map(async (i) => total(await shard(i, 2))),
    );
    expect(Math.abs(times[0] - times[1])).toBeLessThan(
      Math.max(...Object.values(seconds)) / 4,
    );
  });
});
