// FleeTool.mjs
// Attempt to flee from the current combat encounter. On success: ends combat, moves avatar to Tavern thread,
// and applies a 24h combat cooldown (combatCooldownUntil). On failure: consumes turn.

import { BasicTool } from '../BasicTool.mjs';

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

      // Register a brief blocker to prevent racing next turn while we post result
      let resolveBlocker = null;
      try {
        const p = new Promise(res => { resolveBlocker = res; });
        ces.addTurnAdvanceBlocker(message.channel.id, p);
      } catch {}

      const result = await ces.handleFlee(encounter, avatar.id || avatar._id);
      // Post a small flavor line as the avatar
      try {
        if (result?.message && this.discordService?.sendAsWebhook) {
          await this.discordService.sendAsWebhook(message.channel.id, result.message, avatar);
        }
      } catch (e) {
        this.logger?.warn?.(`[FleeTool] webhook post failed: ${e.message}`);
      }
      try { resolveBlocker && resolveBlocker(); } catch {}
      return result?.message || null;
    } catch (error) {
      this.logger?.error?.(`[FleeTool] error: ${error.message}`);
      return `-# [ ❌ Error: Failed to flee: ${error.message} ]`;
    }
  }
}

export default FleeTool;
