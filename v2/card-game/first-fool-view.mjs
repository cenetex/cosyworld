import { firstFoolProgress, LISTENER, recordOf } from "./world/arcana-record.mjs";
import { currentActor, legalActions, nameOf } from "./world.mjs";

const reading = "The Listener is here for a reading.";
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
  return "";
}

export function firstFoolBeat(world, beat, known) {
  if (!beat || beat.pending || beat.dream) return beat;
  const progress = firstFoolProgress(world, currentActor(world));
  if (progress?.phase !== "called" || !canRead(world, known)) return beat;
  return { ...beat, actions: [...beat.actions, { kind: "want_met", icon: "✦", text: reading }] };
}
