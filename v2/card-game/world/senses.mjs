// Senses and reflections, split out of world.mjs (#1390).
import { conditionMet } from "../pack-rules.mjs";
import { entityActive } from "../pack-registry.mjs";
import { itemPlace } from "./items.mjs";
import { nameOf } from "./catalog.mjs";
import { currentActor } from "../human-cast.mjs";
import forest from "../forest.json" with { type: "json" };

// A reflection opens while its authored conditions hold (#1600). Forest data
// opens the attic mirror once the lamp there is dark, and the pond's way back
// while the lamp shines on the shore.
export const reflectionsFrom = (s, from) =>
  (forest.reflectionRoutes || [])
    .filter(
      (r) =>
        r.from === from && r.requires.every((c) => conditionMet(s, c, null)),
    )
    .map((r) => r.to);
export const reflectionOpen = (s, from = itemPlace(s, "lamp")) =>
  reflectionsFrom(s, from).length > 0;
// A ringing hub object sounds where it rests. Packs add their own sounding
// fixtures through pack-rules.mjs.
const baseSoundAt = (s, place) =>
  Object.keys(s.items).some(
    (id) =>
      entityActive(s, id) &&
      s.items[id].ringing > 0 &&
      itemPlace(s, id) === place,
  );
export const senses = { player: "vale", baseSoundAt, nameOf };
export const sensesFor = (s) => ({
  ...senses,
  player: currentActor(s),
  ...(s.controlledActors ? { humanActors: s.controlledActors } : {}),
});
