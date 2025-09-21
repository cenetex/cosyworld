/**
 * Admin Avatar Resolver
 *
 * Centralizes logic for resolving an "admin" avatar id used by legacy code paths
 * that historically depended on environment variables (ADMIN_AVATAR_ID / ADMIN_AVATAR).
 *
 * Current precedence (lowest friction, avoids config sprawl):
 * 1. Explicit env var ADMIN_AVATAR_ID
 * 2. Legacy alias env var ADMIN_AVATAR
 * 3. A cached discovered avatar id (set via setFallbackAdminAvatarId)
 * 4. Null if none present
 *
 * This abstraction allows future replacement with a database-backed setting
 * or inference from x_auth global record without editing many call sites.
 */

let _fallbackAdminAvatarId = null;

/**
 * Set a process-lifetime fallback value (e.g., after resolving from DB once).
 * @param {string|null|undefined} id
 */
export function setFallbackAdminAvatarId(id) {
  if (id && typeof id === 'string') {
    _fallbackAdminAvatarId = id.trim() || null;
  } else if (id == null) {
    _fallbackAdminAvatarId = null;
  }
}

/**
 * Resolve the admin avatar id string or null.
 * @returns {string|null}
 */
export function resolveAdminAvatarId() {
  const envId = (process.env.ADMIN_AVATAR_ID || process.env.ADMIN_AVATAR || '').trim();
  if (envId) return envId;
  return _fallbackAdminAvatarId || null;
}

/**
 * Convenience helper that returns an object useful for logging / metrics.
 */
export function getAdminAvatarResolutionMeta() {
  const envId = (process.env.ADMIN_AVATAR_ID || process.env.ADMIN_AVATAR || '').trim();
  return {
    source: envId ? 'env' : (_fallbackAdminAvatarId ? 'fallback' : 'none'),
    value: envId || _fallbackAdminAvatarId || null
  };
}

export default {
  resolveAdminAvatarId,
  setFallbackAdminAvatarId,
  getAdminAvatarResolutionMeta
};
