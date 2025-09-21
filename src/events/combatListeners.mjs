/**
 * combatListeners.mjs
 * Subscribes to combat.* events emitted by BattleService & tools and applies encounter state transitions.
 * Transitional adapter while phasing out direct handleAttackResult calls.
 */
import eventBus from '../utils/eventBus.mjs';

/**
 * Registers combat listeners.
 * @param {Object} deps
 * @param {CombatEncounterService} deps.combatEncounterService
 * @param {Object} [deps.logger]
 */
export function registerCombatListeners({ combatEncounterService, logger = console }) {
  if (!combatEncounterService) {
    logger.warn('[combatListeners] combatEncounterService missing; listeners not registered');
    return () => {};
  }

  const listeners = [];

  const safe = (fn) => async (evt) => {
    try { await fn(evt); } catch (e) { logger.warn(`[combatListeners] handler failed for ${evt?.type}: ${e.message}`); }
  };

  // Utility: derive encounter by channelId (payload may include channelId) or by defender/attacker presence (fallback omitted for simplicity)
  function getEncounterFromEvent(evt) {
    const ch = evt?.payload?.channelId;
    if (!ch) return null;
    return combatEncounterService.getEncounter(ch);
  }

  async function applyAttackLike(evt) {
    const enc = getEncounterFromEvent(evt);
    if (!enc || enc.state !== 'active') return;
    const { attackerId, defenderId, damage, critical, attackRoll, armorClass } = evt.payload || {};
    const attId = attackerId; const defId = defenderId;
    // Apply damage for hit/knockout/death
    if (damage && (evt.type === 'combat.attack.hit' || evt.type === 'combat.knockout' || evt.type === 'combat.death')) {
      try { combatEncounterService.applyDamage(enc, defId, damage); combatEncounterService.markHostile?.(enc); } catch {}
    }
    // KO / death state updates similar to existing logic
    if (evt.type === 'combat.knockout' || evt.type === 'combat.death') {
      try {
        const def = combatEncounterService.getCombatant(enc, defId);
        if (def) {
          def.currentHp = 0;
          if (!def.conditions?.includes('unconscious')) def.conditions = [...(def.conditions || []), 'unconscious'];
        }
        enc.knockout = { attackerId: attId, defenderId: defId, result: evt.type === 'combat.death' ? 'dead' : 'knockout' };
      } catch {}
    }
    // Populate lastAction snapshot
    try {
      const attacker = combatEncounterService.getCombatant(enc, attId);
      const defender = combatEncounterService.getCombatant(enc, defId);
      enc.lastAction = {
        attackerId: attId,
        attackerName: attacker?.name,
        defenderId: defId,
        defenderName: defender?.name,
        result: evt.type.replace('combat.', ''),
        damage: damage || 0,
        attackRoll,
        armorClass,
        critical: !!critical,
      };
      enc.lastActionAt = Date.now();
    } catch {}

    // Early end evaluation
    try { if (evt.type === 'combat.knockout' || evt.type === 'combat.death') { if (combatEncounterService.evaluateEnd(enc)) return; } } catch {}

    // Advance turn if attacker was current turn
    try {
      const currentId = combatEncounterService.getCurrentTurnAvatarId(enc);
      if (currentId && currentId === attId) {
        // Wait blockers before advancing
        try { await combatEncounterService._awaitTurnAdvanceBlockers?.(enc); } catch {}
        combatEncounterService.nextTurn(enc);
      }
    } catch {}

    // Final end check
    try { combatEncounterService.evaluateEnd(enc); } catch {}
  }

  listeners.push(['combat.attack.hit', safe(applyAttackLike)]);
  listeners.push(['combat.attack.miss', safe(applyAttackLike)]);
  listeners.push(['combat.knockout', safe(applyAttackLike)]);
  listeners.push(['combat.death', safe(applyAttackLike)]);

  for (const [evt, handler] of listeners) {
    eventBus.on(evt, handler);
  }

  logger.info('[combatListeners] registered handlers for attack/miss/knockout/death');

  return () => {
    for (const [evt, handler] of listeners) eventBus.off(evt, handler);
    logger.info('[combatListeners] listeners removed');
  };
}

export default registerCombatListeners;
