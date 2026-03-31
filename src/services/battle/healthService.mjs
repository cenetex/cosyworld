/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * HealthService - Canonical HP/damage utilities.
 * Uses StatService damage modifiers with avatar base stats.
 */

export class HealthService {
  constructor({ avatarService, statService, logger }) {
    this.avatarService = avatarService;
    this.statService = statService;
    this.logger = logger || console;
  }

  _getAvatarId(avatar) {
    if (!avatar) return null;
    return avatar._id || avatar.id || null;
  }

  async _resolveAvatar(avatarOrId) {
    if (!avatarOrId) return { avatar: null, avatarId: null };
    if (typeof avatarOrId === 'object') {
      return { avatar: avatarOrId, avatarId: this._getAvatarId(avatarOrId) };
    }
    const avatar = await this.avatarService?.getAvatarById?.(avatarOrId);
    return { avatar, avatarId: avatar?._id || avatarOrId };
  }

  async _resolveStats(avatar, avatarId) {
    if (avatar && this.avatarService?.getOrCreateStats) {
      return await this.avatarService.getOrCreateStats(avatar);
    }
    if (avatarId && this.avatarService?.getAvatarStats) {
      return await this.avatarService.getAvatarStats(avatarId);
    }
    return null;
  }

  _getMaxHp(stats) {
    if (!stats) return null;
    if (Number.isFinite(stats.maxHp)) return Math.max(1, stats.maxHp);
    if (Number.isFinite(stats.hp)) return Math.max(1, stats.hp);
    return null;
  }

  async getHpState(avatarOrId) {
    const { avatar, avatarId } = await this._resolveAvatar(avatarOrId);
    if (!avatarId) return null;

    const stats = await this._resolveStats(avatar, avatarId);
    const maxHp = this._getMaxHp(stats);
    if (!Number.isFinite(maxHp)) return null;

    const totalDamage = await this.statService.getTotalModifier(avatarId, 'damage');
    const currentHp = Math.min(maxHp, Math.max(0, maxHp - totalDamage));

    return { avatarId, currentHp, maxHp, totalDamage };
  }

  async getCurrentHp(avatarOrId) {
    const state = await this.getHpState(avatarOrId);
    return state?.currentHp ?? null;
  }

  async getMaxHp(avatarOrId) {
    const state = await this.getHpState(avatarOrId);
    return state?.maxHp ?? null;
  }

  async applyDamage(avatarOrId, amount, { source = null } = {}) {
    const damage = Math.max(0, Math.round(amount || 0));
    if (damage <= 0) return this.getHpState(avatarOrId);

    const { avatarId } = await this._resolveAvatar(avatarOrId);
    if (!avatarId) return null;

    await this.statService.createModifier('damage', damage, { avatarId, source });
    const state = await this.getHpState(avatarOrId);
    if (!state) return null;
    return { ...state, damageApplied: damage };
  }

  async applyHealing(avatarOrId, amount, { source = null } = {}) {
    const healing = Math.max(0, Math.round(amount || 0));
    if (healing <= 0) return this.getHpState(avatarOrId);

    const state = await this.getHpState(avatarOrId);
    if (!state) return null;

    const healAmount = Math.min(healing, Math.max(0, state.totalDamage || 0));
    if (healAmount <= 0) return state;

    await this.statService.createModifier('damage', -healAmount, { avatarId: state.avatarId, source });
    return {
      ...state,
      totalDamage: Math.max(0, (state.totalDamage || 0) - healAmount),
      currentHp: Math.min(state.maxHp, state.currentHp + healAmount),
      healed: healAmount
    };
  }

  async resetDamage(avatarOrId, { source = null } = {}) {
    const state = await this.getHpState(avatarOrId);
    if (!state) return null;
    if ((state.totalDamage || 0) <= 0) return state;

    await this.statService.createModifier('damage', -(state.totalDamage || 0), { avatarId: state.avatarId, source });
    return { ...state, totalDamage: 0, currentHp: state.maxHp };
  }
}
