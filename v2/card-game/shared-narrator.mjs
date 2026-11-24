// Dialogue context, and on request the drawn scene, for a committed shared
// play. Both read the saved world and never change it, so they live outside
// the shared rules bundle. See docs/design/pack-content-outside-the-engine.md.
import { load } from "./shared-world.mjs";
import {
  narrativeContext,
  ownFacts,
  residentKnowledge,
  residentScene,
} from "./narrative.mjs";
import { currentScene } from "./scene.mjs";

export function sharedScene(request) {
  const world = load(request);
  if (Array.isArray(request.own)) {
    const ids = request.own.filter((id) => world.actors[id]);
    const each = (facts) =>
      Object.fromEntries(ids.map((id) => [id, facts(world, id)]));
    return {
      own: each(ownFacts),
      known: each(residentKnowledge),
      seen: each(residentScene),
    };
  }
  const revealed = Array.isArray(request.revealed) && new Set(request.revealed);
  const isCovered = revealed ? (id) => !revealed.has(id) : null;
  return {
    context: narrativeContext(world, request.action || null, isCovered),
    ...(request.scene ? { scene: currentScene(world) } : {}),
  };
}
export const sharedContext = (request) => sharedScene(request).context;
