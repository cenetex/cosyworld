// A lane joins two docks and is two-way unless marked one-way.
export const MAX_LANES = 4;
const LANE_KEYS = [
  "from",
  "to",
  "oneWay",
  "opensWith",
  "spends",
  "sealed",
  "emptyRecall",
];

export function laneProblems(t, warnings = []) {
  const out = [];
  if (!Array.isArray(t.lanes) || !t.lanes.length) return ["needs sea lanes"];
  const docks = Array.isArray(t.docks) ? t.docks : [];
  const seen = new Set(),
    neighbours = new Map(docks.map((d) => [d, new Set()])),
    leaving = new Set();
  for (const lane of t.lanes) {
    if (
      !lane ||
      typeof lane !== "object" ||
      Array.isArray(lane) ||
      Object.keys(lane).some((key) => !LANE_KEYS.includes(key)) ||
      (lane.sealed !== undefined &&
        (!lane.opensWith || lane.sealed !== true)) ||
      (lane.emptyRecall !== undefined &&
        (lane.emptyRecall !== true ||
          !Array.isArray(lane.opensWith) ||
          !lane.opensWith.length)) ||
      !docks.includes(lane.from) ||
      !docks.includes(lane.to) ||
      lane.from === lane.to ||
      (lane.oneWay !== undefined && lane.oneWay !== true)
    ) {
      out.push("has a lane that does not join two of its docks");
      continue;
    }
    const ways = [`${lane.from}>${lane.to}`];
    if (!lane.oneWay) ways.push(`${lane.to}>${lane.from}`);
    if (ways.some((way) => seen.has(way)))
      out.push(`repeats the lane ${ways[0]}`);
    for (const way of ways) seen.add(way);
    neighbours.get(lane.from).add(lane.to);
    neighbours.get(lane.to).add(lane.from);
    leaving.add(lane.from);
    if (!lane.oneWay) leaving.add(lane.to);
  }
  for (const [dock, set] of neighbours) {
    if (set.size > MAX_LANES)
      out.push(`dock ${dock} has more than ${MAX_LANES} lanes`);
    if (!leaving.has(dock)) warnings.push(`dock ${dock} has no lane out`);
  }
  return out;
}
