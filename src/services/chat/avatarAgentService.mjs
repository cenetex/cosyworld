/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

const ACTIONS = /** @type {const} */ ({
  RESPOND: 'respond',
  WAIT: 'wait',
  DISENGAGE: 'disengage',
});

/**
 * AvatarAgentService
 *
 * Layer B: Stable agentic controller that decides whether an avatar should:
 * - respond (generate a chat reply)
 * - wait (do nothing this tick)
 * - disengage (stop participating for a while)
 */
export class AvatarAgentService {
  constructor({ logger, configService, unifiedAIService }) {
    this.logger = logger || console;
    this.configService = configService;
    this.unifiedAIService = unifiedAIService;

    this.state = new Map(); // key: `${channelId}:${avatarId}` -> { disengagedUntil: number }

    this.defaults = {
      disengageTtlMs: Number(process.env.AGENT_DISENGAGE_TTL_MS || 5 * 60 * 1000),
      enabled: String(process.env.AGENTIC_ACTIONS_ENABLED || 'true').toLowerCase() === 'true',
    };
  }

  _key(channelId, avatarId) {
    return `${channelId}:${avatarId}`;
  }

  _getCfg() {
    const cfg = this.configService?.get?.('agenticConversation') || {};
    return cfg && typeof cfg === 'object' ? cfg : {};
  }

  _getAgentModel() {
    const aiCfg = this.configService?.getAIConfig?.() || {};
    return (
      aiCfg.agentModel ||
      aiCfg.decisionMakerModel ||
      aiCfg.structuredModel ||
      aiCfg.chatModel ||
      aiCfg.model ||
      undefined
    );
  }

  /**
   * Decide next action for an avatar.
   *
   * @returns {Promise<{action: 'respond'|'wait'|'disengage', confidence?: number, reason?: string, model?: string}>}
   */
  async decideAction({ channel, message, avatar, trigger }) {
    const channelId = channel?.id;
    const avatarId = `${avatar?._id || avatar?.id || ''}`;

    if (!this.defaults.enabled) {
      return { action: ACTIONS.RESPOND, reason: 'agentic actions disabled' };
    }

    if (!channelId || !avatarId || !avatar) {
      return { action: ACTIONS.WAIT, reason: 'missing channel/avatar' };
    }

    // Hard overrides for direct engagement: reply/mention should respond.
    if (message?.repliedToAvatarId && `${message.repliedToAvatarId}` === avatarId) {
      return { action: ACTIONS.RESPOND, reason: 'direct reply to avatar' };
    }

    const content = String(message?.content || '');
    if (content) {
      const lower = content.toLowerCase();
      const name = String(avatar?.name || '').toLowerCase();
      if (name && lower.includes(name)) {
        return { action: ACTIONS.RESPOND, reason: 'avatar name mentioned' };
      }
      const emoji = String(avatar?.emoji || '').trim();
      if (emoji && lower.includes(emoji.toLowerCase())) {
        return { action: ACTIONS.RESPOND, reason: 'avatar emoji mentioned' };
      }
    }

    // If currently disengaged, keep disengaging unless directly engaged (handled above).
    const key = this._key(channelId, avatarId);
    const rec = this.state.get(key);
    if (rec?.disengagedUntil && Date.now() < rec.disengagedUntil) {
      return { action: ACTIONS.DISENGAGE, reason: 'within disengage window' };
    }

    // If no AI service, fall back to wait (avoid unexpected chatter).
    const ai = this.unifiedAIService;
    if (!ai || typeof ai.structured !== 'function') {
      return { action: ACTIONS.WAIT, reason: 'no unifiedAIService.structured available' };
    }

    const cfg = this._getCfg();
    const model = this._getAgentModel();

    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: [ACTIONS.RESPOND, ACTIONS.WAIT, ACTIONS.DISENGAGE] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        reason: { type: 'string' },
      },
      required: ['action', 'confidence', 'reason'],
    };

    const prompt = [
      `You are the stable conversation controller for the avatar: ${avatar.name}.`,
      `Pick exactly one next action: respond | wait | disengage.`,
      `Definitions:`,
      `- respond: the avatar should send a message now.`,
      `- wait: do nothing now, stay available.`,
      `- disengage: do not respond and step back for a while (avoid being selected repeatedly).`,
      `Return JSON only, matching the schema.`,
      ``,
      `Context:`,
      `- triggerType: ${trigger?.type || 'unknown'}`,
      `- authorIsBot: ${message?.author?.bot ? 'true' : 'false'}`,
      `- messageContent: ${JSON.stringify(String(message?.content || ''))}`,
    ].join('\n');

    try {
      const corrId = `agentAction:${avatarId}:${channelId}:${Date.now()}`;
      const env = await ai.structured({
        prompt,
        schema,
        options: {
          model,
          temperature: cfg.temperature ?? 0.2,
          corrId,
        },
      });

      const data = env?.data ? env.data : (() => {
        try {
          const text = typeof env?.text === 'string' ? env.text : '';
          return text ? JSON.parse(text) : null;
        } catch {
          return null;
        }
      })();

      const action = data?.action;
      const confidence = typeof data?.confidence === 'number' ? data.confidence : undefined;
      const reason = typeof data?.reason === 'string' ? data.reason : undefined;

      if (action === ACTIONS.DISENGAGE) {
        const ttlMs = Number(cfg.disengageTtlMs ?? this.defaults.disengageTtlMs);
        this.state.set(key, { disengagedUntil: Date.now() + Math.max(10_000, ttlMs) });
      }

      if (action === ACTIONS.RESPOND || action === ACTIONS.WAIT || action === ACTIONS.DISENGAGE) {
        return { action, confidence, reason, model };
      }

      return { action: ACTIONS.WAIT, reason: 'invalid action from model', model };
    } catch (e) {
      this.logger.warn?.(`[AvatarAgentService] decideAction failed: ${e.message}`);
      return { action: ACTIONS.WAIT, reason: 'agent decision error', model };
    }
  }
}

export default AvatarAgentService;
