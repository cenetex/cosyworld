// Compatibility exports for the existing homecoming imports.
import { packDefinitions } from "./pack-registry.mjs";
import {
  authoredStoryIds,
  authoredStoryDefinitions,
  authoredStoryRelated,
} from "./pack-story-quests.mjs";

export const HOMECOMING_QUEST_CARDS = authoredStoryIds(
  packDefinitions,
  "homecoming",
);
export const homecomingDefinitions = (world) =>
  authoredStoryDefinitions(world, packDefinitions, { group: "homecoming" });
export const homecomingRelated = (definition, event) =>
  authoredStoryRelated(packDefinitions, definition, event);
