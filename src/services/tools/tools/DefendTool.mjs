import { BasicTool } from '../BasicTool.mjs';

export class DefendTool extends BasicTool {
  constructor({
    configService,
    avatarService,
    battleService,
    mapService,
    conversationManager,
    diceService,
  }) {
    super();
    this.configService = configService;
    this.avatarService = avatarService;
    this.battleService = battleService;
    this.mapService = mapService;
    this.conversationManager = conversationManager;
    this.diceService = diceService;

    this.name = 'defend';
    this.description = 'Take a defensive stance';
    this.emoji = '🛡️';
    this.cooldownMs = 30 * 1000; // 30 seconds cooldown
  }

  async execute(message, params, avatar) {
    try {
      return await this.battleService.defend({ avatar });
    } catch (error) {
      return `-# [ ❌ Error: Failed to defend: ${error.message} ]`;
    }
  }

  getDescription() {
    return 'Take a defensive stance (+2 AC until next attack)';
  }

  async getSyntax() {
    return `${this.emoji}`;
  }
}
