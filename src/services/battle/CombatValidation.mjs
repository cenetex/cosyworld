/**
 * Encounter validation and integrity checking
 */
export class CombatValidation {
  constructor({ logger }) {
    this.logger = logger || console;
  }

  /**
   * Validate encounter state integrity before critical operations
   * @param {Object} encounter - Encounter to validate
   * @param {string} operation - Name of operation (for logging)
   * @returns {boolean} - True if valid
   */
  validateEncounter(encounter, operation = 'unknown') {
    const errors = [];

    if (!encounter) {
      errors.push('Encounter is null or undefined');
    } else {
      // Required fields
      if (!encounter.channelId) {
        errors.push('Missing channelId');
      }
      if (!Array.isArray(encounter.combatants)) {
        errors.push('Invalid combatants (not an array)');
      }
      if (!Array.isArray(encounter.initiativeOrder)) {
        errors.push('Invalid initiativeOrder (not an array)');
      }

      // State-specific validation
      if (encounter.state === 'active') {
        if (encounter.initiativeOrder.length === 0) {
          errors.push('Active encounter with empty initiative order');
        }
        if (!encounter.startedAt) {
          errors.push('Active encounter without startedAt timestamp');
        }
        if (typeof encounter.currentTurnIndex !== 'number') {
          errors.push('Active encounter without valid currentTurnIndex');
        }
        if (encounter.round < 1) {
          errors.push('Active encounter with invalid round number');
        }
      }

      // Combatant validation
      if (Array.isArray(encounter.combatants)) {
        encounter.combatants.forEach((c, i) => {
          if (!c.avatarId) errors.push(`Combatant ${i} missing avatarId`);
          if (!c.name) errors.push(`Combatant ${i} missing name`);
          if (!c.ref) errors.push(`Combatant ${i} missing ref`);
        });
      }
    }

    if (errors.length > 0) {
      this.logger.error?.(
        `[CombatEncounter] Validation failed for operation '${operation}': ${errors.join(', ')}`
      );
      return false;
    }

    return true;
  }
}

export default CombatValidation;
