/**
 * CombatNarrativeService
 * Listens to combat.* domain events and produces lightweight narrative / flavor lines
 * using the existing conversationManager + unifiedAIService pipeline. This removes
 * direct commentary responsibilities from CombatEncounterService.
 */
import eventBus from '../../utils/eventBus.mjs';

export class CombatNarrativeService {
  constructor({ logger, unifiedAIService, conversationManager, combatEncounterService, configService }) {
    this.logger = logger || console;
    this.unifiedAIService = unifiedAIService; // optional; conversationManager may internally use aiService
    this.conversationManager = conversationManager; // primary channel for speaking
    this.combatEncounterService = combatEncounterService; // used to map avatar refs
    this.configService = configService;
    this.enabled = (process.env.COMBAT_NARRATIVE_ENABLED || 'true') === 'true';
    this.randomChance = Math.max(0, Math.min(1, parseFloat(process.env.COMBAT_NARRATIVE_CHANCE || '0.55')));
    this.minGapMs = 3500; // gap between narrative posts per channel to avoid spam
    this._lastPost = new Map(); // channelId -> timestamp
    this._listeners = [];
  }

  /** Start subscribing to events */
  start() {
    if (!this.enabled) {
      this.logger.info('[CombatNarrative] disabled via env');
      return;
    }
    const types = [
      'combat.attack.hit',
      'combat.attack.miss',
      'combat.knockout',
      'combat.death',
      'combat.flee.success',
      'combat.flee.fail',
      'combat.hide.success',
      'combat.hide.fail'
    ];
    for (const t of types) {
      const h = (evt) => this._handle(evt).catch(e => this.logger.warn(`[CombatNarrative] handler error ${t}: ${e.message}`));
      eventBus.on(t, h);
      this._listeners.push([t, h]);
    }
    this.logger.info('[CombatNarrative] listeners registered');
  }

  stop() {
    for (const [t, h] of this._listeners) eventBus.off(t, h);
    this._listeners = [];
  }

  _shouldPost(channelId) {
    const now = Date.now();
    const last = this._lastPost.get(channelId) || 0;
    if (now - last < this.minGapMs) return false;
    if (Math.random() > this.randomChance) return false;
    this._lastPost.set(channelId, now);
    return true;
  }

  async _handle(evt) {
    try {
      const channelId = evt?.payload?.channelId;
      if (!channelId || !this.conversationManager?.sendResponse) return;
      if (!this._shouldPost(channelId)) return;
      const encounter = this.combatEncounterService?.getEncounter(channelId) || null;
      if (!encounter || encounter.state !== 'active') return;

      // Choose a speaker heuristically: prefer defender on miss/hit, attacker on KO/death/flee success
      const { attackerId, defenderId, avatarId } = evt.payload || {};
      let speakerId = null;
      switch (evt.type) {
        case 'combat.attack.hit':
        case 'combat.attack.miss':
          speakerId = defenderId || attackerId; break;
        case 'combat.knockout':
        case 'combat.death':
        case 'combat.flee.success':
          speakerId = attackerId || avatarId; break;
        case 'combat.flee.fail':
        case 'combat.hide.success':
        case 'combat.hide.fail':
          speakerId = avatarId || attackerId || defenderId; break;
        default:
          speakerId = attackerId || defenderId || avatarId || null;
      }
      const combatant = speakerId ? this.combatEncounterService?.getCombatant(encounter, speakerId) : null;
      const speaker = combatant?.ref || null;
      if (!speaker) return;

      // Get discord channel from encounter service (indirect to keep dependencies minimal)
      let channel = null;
      try { channel = this.combatEncounterService?._getChannel(encounter); } catch {}
      if (!channel) return;

      // Provide slight variation prompt context as system metadata: rely on conversationManager abstraction
      // We do NOT craft a custom prompt; we let sendResponse use existing persona + memory
      await this.conversationManager.sendResponse(channel, speaker, null, { overrideCooldown: true });
      this.logger.info?.(`[CombatNarrative] posted narrative line for ${speaker.name} (${evt.type})`);
    } catch (e) {
      this.logger.warn?.(`[CombatNarrative] _handle failed: ${e.message}`);
    }
  }
}

export default CombatNarrativeService;