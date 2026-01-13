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
    this.state = new Map(); // key: `${channelId}:${avatarId}` → { lastToolAt, msgsSince, channelCalls: Array<number> }

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
      this.state.set(key, { lastToolAt: 0, msgsSince: 0, channelCalls: [] });
    }
    return this.state.get(key);
  }

  onMessageObserved(channelId, avatarId) {
    const st = this._getState(channelId, avatarId);
    st.msgsSince = (st.msgsSince || 0) + 1;
  }

  _shouldPlanNow(channelId, avatarId) {
    const enabled = this.getCfg('enabled');
    if (enabled === false) return false;
    const st = this._getState(channelId, avatarId);
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
    if (Math.random() < 0.2) {
      return { tool: 'camera', params: [], reason: 'Periodic engagement selfie.', confidence: 0.65 };
    }

    return null;
  }

  async planAndMaybeExecute(message, avatar, context = {}) {
    try {
      const channelId = message?.channel?.id;
      if (!channelId || !avatar) return;

      // Observe the message to increment counters
      this.onMessageObserved(channelId, avatar._id || avatar.id);

      // Combat gating: disable planner during combat
      const ces = this.toolService?.toolServices?.combatEncounterService;
      const inCombat = (() => { try { return ces?.isInActiveCombat?.(channelId, avatar.id || avatar._id) || false; } catch { return false; } })();
      if (inCombat) return;

      if (!this._shouldPlanNow(channelId, avatar._id || avatar.id)) return;

      const candidate = this._pickCandidate(message, avatar);
      if (!candidate) return;

      const threshold = this.getCfg('threshold') ?? this.defaults.threshold;
      if ((candidate.confidence || 0) < threshold) return;

      // Delay a bit for natural pacing
      const [minD, maxD] = this.getCfg('delayRangeMs') || this.defaults.delayRangeMs;
      const delayMs = Math.floor(minD + Math.random() * (maxD - minD));

      const key = this._getKey(channelId, avatar._id || avatar.id);
      const exec = async () => {
        const st = this._getState(channelId, avatar._id || avatar.id);
        // Execute via ToolService (will apply its own gating/cooldowns)
        try {
          const res = await this.toolService.executeTool(candidate.tool, message, candidate.params, avatar, context);
          this.logger?.info?.(`[Agentic] ${avatar.name} → ${candidate.tool} (${candidate.params.join(' ')}) result: ${res && res.slice ? res.slice(0,120) : ''}`);
          if (res) {
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
        }
      };

      if (this.schedulingService?.addTask) {
        // Schedule a one-off task
        this.schedulingService.addTask(`agentic-${key}-${Date.now()}`, exec, delayMs);
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
