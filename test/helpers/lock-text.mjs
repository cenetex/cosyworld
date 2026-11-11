import { lockedQuest } from "../../v2/card-game/locked-box.mjs";

// What a locked card shows a traveler who has discovered everything, or null
// when the card is not locked. The wording is the one wording of a want
// (v2/card-game/world/want-words.mjs); no pack writes it.
export const lockText = (world, id) =>
  lockedQuest(world, id, () => true)?.text ?? null;

// The same, as a traveler who has discovered nothing.
export const blindLockText = (world, id) =>
  lockedQuest(world, id, () => false)?.text ?? null;
