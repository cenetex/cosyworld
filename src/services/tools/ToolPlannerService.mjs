/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

// ToolPlannerService.mjs

export class ToolPlannerService {
  constructor({ logger, configService, toolService, schedulingService } = {}) {
    this.logger = logger || console;
    this.configService = configService;
    this.toolService = toolService;
    this.schedulingService = schedulingService;

    // In-memory cadence and budgets
    this.state = new Map(); // key: `${channelId}:${avatarId}` → { lastToolAt, msgsSince, channelCalls: Array<number>, pendingTask: boolean }

    // Track image-generating tool usage per avatar (separate from general cooldowns)
    this.imageGenCooldowns = new Map(); // avatarId → timestamp of last image gen
    this.IMAGE_GEN_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes between agentic image generations
    this.IMAGE_GEN_TOOLS = new Set(['camera', 'selfie', 'video camera']);

    // Defaults (overridable via config agenticTooling.*)
    this.defaults = {
      enabled: true,
      minMessagesBetweenCalls: 3,
      probabilityPerMessage: 0.2,
      perAvatarCooldownMs: 60 * 1000,
      perChannelWindowMs: 15 * 60 * 1000,
      perChannelMaxCalls: 3,
      threshold: 0.6,
      delayRangeMs: [2000, 5000],
    };
  }

  getCfg(key) {
    const cfg = this.configService?.get?.('agenticTooling') || {};
    return (key ? cfg[key] : cfg) ?? undefined;
  }

  _getKey(channelId, avatarId) { return `${channelId}:${avatarId}`; }

  _getState(channelId, avatarId) {
    const key = this._getKey(channelId, avatarId);
    if (!this.state.has(key)) {
      this.state.set(key, { lastToolAt: 0, msgsSince: 0, channelCalls: [], pendingTask: false });
    }
    return this.state.get(key);
  }

  onMessageObserved(channelId, avatarId) {
    const st = this._getState(channelId, avatarId);
    st.msgsSince = (st.msgsSince || 0) + 1;
  }

  /**
   * Check if an image-generating tool can be used by this avatar (agentic-specific cooldown).
   * @returns {boolean}
   */
  _canUseImageGenTool(avatarId) {
    const lastUse = this.imageGenCooldowns.get(avatarId) || 0;
    const elapsed = Date.now() - lastUse;
    return elapsed >= this.IMAGE_GEN_COOLDOWN_MS;
  }

  /**
   * Record that an image-generating tool was used by this avatar.
   */
  _recordImageGenUse(avatarId) {
    this.imageGenCooldowns.set(avatarId, Date.now());
  }

  _shouldPlanNow(channelId, avatarId) {
    const enabled = this.getCfg('enabled');
    if (enabled === false) return false;
    const st = this._getState(channelId, avatarId);

    // If there's already a pending agentic task for this avatar/channel, skip
    if (st.pendingTask) return false;

    const now = Date.now();
    const minMsgs = this.getCfg('minMessagesBetweenCalls') ?? this.defaults.minMessagesBetweenCalls;
    const p = this.getCfg('probabilityPerMessage') ?? this.defaults.probabilityPerMessage;
    const perAvatarCd = this.getCfg('perAvatarCooldownMs') ?? this.defaults.perAvatarCooldownMs;
    const winMs = this.getCfg('perChannelWindowMs') ?? this.defaults.perChannelWindowMs;
    const maxCalls = this.getCfg('perChannelMaxCalls') ?? this.defaults.perChannelMaxCalls;

    if (now - (st.lastToolAt || 0) < perAvatarCd) return false;

    // Clean channel window
    st.channelCalls = (st.channelCalls || []).filter(ts => now - ts < winMs);
    if (st.channelCalls.length >= maxCalls) return false;

    if ((st.msgsSince || 0) >= minMsgs) return true;
    return Math.random() < p;
  }

  _pickCandidate(message, avatar) {
    const avatarId = avatar?._id || avatar?.id;

    // Very small heuristic set for MVP
    // 1) If avatar is injured and holds an item, suggest item use
    try {
      const maxHp = Math.max(1, avatar?.stats?.hp || 10);
      const curHp = Math.max(0, typeof avatar?.currentHp === 'number' ? avatar.currentHp : maxHp);
      const injured = curHp < Math.floor(maxHp * 0.6);
      if (injured && avatar?.selectedItemId) {
        return { tool: 'item', params: ['use'], reason: 'Avatar injured and holds an item.', confidence: 0.75 };
      }
    } catch {}

    // 2) Occasionally propose a selfie for channel engagement
    // BUT only if the avatar hasn't recently generated an image (agentic-specific cooldown)
    if (Math.random() < 0.2) {
      if (!this._canUseImageGenTool(avatarId)) {
        // Skip image generation, avatar used it recently
        this.logger?.debug?.(`[Agentic] Skipping camera for ${avatar?.name}: image gen on cooldown`);
        return null;
      }
      return { tool: 'camera', params: [], reason: 'Periodic engagement selfie.', confidence: 0.65 };
    }

    return null;
  }

  async planAndMaybeExecute(message, avatar, context = {}) {
    try {
      const channelId = message?.channel?.id;
      const avatarId = avatar?._id || avatar?.id;
      if (!channelId || !avatar) return;

      // Observe the message to increment counters
      this.onMessageObserved(channelId, avatarId);

      // Combat gating: disable planner during combat
      const ces = this.toolService?.toolServices?.combatEncounterService;
      const inCombat = (() => { try { return ces?.isInActiveCombat?.(channelId, avatar.id || avatar._id) || false; } catch { return false; } })();
      if (inCombat) return;

      if (!this._shouldPlanNow(channelId, avatarId)) return;

      const candidate = this._pickCandidate(message, avatar);
      if (!candidate) return;

      const threshold = this.getCfg('threshold') ?? this.defaults.threshold;
      if ((candidate.confidence || 0) < threshold) return;

      // Delay a bit for natural pacing
      const [minD, maxD] = this.getCfg('delayRangeMs') || this.defaults.delayRangeMs;
      const delayMs = Math.floor(minD + Math.random() * (maxD - minD));

      const key = this._getKey(channelId, avatarId);
      const st = this._getState(channelId, avatarId);

      // Mark that we have a pending task to prevent duplicate scheduling
      st.pendingTask = true;

      const exec = async () => {
        try {
          // Double-check image gen cooldown right before execution
          if (this.IMAGE_GEN_TOOLS.has(candidate.tool) && !this._canUseImageGenTool(avatarId)) {
            this.logger?.debug?.(`[Agentic] Skipping ${candidate.tool} for ${avatar.name}: image gen cooldown active at execution time`);
            return;
          }

          // Execute via ToolService (will apply its own gating/cooldowns)
          const res = await this.toolService.executeTool(candidate.tool, message, candidate.params, avatar, context);
          const resMessage = res?.message ?? (typeof res === 'string' ? res : '');
          this.logger?.info?.(`[Agentic] ${avatar.name} → ${candidate.tool} (${candidate.params.join(' ')}) result: ${resMessage ? resMessage.slice(0,120) : ''}`);

          // Track image generation usage
          if (this.IMAGE_GEN_TOOLS.has(candidate.tool) && resMessage && !resMessage.includes('Please wait')) {
            this._recordImageGenUse(avatarId);
          }

          if (resMessage) {
            // Log memory of the action succinctly
            try {
              await this.toolService.memoryService?.addMemory?.(avatar._id, `[agentic:${candidate.tool}] ${candidate.params.join(' ')}`);
            } catch {}
          }
        } catch (err) {
          this.logger?.warn?.('[Agentic] Execute failed:', err?.message);
        } finally {
          // Update cadence state
          const now = Date.now();
          st.lastToolAt = now;
          st.msgsSince = 0;
          st.channelCalls = st.channelCalls || [];
          st.channelCalls.push(now);
          // Clear the pending flag
          st.pendingTask = false;
        }
      };

      // Use scheduleOnce for one-shot execution (not repeating interval!)
      if (this.schedulingService?.scheduleOnce) {
        this.schedulingService.scheduleOnce(`agentic-${key}`, exec, delayMs);
      } else if (typeof setTimeout !== 'undefined') {
        setTimeout(exec, delayMs);
      } else {
        await exec();
      }
    } catch (err) {
      this.logger?.warn?.('[Agentic] planAndMaybeExecute error:', err?.message);
    }
  }
}
