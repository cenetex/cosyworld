/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

// BattleService.mjs
// Centralizes all combat mechanics (attack, defend, knockout, etc.)

export class BattleService  {
  constructor({
    avatarService,
    logger,
    databaseService,
    statService,
    mapService,
    diceService
  }) {
    this.logger = logger || console;
    this.databaseService = databaseService;
    this.avatarService = avatarService;
    this.statService = statService;
    this.mapService = mapService;
    this.diceService = diceService;

    this.started = false;
  }

  async attack({ message: _message, attacker, defender, services: _services }) {
    // Get or create stats for attacker and target
    const attackerStats = await this.avatarService.getOrCreateStats(attacker);
    const targetStats = await this.avatarService.getOrCreateStats(defender);

    // D&D style attack roll: d20 + strength modifier
    const strMod = Math.floor((attackerStats.strength - 10) / 2);
    const dexMod = Math.floor((targetStats.dexterity - 10) / 2);
    // Advantage if attacker has advantageNextAttack (e.g., from Hide)
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

  const isCritical = rawRoll === 20; // natural 20 critical

  if (attackRoll >= armorClass) {
      // Damage roll: 1d8 + strength modifier; on crit double the dice (not modifier)
      let damageDice = this.diceService.rollDie(8);
      if (isCritical) damageDice += this.diceService.rollDie(8);
      const damage = Math.max(1, damageDice + strMod);
      // Apply damage as a damage counter (modifier)
      await this.statService.createModifier('damage', damage, { avatarId: defender._id });
      targetStats.isDefending = false; // Reset defense stance
      await this.avatarService.updateAvatarStats(defender, targetStats);

      // Compute current HP: base HP - total damage counters
      const totalDamage = await this.statService.getTotalModifier(defender._id, 'damage');
      const currentHp = targetStats.hp - totalDamage;

      if (currentHp <= 0) {
        const ko = await this.handleKnockout({ targetAvatar: defender, damage, attacker });
        if (isCritical) ko.critical = true; // propagate critical flag for death videos
        // Encounter integration
        try {
          const ces = _services?.combatEncounterService;
          if (ces) {
            const encounter = ces.getEncounter(_message?.channel?.id);
            if (encounter) ces.handleAttackResult(encounter, { attackerId: attacker.id || attacker._id, defenderId: defender.id || defender._id, result: { ...ko, damage } });
          }
        } catch (e) { this.logger.warn?.(`[BattleService] encounter knockout hook failed: ${e.message}`); }
        return ko;
      }

  const advNote = usedAdvantage ? ' with advantage' : '';
  const baseMsg = `-# ⚔️ [ ${attacker.name} hits ${defender.name}${advNote} for ${damage} damage! (${attackRoll} vs AC ${armorClass}) | HP: ${currentHp}/${targetStats.hp} ]`;
      const critMsg = isCritical ? `\n-# 💥 [ Critical hit! A devastating blow lands (nat 20). ]` : '';
      const res = {
        result: 'hit',
        critical: isCritical,
        message: baseMsg + critMsg,
        damage,
        currentHp,
        attackRoll,
        armorClass,
        rawRoll
      };
      try {
        const ces = _services?.combatEncounterService;
        if (ces) {
          const encounter = ces.getEncounter(_message?.channel?.id);
          if (encounter) ces.handleAttackResult(encounter, { attackerId: attacker.id || attacker._id, defenderId: defender.id || defender._id, result: res });
        }
      } catch (e) { this.logger.warn?.(`[BattleService] encounter hit hook failed: ${e.message}`); }
      // If attacker had advantageNextAttack, consume it and reveal (no longer hidden)
      if (usedAdvantage) {
        try {
          attackerStats.advantageNextAttack = false;
          attackerStats.isHidden = false;
          await this.avatarService.updateAvatarStats(attacker, attackerStats);
        } catch {}
      }
      return res;
    } else {
      targetStats.isDefending = false; // Reset defense stance on miss
      await this.avatarService.updateAvatarStats(defender, targetStats);
      const res = {
        result: 'miss',
        message: `-# 🛡️ [ ${attacker.name}'s attack misses ${defender.name}! (${attackRoll} vs AC ${armorClass}) ]`,
        attackRoll,
        armorClass,
        rawRoll
      };
      // Consume advantage even on a miss if it was used (RAW: advantage is consumed by the roll)
      if (usedAdvantage) {
        try {
          attackerStats.advantageNextAttack = false;
          attackerStats.isHidden = false;
          await this.avatarService.updateAvatarStats(attacker, attackerStats);
        } catch {}
      }
      try {
        const ces = _services?.combatEncounterService;
        if (ces) {
          const encounter = ces.getEncounter(_message?.channel?.id);
          if (encounter) ces.handleAttackResult(encounter, { attackerId: attacker.id || attacker._id, defenderId: defender.id || defender._id, result: res });
        }
      } catch (e) { this.logger.warn?.(`[BattleService] encounter miss hook failed: ${e.message}`); }
      return res;
    }
  }

  async handleKnockout({ message: _message, targetAvatar, damage, attacker, services: _services }) {
    targetAvatar.lives = (targetAvatar.lives || 3) - 1;
    if (targetAvatar.lives <= 0) {
      targetAvatar.status = 'dead';
      targetAvatar.deathTimestamp = Date.now();
      await this.avatarService.updateAvatar(targetAvatar);
      return {
        result: 'dead',
        message: `-# 💀 [ ${attacker.name} has dealt the final blow! ${targetAvatar.name} has fallen permanently! ☠️ ]`
      };
    }
    // Remove all damage counters (healing to full) on knockout
    const db = await this.databaseService.getDatabase();
    await db.collection('dungeon_modifiers').deleteMany({ avatarId: targetAvatar._id, stat: 'damage' });
    // Reset stats upon knockout
    const newStats = this.statService.generateStatsFromDate(targetAvatar.createdAt);
    newStats.avatarId = targetAvatar._id;
    await this.avatarService.updateAvatarStats(targetAvatar, newStats);
    await this.avatarService.updateAvatar(targetAvatar);
    return {
      result: 'knockout',
      message: `-# 💥 [ ${attacker.name} knocked out ${targetAvatar.name} for ${damage} damage! ${targetAvatar.lives} lives remaining! 💫 ]`
    };
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
