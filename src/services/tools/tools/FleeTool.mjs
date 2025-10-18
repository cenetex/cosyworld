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
      
      // Get combat encounter service
      const ces = services?.combatEncounterService || this.combatEncounterService;
      if (!ces) {
        this.logger?.warn?.('[FleeTool] Combat system unavailable');
        return `-# [ ❌ Combat system unavailable. ]`;
      }
      
      // Get active encounter
      const encounter = ces.getEncounter(message.channel.id);
      if (!encounter || encounter.state !== 'active') {
        return `-# [ Not in combat. ]`;
      }
      
      // Check if it's the avatar's turn
      const avatarId = avatar.id || avatar._id;
      if (!ces.isTurn(encounter, avatarId)) {
        // Silent out-of-turn handling
        return null;
      }
      
      // Emit flee attempt event
      const publish = (evt) => {
        try { 
          (services?.eventPublisher?.publishEvent || basePublishEvent)(evt); 
        } catch (e) {
          this.logger?.warn?.(`[FleeTool] Event publish failed: ${e.message}`);
        }
      };
      
      const channelId = message.channel.id;
      const corrId = message.id;
      publish({ 
        type: 'combat.flee.attempt', 
        source: 'FleeTool', 
        corrId, 
        payload: { avatarId, channelId } 
      });

      // Delegate to CombatEncounterService.handleFlee for consistent logic
      this.logger?.info?.(`[FleeTool] ${avatar.name} attempting to flee in ${channelId}`);
      const result = await ces.handleFlee(encounter, avatarId);
      
      // Emit success/fail events
      if (result.success) {
        publish({ 
          type: 'combat.flee.success', 
          source: 'FleeTool', 
          corrId, 
          payload: { avatarId, channelId } 
        });
      } else {
        publish({ 
          type: 'combat.flee.fail', 
          source: 'FleeTool', 
          corrId, 
          payload: { avatarId, channelId } 
        });
      }
      
      // Post message via webhook if available
      if (result.message && this.discordService?.sendAsWebhook) {
        try {
          await this.discordService.sendAsWebhook(channelId, result.message, avatar);
        } catch (e) {
          this.logger?.warn?.(`[FleeTool] Webhook send failed: ${e.message}`);
        }
      }
      
      return result.message;
      
    } catch (error) {
      this.logger?.error?.(`[FleeTool] error: ${error.message}`);
      return `-# [ ❌ Error: Failed to flee: ${error.message} ]`;
    }
  }
}

export default FleeTool;
