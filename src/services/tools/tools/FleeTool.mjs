// FleeTool.mjs
// Attempt to flee from the current combat encounter. On success: ends combat, moves avatar to Tavern thread,
// and applies a 24h combat cooldown (combatCooldownUntil). On failure: consumes turn.

import { BasicTool } from '../BasicTool.mjs';
import { publishEvent as basePublishEvent } from '../../../events/envelope.mjs';

export class FleeTool extends BasicTool {
  constructor({
    logger,
    configService,
    avatarService,
    mapService,
    conversationManager,
    diceService,
    combatEncounterService,
    discordService,
  }) {
    super();
    this.logger = logger || console;
    this.configService = configService;
    this.avatarService = avatarService;
    this.mapService = mapService;
    this.conversationManager = conversationManager;
    this.diceService = diceService;
    this.combatEncounterService = combatEncounterService;
    this.discordService = discordService;

    this.name = 'flee';
    this.description = 'Attempt to flee from the current encounter.';
    this.emoji = '🏃';
    this.cooldownMs = 30 * 1000; // 30 seconds cooldown to avoid spam
  }

  getDescription() {
    return 'Attempt to flee the battle. On success: duel ends and you retreat to the Tavern.';
  }

  async execute(message, _params, avatar, services) {
    try {
      // Disallow actions from dead or KO'd
      const now = Date.now();
      if (avatar?.status === 'dead' || avatar?.status === 'knocked_out' || (avatar?.knockedOutUntil && now < avatar.knockedOutUntil)) {
        return null;
      }
      const ces = services?.combatEncounterService || this.combatEncounterService;
      if (!ces) return `-# [ ❌ Combat system unavailable. ]`;
      const encounter = ces.getEncounter(message.channel.id);
      if (!encounter || encounter.state !== 'active') return `-# [ Not in combat. ]`;
      if (!ces.isTurn(encounter, avatar.id || avatar._id)) {
        // Silent out-of-turn handling
        return null;
      }
      const publish = (evt) => {
        try { (services?.eventPublisher?.publishEvent || basePublishEvent)(evt); } catch {}
      };
      const channelId = message.channel.id;
      const corrId = message.id;
      const actorId = avatar.id || avatar._id;
      publish({ type: 'combat.flee.attempt', source: 'FleeTool', corrId, payload: { avatarId: actorId, channelId } });

      // Re-implement core flee logic (duplicated minimal subset of handleFlee to avoid direct dependency effects)
      // Dex check vs highest enemy passive Perception (10 + Dex mod)
      let success = false; let dc = 10; let roll = 0;
      try {
        const enemies = encounter.combatants.filter(c => (c.currentHp || 0) > 0 && (c.avatarId !== actorId));
        for (const e of enemies) {
          try {
            const stats = await this.avatarService.getOrCreateStats(e.ref);
            const mod = Math.floor(((stats.dexterity || 10) - 10) / 2);
            dc = Math.max(dc, 10 + mod);
          } catch {}
        }
        const aStats = await this.avatarService.getOrCreateStats(avatar);
        roll = this.diceService.rollDie(20) + Math.floor(((aStats.dexterity || 10) - 10) / 2);
        success = roll >= dc;
      } catch {}

      if (success) {
        try {
          avatar.combatCooldownUntil = Date.now() + 24 * 60 * 60 * 1000;
          await this.avatarService.updateAvatar(avatar);
        } catch {}
        // Move to Tavern
        try {
          const tavernId = await this.discordService?.getOrCreateThread?.(channelId, 'tavern');
          if (tavernId && this.mapService?.updateAvatarPosition) {
            await this.mapService.updateAvatarPosition(avatar, tavernId);
          }
        } catch (e) { this.logger?.warn?.(`[FleeTool] movement failed: ${e.message}`); }
        publish({ type: 'combat.flee.success', source: 'FleeTool', corrId, payload: { avatarId: actorId, roll, dc, channelId } });
        const msg = `-# 🏃 [ ${avatar.name} flees to the Tavern! The duel ends. ]`;
        try { if (this.discordService?.sendAsWebhook) await this.discordService.sendAsWebhook(channelId, msg, avatar); } catch {}
        return msg;
      } else {
        publish({ type: 'combat.flee.fail', source: 'FleeTool', corrId, payload: { avatarId: actorId, roll, dc, channelId } });
        const msg = `-# 🏃 [ ${avatar.name} fails to escape! ]`;
        try { if (this.discordService?.sendAsWebhook) await this.discordService.sendAsWebhook(channelId, msg, avatar); } catch {}
        return msg;
      }
    } catch (error) {
      this.logger?.error?.(`[FleeTool] error: ${error.message}`);
      return `-# [ ❌ Error: Failed to flee: ${error.message} ]`;
    }
  }
}

export default FleeTool;
