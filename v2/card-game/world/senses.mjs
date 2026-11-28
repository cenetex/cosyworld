import { conditionMet } from "../pack-rules.mjs";
import { entityActive } from "../pack-registry.mjs";
import { itemPlace } from "./items.mjs";
import { nameOf } from "./catalog.mjs";
import { currentActor } from "../human-cast.mjs";
import forest from "../forest.json" with { type: "json" };

// A reflection opens while its authored conditions hold (#1600).
export const reflectionsFrom = (s, from) =>
  (forest.reflectionRoutes || [])
    .filter(
      (r) =>
        r.from === from && r.requires.every((c) => conditionMet(s, c, null)),
    )
    .map((r) => r.to);
export const reflectionOpen = (s, from = itemPlace(s, "lamp")) =>
  reflectionsFrom(s, from).length > 0;
// The bell is heard where it rests while it rings; packs add their own fixtures.
const baseSoundAt = (s, place) =>
  entityActive(s, "bell") &&
  s.items.bell.ringing > 0 &&
  itemPlace(s, "bell") === place;
export const senses = { player: "vale", baseSoundAt, nameOf };
export const sensesFor = (s) => ({
  ...senses,
  player: currentActor(s),
  ...(s.controlledActors ? { humanActors: s.controlledActors } : {}),
});
