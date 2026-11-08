const pairOf = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a !== b &&
  [a, b].sort();

function sourceFor(state, pair, seq, turn, before = Infinity) {
  if (!Array.isArray(pair) || pair.length !== 2 || pair[0] >= pair[1])
    return null;
  const event = state.log.find((row) => row.seq === seq);
  return event &&
    event.seq < before &&
    event.kind === "action" &&
    event.verb === "talk" &&
    !event.generated &&
    event.turn === turn &&
    pairOf(event.actorId, event.targetId)?.[0] === pair[0] &&
    pairOf(event.actorId, event.targetId)?.[1] === pair[1] &&
    state.actors[event.actorId] &&
    state.actors[event.targetId]
    ? event
    : null;
}

// A pair starts with a committed Talk and two voices named for that exchange.
export function dialoguePairForTalk(state, event, speakers = []) {
  const actors = event && pairOf(event.actorId, event.targetId);
  if (
    event?.kind !== "action" ||
    event.verb !== "talk" ||
    event.generated ||
    !Number.isSafeInteger(event.seq) ||
    !Number.isSafeInteger(event.turn) ||
    !actors ||
    !actors.every((id) => state.actors[id] && speakers.includes(id)) ||
    !sourceFor(state, actors, event.seq, event.turn)
  )
    return null;
  return { actors, sourceActionSeq: event.seq, sourceTurn: event.turn };
}

export function dialogueLineForPair(state, pair, speakerId) {
  if (
    !pair ||
    !pair.actors?.includes(speakerId) ||
    !sourceFor(state, pair.actors, pair.sourceActionSeq, pair.sourceTurn)
  )
    return null;
  return {
    actors: [...pair.actors],
    speakerId,
    addresseeId: pair.actors.find((id) => id !== speakerId),
    sourceActionSeq: pair.sourceActionSeq,
    sourceTurn: pair.sourceTurn,
  };
}

// Legacy lines join a pair only when one earlier same-turn Talk proves it.
export function dialoguePairForLine(state, line) {
  if (
    !line?.generated ||
    line.kind !== "dialogue" ||
    !state.actors[line.actorId]
  )
    return null;
  const saved = line.dialoguePair;
  if (saved) {
    if (
      Object.keys(saved).sort().join() !==
        "actors,addresseeId,sourceActionSeq,sourceTurn,speakerId" ||
      !Array.isArray(saved.actors) ||
      saved.actors.length !== 2 ||
      !saved.actors.every((id) => typeof id === "string") ||
      saved.actors[0] >= saved.actors[1] ||
      saved.speakerId !== line.actorId ||
      saved.sourceTurn !== line.turn ||
      !Number.isSafeInteger(saved.sourceActionSeq) ||
      saved.sourceActionSeq >= line.seq ||
      saved.addresseeId === saved.speakerId ||
      !saved.actors?.includes(saved.speakerId) ||
      !saved.actors.includes(saved.addresseeId) ||
      !sourceFor(
        state,
        saved.actors,
        saved.sourceActionSeq,
        saved.sourceTurn,
        line.seq,
      )
    )
      return null;
    return { ...saved, actors: [...saved.actors] };
  }
  const sources = state.log.filter(
    (event) =>
      event.seq < line.seq &&
      event.turn === line.turn &&
      event.kind === "action" &&
      event.verb === "talk" &&
      !event.generated &&
      event.actorId !== event.targetId &&
      [event.actorId, event.targetId].includes(line.actorId) &&
      (!line.locationId || event.locationId === line.locationId),
  );
  if (sources.length !== 1) return null;
  const pair = dialoguePairForTalk(state, sources[0], [
    sources[0].actorId,
    sources[0].targetId,
  ]);
  return dialogueLineForPair(state, pair, line.actorId);
}

export function validDialoguePairLine(state, line) {
  return !line?.dialoguePair || Boolean(dialoguePairForLine(state, line));
}
