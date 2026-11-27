import { firstFoolProgress, LISTENER, recordOf } from "./world/arcana-record.mjs";
import { currentActor, legalActions, nameOf } from "./world.mjs";

const reading = "The Listener is here for a reading.";
const helped = ({ count, target }) => `${count} of ${target} people helped`;
const canRead = (world, known) => known(LISTENER) && legalActions(world).some(
  (action) => action.kind === "talk" && action.target === LISTENER,
);

export function firstFoolNote(world, known) {
  const actor = currentActor(world);
  const progress = firstFoolProgress(world, actor);
  if (progress?.phase === "called" && canRead(world, known)) return reading;
  if (progress?.phase === "offered") {
    const { offer } = recordOf(world, actor);
    if (offer === world.actors[actor].place) return "The Listener has a card for you.";
    return known(offer) ? `The Listener has your card at ${nameOf(offer)}.` : "The Listener is keeping your card.";
  }
  return progress?.count && ["help", "called"].includes(progress.phase) ? helped(progress) : "";
}

export function firstFoolBeat(world, beat, known, beats) {
  if (!beat || beat.pending || beat.dream) return beat;
  const actor = currentActor(world);
  const progress = firstFoolProgress(world, actor);
  if (!progress || !["help", "called"].includes(progress.phase)) return beat;
  const callers = recordOf(world, actor).callers;
  const favor = world.log.findLast((entry) => entry.turn === world.turn &&
    entry.verb === "want_met" && entry.actorId === actor && callers.includes(entry.ownerId));
  if (favor?.turn === beat.turn && beats.some((entry) => entry.actions.some((action) => action.seq === favor.seq))) {
    const actions = beat.actions.map((action) => action.seq === favor.seq
      ? { ...action, text: `${helped(progress)} · ${action.text}` }
      : action);
    if (!actions.some((action) => action.seq === favor.seq))
      actions.push({ kind: "want_met", icon: "✦", text: helped(progress) });
    return { ...beat, actions };
  }
  if (progress.phase === "called" && canRead(world, known))
    return { ...beat, actions: [...beat.actions, { kind: "want_met", icon: "✦", text: reading }] };
  return beat;
}
