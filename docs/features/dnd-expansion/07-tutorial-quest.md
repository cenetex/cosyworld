# D&D Tutorial Quest System

## Overview

The Tutorial Quest is an interactive onboarding experience that guides new players through all core D&D mechanics. Rather than presenting a wall of text, players learn by doing - completing each step earns XP rewards.

## First-Time Welcome DM

When a player uses **any D&D command for the first time**, they automatically receive a private DM with:
- Quick start guide
- Command reference table
- Class and race summaries
- Link to start the tutorial quest

This message is **only visible to them** and won't spam the channel.

## Command

```
📚 tutorial [start|status|skip|reset]
```

- `start` - Begin the tutorial quest
- `status` - View current progress and next step
- `skip` - Skip the tutorial (quick reference provided)
- `reset` - Restart from the beginning

## Quest Flow

### Step 1: Welcome
- **Title:** Welcome, Adventurer!
- **Trigger:** Say "ready"
- **XP:** 0

### Step 2: Create Character
- **Title:** Choose Your Path
- **Instruction:** `📜 character create <class> <race>`
- **Trigger:** Character creation (automatic)
- **XP:** 50

### Step 3: View Sheet
- **Title:** Know Thyself
- **Instruction:** `📜 character sheet`
- **Trigger:** Sheet view (automatic)
- **XP:** 25

### Step 4: Learn Spells (Optional)
- **Title:** The Art of Magic
- **Instruction:** `🪄 cast` (spellcasters) or "skip" (martial)
- **Trigger:** Spell list view or skip
- **XP:** 25

### Step 5: Form Party
- **Title:** Strength in Numbers
- **Instruction:** `👥 party create <name>` or "solo"
- **Trigger:** Party creation or solo acknowledgment
- **XP:** 25

### Step 6: Enter Dungeon
- **Title:** Into the Depths
- **Instruction:** `🏰 dungeon enter easy`
- **Trigger:** Dungeon generation (automatic)
- **XP:** 50

### Step 7: View Map
- **Title:** Know Your Surroundings
- **Instruction:** `🏰 dungeon map`
- **Trigger:** Map view (automatic)
- **XP:** 25

### Step 8: First Combat
- **Title:** Steel and Spell
- **Instruction:** `🗡️ attack <enemy>` or `🪄 cast <spell> <enemy>`
- **Trigger:** Room cleared (automatic)
- **XP:** 100

### Step 9: Explore
- **Title:** Deeper We Go
- **Instruction:** `🏰 dungeon move <room>` and `🏰 dungeon loot`
- **Trigger:** Movement (automatic)
- **XP:** 50

### Step 10: Complete Dungeon
- **Title:** Victory!
- **Instruction:** Defeat the boss
- **Trigger:** Dungeon complete (automatic)
- **XP:** 200

### Step 11: Rest
- **Title:** Rest and Recovery
- **Instruction:** `📜 character rest long`
- **Trigger:** Rest taken (automatic)
- **XP:** 25

## Total XP: 575

## Completion Rewards

- **XP:** 575 total
- **Title:** "Apprentice Adventurer"
- Unlock guidance for medium difficulty dungeons

## Technical Implementation

### Database Collection
```javascript
tutorial_progress: {
  avatarId: ObjectId,      // Unique index
  currentStep: Number,
  completedSteps: [String],
  totalXpEarned: Number,
  startedAt: Date,
  completedAt: Date,
  skipped: Boolean
}
```

### Auto-Advancement
The tutorial automatically advances when players complete actions:
- **CharacterTool:** Triggers `character_created`, `sheet_viewed`, `rested`
- **PartyTool:** Triggers `party_ready`
- **DungeonTool:** Triggers `dungeon_entered`, `map_viewed`, `room_cleared`, `explored`, `dungeon_complete`
- **CastTool:** Triggers `spells_checked`

### Progress Display
```
**Progress:** [████████░░] 80% (8/10 steps)

📖 **Tutorial (8/10)**
## First Combat
Enemies block your path! Use attacks or spells to defeat them.

**What to do:**
Fight the enemies in this room:
🗡️ `attack <enemy>` or 🪄 `cast <spell> <enemy>`

*XP earned so far: ⭐ 250*
```

## Quick Reference (for skippers)

Players who skip receive a condensed command reference:

```
📜 character create <class> <race> - Create character
📜 character sheet - View your stats
👥 party create <name> - Form a party
🏰 dungeon enter <difficulty> - Enter a dungeon
🪄 cast <spell> - Cast spells
🗡️ attack <target> - Attack enemies
```
