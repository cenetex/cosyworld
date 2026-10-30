// Authored story groups, read the way the removed compat modules did.
import { packDefinitions } from "../../v2/card-game/pack-registry.mjs";
import {
  authoredStoryIds,
  authoredStoryDefinitions,
} from "../../v2/card-game/pack-story-quests.mjs";

export const storyGroupIds = (group) =>
  authoredStoryIds(packDefinitions, group);
export const storyGroupDefinitions = (world, group) =>
  authoredStoryDefinitions(world, packDefinitions, { group });
