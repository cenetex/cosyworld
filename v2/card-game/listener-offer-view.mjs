import { listenerOffer } from "./world/arcana.mjs";

export const LISTENER = "listener";
export const LISTENER_CARD = `offer:${LISTENER}`;

export function listenerTableCard(world, actor) {
  const offer = listenerOffer(world, actor);
  if (!offer) return null;
  const reading = offer.kind === "fool";
  return {
    id: LISTENER_CARD,
    owner: offer.actorId,
    quest: {
      key: LISTENER_CARD,
      index: "offer",
      actor,
      kind: "arcanum",
      face: "offered",
      target: null,
      level: 1,
      reading,
      ready: offer.ready,
      caption: offer.ready
        ? reading ? "The Listener offers you a face-down card" : "The Listener offers you a spread"
        : "Give the Listener something to keep for good",
      heading: offer.ready ? reading ? "Accept card" : "Accept spread" : "Card offer",
    },
  };
}
