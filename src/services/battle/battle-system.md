# Battle System

## Architecture Overview (as of November 28, 2025)

The battle system follows a modular architecture with clear separation of concerns:

### Core Services

| Service | Responsibility |
|---------|---------------|
| **BattleService** | Core mechanics (attack, defend, knockout, hide) |
| **CombatEncounterService** | Turn management, initiative, encounter lifecycle |
| **CombatAIService** | AI-driven action selection and dialogue generation |
| **CombatMessagingService** | Discord messaging, embeds, webhooks |
| **StatusEffectService** | Buffs, debuffs, conditions |
| **DiceService** | Cryptographically secure dice rolling |
| **StatService** | Immutable stats with zodiac-based generation |

### New Modular Services (November 2025)

#### CombatAIService

Handles all AI-driven combat decisions:

- **Personality-based action selection** - Aggressive, Tactical, Defensive, Berserker, Balanced
- **Smart target selection** - Focus low HP targets, threat assessment
- **Dialogue generation** - In-character combat one-liners
- **Pre-combat taunts** - Challenge dialogue before fights
- **Commentary** - Reactions between actions

```javascript
// Personality profiles control AI behavior
const PERSONALITY_PROFILES = {
  aggressive: {
    defendThreshold: 0.15,    // Only defend when very low HP
    focusLowHpTarget: false,  // Attack randomly
    fleeThreshold: 0.05       // Almost never flee
  },
  tactical: {
    defendThreshold: 0.35,    // Defend at moderate HP
    focusLowHpTarget: true,   // Target weakest enemy
    fleeThreshold: 0.2        // Flee when outmatched
  }
  // ... more profiles
};
```

#### StatusEffectService

Comprehensive status effect system:

**Positive Effects (Buffs):**
- ✨ Blessed: +1 attack/AC
- ⚡ Hasted: Extra action, +2 AC
- 🛡️ Shielded: +4 AC, damage reduction
- 💚 Regenerating: 2 HP/turn healing
- 🫥 Hidden: Advantage on next attack
- 😤 Enraged: +3 damage, -2 AC

**Negative Effects (Debuffs):**
- 🤢 Poisoned: 2 damage/turn, -2 attacks
- 🔥 Burning: 3 damage/turn (stackable)
- 🥶 Frozen: -2 AC, cannot flee
- 😵 Stunned: Skip turn
- 😨 Frightened: -2 attacks, flee bonus
- 🙈 Blinded: Disadvantage, attackers have advantage

**Conditions:**
- 🤼 Grappled: Cannot move, -1 attacks
- ⬇️ Prone: Melee advantage, ranged disadvantage
- ⛓️ Restrained: Cannot move, attackers have advantage
- 💤 Unconscious: Incapacitated, auto-critical hits

```javascript
// Apply status effects
combatEncounterService.applyStatusEffect(
  channelId,
  targetAvatarId,
  'poisoned',
  attackerAvatarId,
  { duration: 3 }
);

// Check effects
if (combatEncounterService.hasStatusEffect(channelId, avatarId, 'stunned')) {
  // Skip turn
}
```

#### CombatMessagingService

Centralized Discord messaging:

- Turn announcements
- Attack/defend action results
- Knockout/death notifications
- Initiative order embeds
- Combat summary with video button
- HP status bars
- Webhook posting for avatar dialogue

---

## Combat Flow

```
1. Attack/Challenge initiated
   └─> CombatEncounterService.ensureEncounterForAttack()

2. Initiative rolled (d20 + DEX mod)
   └─> Sorted highest to lowest

3. Pre-combat dialogue
   └─> CombatAIService.generatePreCombatDialogue()

4. For each turn:
   a. Process status effects (DoT, HoT, expired)
      └─> StatusEffectService.processTurnStart()
   
   b. Check skip conditions (stunned, etc.)
   
   c. AI selects action
      └─> CombatAIService.selectCombatAction()
   
   d. Execute action
      └─> BattleService.attack() / defend()
   
   e. Generate dialogue
      └─> CombatAIService.generateCombatDialogue()
   
   f. Post to Discord
      └─> CombatMessagingService.postCombatAction()
   
   g. Check end conditions
   
   h. Advance to next turn

5. Combat ends
   └─> CombatMessagingService.postCombatSummary()
```

---

## Stat Modifiers & Damage Counters

CosyWorld uses an immutable stat system. Base stats are never changed after creation. All effects are tracked as **modifiers** (counters).

### How It Works
- **Attacks**: Add `damage` counters to the target
- **Healing**: Removes damage counters
- **Current HP**: `currentHp = baseHp - totalDamageCounters`
- **Status Effects**: Apply attack/AC/damage modifiers per effect

### Example: Attack with Status Effects
```javascript
// Get total attack modifier from status effects
const attackMod = statusEffectService.getAttackModifier(combatant);
const acMod = statusEffectService.getACModifier(defender);

// Calculate attack roll with modifiers
const attackRoll = diceRoll + strMod + attackMod;
const armorClass = baseAC + dexMod + acMod;

// Apply damage reduction from effects
const damageReduction = statusEffectService.getDamageReduction(defender);
const finalDamage = Math.max(1, baseDamage - damageReduction);
```

---

## Configuration

Environment variables for tuning:

```bash
# Turn Management
COMBAT_TURN_TIMEOUT_MS=30000      # Turn timeout
COMBAT_MIN_TURN_GAP_MS=4000       # Minimum time between turns
COMBAT_ROUND_COOLDOWN_MS=3000     # Pause between rounds
COMBAT_MAX_ROUNDS=3               # Maximum rounds before auto-end

# Encounter Management
MAX_ENCOUNTERS_PER_GUILD=5        # Max concurrent encounters per guild
COMBAT_STALE_ENCOUNTER_MS=3600000 # Auto-cleanup after 1 hour

# Rate Limiting
COMBAT_MAX_ACTIONS_PER_MINUTE=10  # Rate limit per avatar
COMBAT_RATE_LIMITING_ENABLED=true

# Commentary
COMBAT_COMMENTARY_ENABLED=true
COMBAT_COMMENTARY_CHANCE=0.65     # 65% chance for inter-turn commentary

# Features
COMBAT_EVENT_DRIVEN=false         # Use event-driven turn advancement
COMBAT_ROUND_PLANNING_ENABLED=true
```

---

## Battle Recap Videos

After combat ends, videos can be generated:

- **On-demand generation** via button click
- **Veo 3.1** for video generation
- **LLM scene descriptions** based on combat log
- **Automatic Discord posting**
- **Social media events** emitted for cross-posting

---

## Tools

Combat actions are exposed via tools:

| Tool | Description |
|------|-------------|
| **AttackTool** (`🗡️`) | Explicit attack against target |
| **DefendTool** (`🛡️`) | Take defensive stance (+2 AC) |
| **FleeTool** (`🏃`) | Attempt to escape combat |
| **HideTool** (`🫥`) | Stealth for advantage |

---

## Future Improvements

1. **Equipment Integration** - Weapons affect damage dice and bonuses
2. **Special Abilities** - Character-specific combat actions
3. **Team Combat** - Multi-party battles with allies
4. **Item Usage** - Consume potions/scrolls in combat
5. **Concentration** - Spell/ability maintenance with saves

---

_Last updated: November 28, 2025_
