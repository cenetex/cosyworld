/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

// BattleService.mjs
// Centralizes all combat mechanics (attack, defend, knockout, etc.)
import { publishEvent as basePublishEvent } from '../../events/envelope.mjs';

export class BattleService  {
  constructor({
    avatarService,
    logger,
    databaseService,
    statService,
    mapService,
    diceService,
    eventPublisher
  }) {
    this.logger = logger || console;
    this.databaseService = databaseService;
    this.avatarService = avatarService;
    this.statService = statService;
    this.mapService = mapService;
    this.diceService = diceService;
    this.eventPublisher = eventPublisher; // optional injection (publishEvent wrapper)
    // Cache a publish function to avoid dynamic imports in hot paths
    this._publish = (evt) => {
      try {
        const fn = this.eventPublisher?.publishEvent || basePublishEvent;
        return fn?.(evt);
      } catch (e) {
        this.logger?.warn?.(`[BattleService] publish failed: ${e.message}`);
      }
    };

    this.started = false;
  }

  async attack({ message: _message, attacker, defender, services: _services }) {
  const publish = this._publish;
    const channelId = _message?.channel?.id;
    const corrId = _message?.id || null;
    // Emit attempt event early (no outcome yet)
    // We'll fill rawRoll later; here we proceed after computing
    try {
      const now = Date.now();
      if (attacker?.status === 'dead' || attacker?.status === 'knocked_out' || (attacker?.knockedOutUntil && now < attacker.knockedOutUntil)) {
        this.logger?.info?.(`[BattleService] attack blocked: ${attacker?.name || attacker?.id} is KO'd or dead.`);
  publish?.({ type: 'combat.attack.blocked', source: 'BattleService', corrId, payload: { attackerId: attacker?._id || attacker?.id, reason: 'status', channelId } });
        return { result: 'invalid', message: `-# 💤 [ ${attacker?.name || 'Attacker'} cannot act right now. ]` };
      }
    } catch {}

    const attackerStats = await this.avatarService.getOrCreateStats(attacker);
    const targetStats = await this.avatarService.getOrCreateStats(defender);

    const strMod = Math.floor((attackerStats.strength - 10) / 2);
    const dexMod = Math.floor((targetStats.dexterity - 10) / 2);
    const rollOnce = () => this.diceService.rollDie(20);
    let raw1 = rollOnce();
    let raw2 = null;
    let usedAdvantage = false;
    if (attackerStats.advantageNextAttack) {
      raw2 = rollOnce();
      usedAdvantage = true;
    }
    const rawRoll = raw2 ? Math.max(raw1, raw2) : raw1;
    const attackRoll = rawRoll + strMod;
    const armorClass = 10 + dexMod + (targetStats.isDefending ? 2 : 0);
  publish?.({ type: 'combat.attack.attempt', source: 'BattleService', corrId, payload: { attackerId: attacker._id || attacker.id, defenderId: defender._id || defender.id, rawRoll, attackRoll, armorClass, advantageUsed: usedAdvantage, channelId } });

    const isCritical = rawRoll === 20;

    if (attackRoll >= armorClass) {
      let damageDice = this.diceService.rollDie(8);
      if (isCritical) damageDice += this.diceService.rollDie(8);
      const damage = Math.max(1, damageDice + strMod);
      await this.statService.createModifier('damage', damage, { avatarId: defender._id });
      targetStats.isDefending = false;
      await this.avatarService.updateAvatarStats(defender, targetStats);
      const totalDamage = await this.statService.getTotalModifier(defender._id, 'damage');
      const currentHp = targetStats.hp - totalDamage;

      if (currentHp <= 0) {
        const ko = await this.handleKnockout({ message: _message, targetAvatar: defender, damage, attacker, services: _services, corrId });
  publish?.({ type: ko.result === 'dead' ? 'combat.death' : 'combat.knockout', source: 'BattleService', corrId, payload: { attackerId: attacker._id || attacker.id, defenderId: defender._id || defender.id, damage, livesRemaining: defender.lives, critical: isCritical, channelId } });
        return ko;
      }

      const advNote = usedAdvantage ? ' with advantage' : '';
      const baseMsg = `-# ⚔️ [ ${attacker.name} hits ${defender.name}${advNote} for ${damage} damage! (${attackRoll} vs AC ${armorClass}) | HP: ${currentHp}/${targetStats.hp} ]`;
      const critMsg = isCritical ? `\n-# 💥 [ Critical hit! A devastating blow lands (nat 20). ]` : '';
      const res = { result: 'hit', critical: isCritical, message: baseMsg + critMsg, damage, currentHp, attackRoll, armorClass, rawRoll };
      this.logger?.info?.(`[BattleService] Hit: ${attacker.name} → ${defender.name} atk=${attackRoll} vs AC ${armorClass} dmg=${damage}${isCritical ? ' CRIT' : ''}`);
  publish?.({ type: 'combat.attack.hit', source: 'BattleService', corrId, payload: { attackerId: attacker._id || attacker.id, defenderId: defender._id || defender.id, damage, critical: isCritical, attackRoll, armorClass, currentHp, rawRoll, channelId } });
      if (usedAdvantage) {
        try { attackerStats.advantageNextAttack = false; attackerStats.isHidden = false; await this.avatarService.updateAvatarStats(attacker, attackerStats); } catch {}
      }
      return res;
    } else {
      targetStats.isDefending = false;
      await this.avatarService.updateAvatarStats(defender, targetStats);
      const res = { result: 'miss', message: `-# 🛡️ [ ${attacker.name}'s attack misses ${defender.name}! (${attackRoll} vs AC ${armorClass}) ]`, attackRoll, armorClass, rawRoll };
      this.logger?.info?.(`[BattleService] Miss: ${attacker.name} → ${defender.name} atk=${attackRoll} vs AC ${armorClass}`);
  publish?.({ type: 'combat.attack.miss', source: 'BattleService', corrId, payload: { attackerId: attacker._id || attacker.id, defenderId: defender._id || defender.id, attackRoll, armorClass, rawRoll, channelId } });
      if (usedAdvantage) {
        try { attackerStats.advantageNextAttack = false; attackerStats.isHidden = false; await this.avatarService.updateAvatarStats(attacker, attackerStats); } catch {}
      }
      return res;
    }
  }

  async handleKnockout({ message: _message, targetAvatar, damage, attacker, services: _services, corrId }) {
    const publish = this._publish;
    targetAvatar.lives = (targetAvatar.lives || 3) - 1;
    if (targetAvatar.lives <= 0) {
      targetAvatar.status = 'dead';
      targetAvatar.deathTimestamp = Date.now();
      await this.avatarService.updateAvatar(targetAvatar);
  publish?.({ type: 'combat.death', source: 'BattleService', corrId, payload: { attackerId: attacker._id || attacker.id, defenderId: targetAvatar._id || targetAvatar.id, damage } });
      return { result: 'dead', message: `-# 💀 [ ${attacker.name} has dealt the final blow! ${targetAvatar.name} has fallen permanently! ☠️ ]` };
    }
    const db = await this.databaseService.getDatabase();
    await db.collection('dungeon_modifiers').deleteMany({ avatarId: targetAvatar._id, stat: 'damage' });
    const newStats = this.statService.generateStatsFromDate(targetAvatar.createdAt);
    newStats.avatarId = targetAvatar._id;
    await this.avatarService.updateAvatarStats(targetAvatar, newStats);
    const now = Date.now();
    targetAvatar.status = 'knocked_out';
    targetAvatar.knockedOutUntil = now + 24 * 60 * 60 * 1000;
    await this.avatarService.updateAvatar(targetAvatar);
    try {
      const discordService = _services?.discordService;
      const baseChannelId = _message?.channel?.id || targetAvatar.channelId;
      if (discordService?.getOrCreateThread && baseChannelId && this.mapService?.updateAvatarPosition) {
        const tavernId = await discordService.getOrCreateThread(baseChannelId, 'tavern');
        await this.mapService.updateAvatarPosition(targetAvatar, tavernId);
        this.logger?.info?.(`[BattleService] KO move: ${targetAvatar.name} → Tavern (${tavernId})`);
      }
    } catch (e) { this.logger?.warn?.(`[BattleService] KO tavern move failed: ${e.message}`); }
  publish?.({ type: 'combat.knockout', source: 'BattleService', corrId, payload: { attackerId: attacker._id || attacker.id, defenderId: targetAvatar._id || targetAvatar.id, damage, livesRemaining: targetAvatar.lives } });
    return { result: 'knockout', message: `-# 💥 [ ${attacker.name} knocked out ${targetAvatar.name} for ${damage} damage! ${targetAvatar.lives} lives remaining! 💫 ]` };
  }

  async defend({ avatar }) {
    const stats = await this.avatarService.getOrCreateStats(avatar);
    stats.isDefending = true;
    await this.avatarService.updateAvatarStats(avatar, stats);
    return `-# 🛡️ [ **${avatar.name}** takes a defensive stance! **AC increased by 2** until next attack. ]`;
  }

  /**
   * Hide: Stealth check vs highest passive Perception among visible foes at location.
   * On success: set isHidden=true and advantageNextAttack=true until next attack.
   */
  async hide({ message, avatar }) {
    const locationResult = await this.mapService.getLocationAndAvatars(message.channel.id);
    const others = (locationResult?.avatars || []).filter(a => a._id?.toString() !== avatar._id?.toString());
    const stats = await this.avatarService.getOrCreateStats(avatar);

    // Compute opposing passive perception = 10 + Wis mod (take highest among others)
    let highestPassive = 10;
    for (const o of others) {
      try {
        const os = await this.avatarService.getOrCreateStats(o);
        const wisMod = Math.floor(((os.wisdom || 10) - 10) / 2);
        highestPassive = Math.max(highestPassive, 10 + wisMod);
      } catch {}
    }

    const dexMod = Math.floor(((stats.dexterity || 10) - 10) / 2);
    const roll = this.diceService.rollDie(20);
    const stealth = roll + dexMod;

    if (stealth >= highestPassive) {
      stats.isHidden = true;
      stats.advantageNextAttack = true;
      await this.avatarService.updateAvatarStats(avatar, stats);
      return {
        result: 'success',
        message: `-# 🫥 [ ${avatar.name} slips into the shadows (Stealth ${stealth} vs Passive ${highestPassive}). Next attack has advantage. ]`
      };
    } else {
      stats.isHidden = false;
      await this.avatarService.updateAvatarStats(avatar, stats);
      return {
        result: 'fail',
        message: `-# 👀 [ ${avatar.name} fails to hide (Stealth ${stealth} vs Passive ${highestPassive}). ]`
      };
    }
  }
}
