/**
 * Combat system constants - extracted from magic numbers for maintainability
 */
export const COMBAT_CONSTANTS = {
  // Turn Management
  DEFAULT_TURN_TIMEOUT_MS: 30_000,
  DEFAULT_AUTO_ACT_DELAY_MS: 1500,
  DEFAULT_MIN_TURN_GAP_MS: 4000,
  DEFAULT_ROUND_COOLDOWN_MS: 3000,

  // Encountered Management
  DEFAULT_MAX_ENCOUNTERS_PER_GUILD: 5,
  DEFAULT_STALE_ENCOUNTER_MS: 60 * 60 * 1000, // 1 hour
  DEFAULT_IDLE_END_ROUNDS: 3,
  DEFAULT_MAX_ROUNDS: 3, // Maximum rounds before combat ends

  // Media Generation
  DEFAULT_MEDIA_WAIT_TIMEOUT_MS: 45_000,
  DEFAULT_POSTER_WAIT_TIMEOUT_MS: 15_000,
  DEFAULT_ROUND_PLANNING_TIMEOUT_MS: 3500,

  // Cooldowns
  KNOCKOUT_COOLDOWN_MS: 24 * 60 * 60 * 1000, // 24 hours
  FLEE_COOLDOWN_MS: 24 * 60 * 60 * 1000, // 24 hours

  // Combat Mechanics
  LOW_HP_THRESHOLD: 0.3,
  DEFEND_AC_BONUS: 2,
  DEFAULT_AC: 10,
  DEFAULT_HP: 10,
  DEFAULT_DEX: 10,

  // Cleanup
  CLEANUP_INTERVAL_MS: 60 * 1000,

  // Rate Limiting
  DEFAULT_MAX_ACTIONS_PER_MINUTE: 10,
  RATE_LIMIT_WINDOW_MS: 60 * 1000,
};

export default COMBAT_CONSTANTS;
