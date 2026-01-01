# D&D Expansion: Discord Commands

## Slash Commands (Phase 1)

### Character
| Command | Options | Description |
|---------|---------|-------------|
| `/character create` | - | Start creation wizard |
| `/character sheet` | `@avatar` (optional) | Show character sheet |
| `/character rest` | `short\|long` | Take a rest |

### Combat
| Command | Options | Description |
|---------|---------|-------------|
| `/attack` | `@target` | Weapon attack |
| `/cast` | `spell`, `@target`, `slot` | Cast spell |
| `/defend` | - | Defensive stance |

### Party
| Command | Options | Description |
|---------|---------|-------------|
| `/party create` | `name` | Create party |
| `/party invite` | `@avatar` | Invite member |
| `/party leave` | - | Leave party |
| `/party list` | - | Show members |

### Dungeon
| Command | Options | Description |
|---------|---------|-------------|
| `/dungeon enter` | `name` | Start dungeon |
| `/dungeon map` | - | Show explored rooms |

### Utility
| Command | Options | Description |
|---------|---------|-------------|
| `/roll` | `dice` | Roll dice (2d6+3) |
| `/inventory` | - | Show items |

## Button Layouts

### Combat Turn
```
[⚔️ Attack] [🛡️ Defend] [🪄 Cast] [🎒 Item] [🏃 Flee]
```

### Spell Selection
```
Cantrips: [🔥 Fire Bolt] [✨ Sacred Flame]
Level 1 (2/2): [🎯 Magic Missile] [🛡️ Shield]
Level 2 (1/1): [💨 Misty Step]
[❌ Cancel]
```

### Target Selection
```
[🐉 Dragon (89 HP)] [🧟 Zombie 1 (12 HP)] [🧟 Zombie 2 (22 HP)]
[❌ Cancel]
```

### Loot Roll
```
[🎲 Need] [💰 Greed] [❌ Pass]
Timer: 30s remaining
```

### Dungeon Navigation
```
[⬆️ North - ⚔️ Combat] [➡️ East - 💰 Treasure]
[⬅️ West - 🧩 Puzzle]
```

## Embeds

### Character Sheet
```
╔═══════════════════════════════════╗
║ 🧙 GANDALF                        ║
║ Level 5 Human Wizard              ║
╠═══════════════════════════════════╣
║ HP: ████████░░ 28/35   AC: 12     ║
║ XP: 6500/14000  Prof: +3          ║
╠═══════════════════════════════════╣
║ STR 10 (+0)  INT 18 (+4)          ║
║ DEX 14 (+2)  WIS 14 (+2)          ║
║ CON 12 (+1)  CHA 10 (+0)          ║
╠═══════════════════════════════════╣
║ Spell Slots                       ║
║ 1st: ⚡⚡⚡⚡  2nd: ⚡⚡⚡  3rd: ⚡⚡    ║
╚═══════════════════════════════════╝
```

### Combat Status
```
═══ ROUND 2 ═══
🎯 Current: Dwarf Fighter

PARTY
⛏️ Fighter  ██████████ 45/45
🧙 Wizard   ██████░░░░ 21/35
🗡️ Rogue    ████████░░ 32/40

ENEMIES  
🐉 Dragon   ████████░░ 120/150
  [🔥 Burning 2 rounds]
```

### Dungeon Map
```
┌───┬───┬───┐
│ ✅│ ⚔️│ ? │
├───┼───┼───┤
│ 💀│ 📍│ ? │
└───┴───┴───┘
📍 = Current  ✅ = Cleared
? = Unexplored
```

## Reaction Shortcuts

| Emoji | Action |
|-------|--------|
| ⚔️ | Quick attack current target |
| 🛡️ | Defend |
| 🎲 | Roll initiative |
| ✅ | Confirm action |
| ❌ | Cancel/pass |
