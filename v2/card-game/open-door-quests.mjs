// Compatibility exports for the existing Open Door imports.
import { packDefinitions } from "./pack-registry.mjs";
import {
  authoredStoryIds,
  authoredStoryDefinitions,
  authoredStoryRelated,
} from "./pack-story-quests.mjs";

export const OPEN_DOOR_QUEST_CARDS = authoredStoryIds(
  packDefinitions,
  "open-door",
);
export const openDoorDefinitions = (world) =>
  authoredStoryDefinitions(world, packDefinitions, { group: "open-door" });
export const openDoorRelated = (definition, event) =>
  authoredStoryRelated(packDefinitions, definition, event);
