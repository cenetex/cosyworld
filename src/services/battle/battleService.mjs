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
    const rawRoll = this.diceService.rollDie(20);
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
        return ko;
      }

      const baseMsg = `-# ⚔️ [ ${attacker.name} hits ${defender.name} for ${damage} damage! (${attackRoll} vs AC ${armorClass}) | HP: ${currentHp}/${targetStats.hp} ]`;
      const critMsg = isCritical ? `\n-# 💥 [ Critical hit! A devastating blow lands (nat 20). ]` : '';
      return {
        result: 'hit',
        critical: isCritical,
        message: baseMsg + critMsg,
        damage,
        currentHp,
        attackRoll,
        armorClass,
        rawRoll
      };
    } else {
      targetStats.isDefending = false; // Reset defense stance on miss
      await this.avatarService.updateAvatarStats(defender, targetStats);
      return {
        result: 'miss',
        message: `-# 🛡️ [ ${attacker.name}'s attack misses ${defender.name}! (${attackRoll} vs AC ${armorClass}) ]`,
        attackRoll,
        armorClass,
        rawRoll
      };
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
}
