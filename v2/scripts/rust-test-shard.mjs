#!/usr/bin/env node
// Pick one CI shard of the orchestrator tests.
//
//   cargo test -- --list --format terse | node rust-test-shard.mjs <lane> <index> <count>
//
// The rules lane is every card_shared test: the released-rule replay suite,
// which runs on main and on pull requests that can change shared rules. The
// fast lane is everything else. Tests are dealt longest first to the
// lightest shard, using rust-test-timings.json. Prints one name per line.
import { readFileSync } from "node:fs";

const [lane, index, count] = [
  process.argv[2],
  Number(process.argv[3]),
  Number(process.argv[4]),
];
if (!["fast", "rules"].includes(lane) || !(index >= 1 && index <= count)) {
  console.error("Usage: rust-test-shard.mjs <fast|rules> <index> <count>");
  process.exit(2);
}
const timings = JSON.parse(
  readFileSync(new URL("./rust-test-timings.json", import.meta.url), "utf8"),
).tests;
const weight = (name) => timings[name] ?? 0.05;
const rules = (name) => name.startsWith("card_shared::");

const names = [
  ...new Set(
    readFileSync(0, "utf8")
      .split("\n")
      .map((line) => /^(.+): test$/u.exec(line)?.[1])
      .filter(Boolean)
      .filter((name) => rules(name) === (lane === "rules")),
  ),
].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b));

const shards = Array.from({ length: count }, () => ({ load: 0, names: [] }));
for (const name of names) {
  const lightest = shards.reduce((min, shard) =>
    shard.load < min.load ? shard : min,
  );
  lightest.load += weight(name);
  lightest.names.push(name);
}
const shard = shards[index - 1];
console.error(
  `${lane} shard ${index}/${count}: ${shard.names.length} of ${names.length} tests, ~${Math.round(shard.load)}s by recorded timings`,
);
if (shard.names.length) console.log(shard.names.join("\n"));
