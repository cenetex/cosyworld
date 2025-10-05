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
      'combat.hide.fail',
      // narrative request phases emitted by CombatEncounterService
      'combat.narrative.request.pre_combat',
      'combat.narrative.request.post_round',
      'combat.narrative.request.round_planning',
      'combat.narrative.request.commentary',
      'combat.narrative.request.inter_turn'
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
      // Narrative request events are always allowed to attempt posting (they already gate frequency in encounter pacing),
      // but still respect min gap + random chance for organic feel EXCEPT planning & pre_combat which we want reliably.
      const isRequest = evt.type.startsWith('combat.narrative.request.');
      if (!isRequest && !this._shouldPost(channelId)) return;
      const encounter = this.combatEncounterService?.getEncounter(channelId) || null;
      if (!encounter || encounter.state !== 'active') return;

      // Choose a speaker heuristically: prefer defender on miss/hit, attacker on KO/death/flee success
      const { attackerId, defenderId, avatarId } = evt.payload || {};
      let speakerId = null;
      switch (evt.type) {
        // Narrative request phases
        case 'combat.narrative.request.pre_combat': {
          // Pick up to first combatant (stable) to utter a line
          speakerId = encounter.initiativeOrder[0];
          break;
        }
        case 'combat.narrative.request.post_round': {
          // Prefer a random alive combatant who hasn't spoken recently
          const alive = encounter.combatants.filter(c => (c.currentHp || 0) > 0);
          if (alive.length) speakerId = alive[Math.floor(Math.random() * alive.length)]?.avatarId;
          break;
        }
        case 'combat.narrative.request.round_planning': {
          // Allow two quick planning utterances; handled by posting twice below
          speakerId = null; // handled specially
          break;
        }
        case 'combat.narrative.request.commentary': {
          // Mirror old commentary: prefer defender of last action else attacker
          const ctx = encounter.lastAction;
          if (ctx) speakerId = ctx.defenderId || ctx.attackerId;
          break;
        }
        case 'combat.narrative.request.inter_turn': {
          // Next in initiative order after current turn
          const currentId = this.combatEncounterService?.getCurrentTurnAvatarId(encounter);
          const order = encounter.initiativeOrder || [];
          const idx = order.indexOf(currentId);
          if (idx >= 0) speakerId = order[(idx + 1) % order.length];
          break;
        }
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
      // Special multi-speaker handling for planning phase
      if (evt.type === 'combat.narrative.request.round_planning') {
        const alive = encounter.combatants.filter(c => (c.currentHp || 0) > 0);
        const limit = Math.min(2, alive.length);
        const chosen = alive.slice(0, limit);
        let channel = null; try { channel = this.combatEncounterService?._getChannel(encounter); } catch {}
        if (!channel) return;
        for (const c of chosen) {
          try { await this.conversationManager.sendResponse(channel, c.ref, null, { overrideCooldown: true }); } catch {}
        }
        return;
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