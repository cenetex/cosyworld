import history from "../world-history.json" with { type: "json" };

export function beginHistory(world, changes = history.changes) {
  if (!changes.length) return world;
  for (const [path, ...value] of changes) {
    let at = world;
    for (const key of path.slice(0, -1)) at = at[key] ??= {};
    if (value.length) at[path.at(-1)] = structuredClone(value[0]);
    else delete at[path.at(-1)];
  }
  world.began = world.turn;
  const opening = new Set(world.log.map((entry) => entry.seq));
  for (const entry of world.log) entry.turn = world.turn;
  for (const fact of Object.values(world.knowledge?.facts || {}))
    if (opening.has(fact.source.eventSeq)) fact.source.turn = world.turn;
  for (const known of Object.values(world.knowledge?.known || {}))
    for (const memory of Object.values(known))
      if (opening.has(memory.eventSeq)) memory.learnedTurn = world.turn;
  for (const memory of Object.values(world.memories))
    for (const event of memory.events || [])
      if (opening.has(event.seq)) event.turn = world.turn;
  for (const memory of Object.values(world.memories))
    for (const record of Object.values(memory.subjects || {}))
      for (const event of [record.sight, ...(record.deeds || [])])
        if (event && opening.has(event.seq)) event.turn = world.turn;
  return world;
}
