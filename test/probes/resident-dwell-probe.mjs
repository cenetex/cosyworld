// Measures how long residents stay at a place before moving on their own,
// with the traveller standing still (Wait each turn). Not a vitest file:
//   node test/probes/resident-dwell-probe.mjs [days] [stand]
// stand: "start" (the world's first place) or a place id.
import {
  createWorld,
  legalActions,
  play,
} from "../../v2/card-game/world.mjs";
import {
  entityActive,
  packDefinitions,
} from "../../v2/card-game/pack-registry.mjs";
import { humanAvatarIds } from "../../v2/card-game/human-cast.mjs";

const days = Number(process.argv[2] || 4);
const stand = process.argv[3] || "start";
const scopes = Object.fromEntries(
  packDefinitions.filter((p) => p.release).map((p) => [p.id, "full"]),
);
let s = createWorld({ seed: 7, packScopes: scopes });
if (stand !== "start") s.actors.vale.place = stand;
const cast = Object.keys(s.actors).filter(
  (id) => id !== "vale" && !humanAvatarIds.includes(id),
);
const track = Object.fromEntries(cast.map((id) => [id, []]));
const total = days * 48;
const sample = () => {
  for (const id of cast)
    track[id].push(entityActive(s, id) ? s.actors[id].place : null);
};
sample();
for (let t = 0; t < total; t++) {
  const wait = legalActions(s).find((a) => a.kind === "wait" && !a.sleep);
  const done = play(s, wait, s.revision);
  if (!done.ok) throw new Error(done.error);
  s = done.state;
  sample();
}
// Runs that start and end with a move (the first and last runs are cut off).
const runs = [];
const moves = {};
for (const id of cast) {
  const p = track[id];
  let start = 0;
  moves[id] = 0;
  for (let i = 1; i < p.length; i++) {
    if (p[i] === p[i - 1]) continue;
    if (p[i - 1] !== null && p[i] !== null) {
      moves[id] += 1;
      if (start > 0) runs.push({ id, len: i - start });
    }
    start = i;
  }
}
const sorted = runs.map((r) => r.len).sort((a, b) => a - b);
const q = (f) =>
  sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
const hist = {};
for (const n of sorted) {
  const k =
    n === 1
      ? "1"
      : n <= 3
        ? "2-3"
        : n <= 5
          ? "4-5"
          : n <= 11
            ? "6-11"
            : n <= 23
              ? "12-23"
              : "24+";
  hist[k] = (hist[k] || 0) + 1;
}
const movers = Object.entries(moves).filter(([, n]) => n > 0);
const perDay = movers
  .map(([id, n]) => [id, n / days])
  .sort((a, b) => b[1] - a[1]);
console.log(
  `days=${days} stand=${stand} cast=${cast.length} movers=${movers.length}`,
);
console.log(
  `completed stays=${sorted.length} median=${q(0.5)} p10=${q(0.1)} p90=${q(0.9)} min=${sorted[0]} max=${sorted.at(-1)}`,
);
console.log("stay histogram (turns):", JSON.stringify(hist));
const totalMoves = movers.reduce((a, [, n]) => a + n, 0);
console.log(
  `moves/day all movers: total ${(totalMoves / days).toFixed(1)}, per mover mean ${(totalMoves / days / Math.max(1, movers.length)).toFixed(2)}`,
);
console.log("per-resident moves/day (top 15):");
for (const [id, n] of perDay.slice(0, 15)) {
  const own = runs
    .filter((r) => r.id === id)
    .map((r) => r.len)
    .sort((a, b) => a - b);
  console.log(
    `  ${id.padEnd(28)} ${n.toFixed(1)}/day  median stay ${own.length ? own[Math.floor(own.length / 2)] : "-"}`,
  );
}
