/**
 * Shared helper to detect curated model roster avatars.
 */
export function isModelRosterAvatar(avatar) {
  if (!avatar) return false;
  if (Array.isArray(avatar.tags) && avatar.tags.includes('model-roster')) return true;
  if (avatar.tags === 'model-roster') return true;
  if (avatar.summoner === 'system:model-roster') return true;
  return false;
}
