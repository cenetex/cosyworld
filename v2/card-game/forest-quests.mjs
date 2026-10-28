// Compatibility exports for the first forest chapter.
import { packDefinitions } from "./pack-registry.mjs";
import {
  authoredStoryIds,
  authoredStoryDefinitions,
  authoredStoryRelated,
} from "./pack-story-quests.mjs";

export const FOREST_QUEST_CARDS = authoredStoryIds(packDefinitions, "forest");
export const forestDefinitions = (world) =>
  authoredStoryDefinitions(world, packDefinitions, { group: "forest" });
export const forestRelated = (definition, event) =>
  authoredStoryRelated(packDefinitions, definition, event);
