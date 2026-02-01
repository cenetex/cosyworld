/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

// BattleService.mjs
// Centralizes all combat mechanics (attack, defend, knockout, etc.)
import { publishEvent as basePublishEvent } from '../../events/envelope.mjs';

/**
 * Battle system constants for consistency with CombatEncounterService
 */
const BATTLE_CONSTANTS = {
  DEFAULT_AC: 10,
  DEFAULT_DEX: 10,
  DEFEND_AC_BONUS: 2,
  KNOCKOUT_COOLDOWN_MS: 24 * 60 * 60 * 1000, // 24 hours
  BASE_ABILITY_SCORE: 10,
  ABILITY_MOD_DIVISOR: 2,
  DEFAULT_DAMAGE_DICE: 8, // 1d8 fallback when no weapon equipped
};

export class BattleService  {
  constructor({
    avatarService,
    logger,
    databaseService,
    statService,
    healthService,
    mapService,
    diceService,
    eventPublisher,
    characterService,
    combatEquipmentService
  }) {
    this.logger = logger || console;
    this.databaseService = databaseService;
    this.avatarService = avatarService;
    this.statService = statService;
    this.healthService = healthService || null;
    this.mapService = mapService;
    this.diceService = diceService;
    this.eventPublisher = eventPublisher; // optional injection (publishEvent wrapper)
    // D&D Integration: CharacterService for proficiency/class features
    this.characterService = characterService || null;
    // D&D Integration: CombatEquipmentService for weapon/armor stats
    this.combatEquipmentService = combatEquipmentService || null;
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

  /**
   * Calculate ability modifier from ability score
   * @param {number} score - Ability score (typically 8-20)
   * @returns {number} Modifier
   */
  _abilityMod(score) {
    return Math.floor(((score || BATTLE_CONSTANTS.BASE_ABILITY_SCORE) - BATTLE_CONSTANTS.BASE_ABILITY_SCORE) / BATTLE_CONSTANTS.ABILITY_MOD_DIVISOR);
  }

  /**
   * Check if a character is proficient with a weapon type
   * @param {Object} sheet - Character sheet from CharacterService
   * @param {Object} weapon - Weapon object from CombatEquipmentService
   * @returns {boolean}
   */
  _checkWeaponProficiency(sheet, weapon) {
    if (!sheet || !weapon) return false;
    const weaponProfs = sheet.proficiencies?.weapons || [];
    const weaponType = weapon.weaponType || weapon.type || 'simple';
    
    // Check for exact match (e.g., 'longsword'), category match (e.g., 'martial'), or universal proficiency
    return weaponProfs.includes(weaponType) || 
           weaponProfs.includes('martial') || 
           weaponProfs.includes('simple') ||
           weaponProfs.includes('all');
  }

  /**
   * Check if a character is proficient with an armor type
   * @param {Object} sheet - Character sheet from CharacterService
   * @param {Object} armor - Armor object from CombatEquipmentService
   * @returns {boolean}
   */
  _checkArmorProficiency(sheet, armor) {
    if (!sheet || !armor) return true; // No armor = always proficient
    const armorProfs = sheet.proficiencies?.armor || [];
    const armorCategory = armor.category || 'none';
    
    if (armorCategory === 'none') return true;
    return armorProfs.includes(armorCategory) || armorProfs.includes('all');
  }

  /**
   * Get combat bonuses from character sheet, equipment, and stats
   * @param {Object} avatar - Avatar object
   * @param {Object} stats - Avatar stats
   * @returns {Promise<Object>} Combat bonuses
   */
  async _getCombatBonuses(avatar, stats) {
    const result = {
      proficiencyBonus: 0,
      isProficientWithWeapon: false,
      weapon: null,
      armor: null,
      attackAbility: 'strength',
      attackMod: 0,
      damageBonus: 0,
      armorClass: BATTLE_CONSTANTS.DEFAULT_AC,
      sheet: null
    };

    // Try to get character sheet for proficiency bonus
    try {
      if (this.characterService) {
        const sheet = await this.characterService.getSheet(avatar._id || avatar.id);
        if (sheet) {
          result.sheet = sheet;
          result.proficiencyBonus = sheet.proficiencyBonus || 2;
        }
      }
    } catch (e) {
      this.logger?.debug?.(`[BattleService] No character sheet for ${avatar?.name}: ${e.message}`);
    }

    // Try to get equipped weapon
    try {
      if (this.combatEquipmentService) {
        result.weapon = await this.combatEquipmentService.getEquippedWeapon(avatar);
        if (result.weapon) {
          result.isProficientWithWeapon = this._checkWeaponProficiency(result.sheet, result.weapon);
          result.attackAbility = result.weapon.statBonus || 'strength';
          result.damageBonus = result.weapon.damageBonus || 0;
        }
      }
    } catch (e) {
      this.logger?.debug?.(`[BattleService] Could not get weapon for ${avatar?.name}: ${e.message}`);
    }

    // Calculate attack modifier
    const abilityScore = stats?.[result.attackAbility] || BATTLE_CONSTANTS.BASE_ABILITY_SCORE;
    result.attackMod = this._abilityMod(abilityScore);
    
    // Add proficiency if proficient with weapon
    if (result.isProficientWithWeapon) {
      result.attackMod += result.proficiencyBonus;
    }

    // Add weapon's magic attack bonus
    if (result.weapon?.attackBonus) {
      result.attackMod += result.weapon.attackBonus;
    }

    return result;
  }

  /**
   * Calculate AC for a defender including armor and bonuses
   * @param {Object} avatar - Defender avatar
   * @param {Object} stats - Defender stats
   * @param {boolean} isDefending - Whether they are in defensive stance
   * @returns {Promise<number>} Armor Class
   */
  async _calculateDefenderAC(avatar, stats, isDefending = false) {
    const dexMod = this._abilityMod(stats?.dexterity);
    let ac = BATTLE_CONSTANTS.DEFAULT_AC + dexMod;

    // Try to get equipped armor
    try {
      if (this.combatEquipmentService) {
        const armor = await this.combatEquipmentService.getEquippedArmor(avatar);
        if (armor) {
          ac = this.combatEquipmentService.calculateAC(armor, stats);
        }
      }
    } catch (e) {
      this.logger?.debug?.(`[BattleService] Could not get armor for ${avatar?.name}: ${e.message}`);
    }

    // Add defensive stance bonus
    if (isDefending) {
      ac += BATTLE_CONSTANTS.DEFEND_AC_BONUS;
    }

    return ac;
  }

  /**
   * Roll weapon damage
   * @param {Object} weapon - Weapon object (or null for unarmed)
   * @param {Object} stats - Attacker stats
   * @param {boolean} isCritical - Whether this is a critical hit
   * @returns {number} Total damage
   */
  _rollWeaponDamage(weapon, stats, isCritical = false) {
    // Use equipment service if available
    if (this.combatEquipmentService && weapon) {
      return this.combatEquipmentService.rollWeaponDamage(weapon, stats, isCritical);
    }

    // Fallback to default 1d8 + STR mod
    const strMod = this._abilityMod(stats?.strength);
    let damage = this.diceService.rollDie(BATTLE_CONSTANTS.DEFAULT_DAMAGE_DICE);
    if (isCritical) {
      damage += this.diceService.rollDie(BATTLE_CONSTANTS.DEFAULT_DAMAGE_DICE);
    }
    return Math.max(1, damage + strMod);
  }

  async attack({ message: _message, attacker, defender, defenderIsDefending = null, services: _services }) {
    const publish = this._publish;
    const channelId = _message?.channel?.id;
    const corrId = _message?.id || null;
    
    // Block attacks from KO'd or dead avatars
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

    // D&D Integration: Get combat bonuses (proficiency, weapon, etc.)
    const attackerBonuses = await this._getCombatBonuses(attacker, attackerStats);
    // Use encounter's isDefending state if provided, otherwise fall back to stats
    const isDefending = defenderIsDefending !== null ? defenderIsDefending : targetStats.isDefending;
    const armorClass = await this._calculateDefenderAC(defender, targetStats, isDefending);

    // Roll d20 for attack (with advantage if applicable)
    const rollOnce = () => this.diceService.rollDie(20);
    let raw1 = rollOnce();
    let raw2 = null;
    let usedAdvantage = false;
    if (attackerStats.advantageNextAttack) {
      raw2 = rollOnce();
      usedAdvantage = true;
    }
    const rawRoll = raw2 ? Math.max(raw1, raw2) : raw1;
    
    // D&D Integration: Attack roll = d20 + ability mod + proficiency (if proficient)
    const attackRoll = rawRoll + attackerBonuses.attackMod;
    
    // Build detailed attack info for logging
    const weaponName = attackerBonuses.weapon?.name || 'Unarmed';
    
    publish?.({ 
      type: 'combat.attack.attempt', 
      source: 'BattleService', 
      corrId, 
      payload: { 
        attackerId: attacker._id || attacker.id, 
        defenderId: defender._id || defender.id, 
        rawRoll, 
        attackRoll, 
        armorClass, 
        advantageUsed: usedAdvantage,
        proficiencyBonus: attackerBonuses.proficiencyBonus,
        isProficient: attackerBonuses.isProficientWithWeapon,
        weapon: weaponName,
        channelId 
      } 
    });

    const isCritical = rawRoll === 20;

    if (attackRoll >= armorClass) {
      // D&D Integration: Use weapon damage dice instead of hardcoded 1d8
      const damage = this._rollWeaponDamage(attackerBonuses.weapon, attackerStats, isCritical);
      
      let currentHp = null;
      let maxHp = targetStats.hp;
      if (this.healthService) {
        const state = await this.healthService.applyDamage(defender, damage, { source: 'battle:attack' });
        currentHp = state?.currentHp ?? null;
        maxHp = state?.maxHp ?? maxHp;
        if (!Number.isFinite(currentHp)) {
          const totalDamage = await this.statService.getTotalModifier(defender._id, 'damage');
          currentHp = targetStats.hp - totalDamage;
        }
      } else {
        await this.statService.createModifier('damage', damage, { avatarId: defender._id });
        const totalDamage = await this.statService.getTotalModifier(defender._id, 'damage');
        currentHp = targetStats.hp - totalDamage;
      }

      targetStats.isDefending = false;
      await this.avatarService.updateAvatarStats(defender, targetStats);

      if (Number.isFinite(currentHp) && currentHp <= 0) {
        const ko = await this.handleKnockout({ message: _message, targetAvatar: defender, damage, attacker, services: _services, corrId });
        publish?.({ type: ko.result === 'dead' ? 'combat.death' : 'combat.knockout', source: 'BattleService', corrId, payload: { attackerId: attacker._id || attacker.id, defenderId: defender._id || defender.id, damage, livesRemaining: defender.lives, critical: isCritical, channelId } });
        return ko;
      }

      // Build detailed hit message
      const advNote = usedAdvantage ? ' with advantage' : '';
      const modBreakdown = attackerBonuses.isProficientWithWeapon 
        ? `${rawRoll}+${this._abilityMod(attackerStats[attackerBonuses.attackAbility])}+${attackerBonuses.proficiencyBonus}` 
        : `${rawRoll}+${attackerBonuses.attackMod}`;
      const hpMaxDisplay = Number.isFinite(maxHp) ? maxHp : targetStats.hp;
      const hpCurrentDisplay = Number.isFinite(currentHp) ? currentHp : '?';
      const baseMsg = `-# ⚔️ [ ${attacker.name} hits ${defender.name}${advNote} with ${weaponName} for ${damage} damage! (${modBreakdown}=${attackRoll} vs AC ${armorClass}) | HP: ${hpCurrentDisplay}/${hpMaxDisplay} ]`;
      const critMsg = isCritical ? `\n-# 💥 [ Critical hit! A devastating blow lands (nat 20). ]` : '';
      const res = { result: 'hit', critical: isCritical, message: baseMsg + critMsg, damage, currentHp, attackRoll, armorClass, rawRoll, weapon: weaponName };
      this.logger?.info?.(`[BattleService] Hit: ${attacker.name} → ${defender.name} atk=${attackRoll} vs AC ${armorClass} dmg=${damage} weapon=${weaponName}${isCritical ? ' CRIT' : ''}`);
      publish?.({ type: 'combat.attack.hit', source: 'BattleService', corrId, payload: { attackerId: attacker._id || attacker.id, defenderId: defender._id || defender.id, damage, critical: isCritical, attackRoll, armorClass, currentHp, rawRoll, weapon: weaponName, channelId } });
      if (usedAdvantage) {
        try { attackerStats.advantageNextAttack = false; attackerStats.isHidden = false; await this.avatarService.updateAvatarStats(attacker, attackerStats); } catch {}
      }
      return res;
    } else {
      targetStats.isDefending = false;
      await this.avatarService.updateAvatarStats(defender, targetStats);
      const res = { result: 'miss', message: `-# 🛡️ [ ${attacker.name}'s ${weaponName} attack misses ${defender.name}! (${attackRoll} vs AC ${armorClass}) ]`, attackRoll, armorClass, rawRoll, weapon: weaponName };
      this.logger?.info?.(`[BattleService] Miss: ${attacker.name} → ${defender.name} atk=${attackRoll} vs AC ${armorClass} weapon=${weaponName}`);
      publish?.({ type: 'combat.attack.miss', source: 'BattleService', corrId, payload: { attackerId: attacker._id || attacker.id, defenderId: defender._id || defender.id, attackRoll, armorClass, rawRoll, weapon: weaponName, channelId } });
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
    targetAvatar.knockedOutUntil = now + BATTLE_CONSTANTS.KNOCKOUT_COOLDOWN_MS;
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
    let highestPassive = BATTLE_CONSTANTS.DEFAULT_AC;
    for (const o of others) {
      try {
        const os = await this.avatarService.getOrCreateStats(o);
        const wisMod = Math.floor(((os.wisdom || BATTLE_CONSTANTS.BASE_ABILITY_SCORE) - BATTLE_CONSTANTS.BASE_ABILITY_SCORE) / BATTLE_CONSTANTS.ABILITY_MOD_DIVISOR);
        highestPassive = Math.max(highestPassive, BATTLE_CONSTANTS.DEFAULT_AC + wisMod);
      } catch {}
    }

    const dexMod = Math.floor(((stats.dexterity || BATTLE_CONSTANTS.BASE_ABILITY_SCORE) - BATTLE_CONSTANTS.BASE_ABILITY_SCORE) / BATTLE_CONSTANTS.ABILITY_MOD_DIVISOR);
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
