# CosyWorld D&D Expansion - Overview (v2)

## Executive Summary

A D&D 5e-inspired expansion leveraging CosyWorld's existing combat infrastructure. Uses **separate collections** for clean data separation and efficient queries.

## What's Already Built

| Feature | Service | Ready |
|---------|---------|-------|
| Initiative (d20 + DEX) | `CombatEncounterService` | ✅ |
| Turn-based combat | `CombatEncounterService` | ✅ |
| 6 ability scores | `StatService` | ✅ |
| Secure dice rolls | `DiceService` | ✅ |
| Status effects (15+) | `StatusEffectService` | ✅ |
| Weapons/armor | `CombatEquipmentService` | ✅ |
| AI combat behavior | `CombatAIService` | ✅ |
| Story generation | `NarrativeGeneratorService` | ✅ |

## New Collections

| Collection | Purpose |
|------------|---------|
| `character_sheets` | Class, race, level, spells |
| `parties` | Group membership, shared loot |
| `dungeons` | Procedural room state |
| `campaigns` | Long-form save states |
| `spells` | Spell definitions (static data) |
| `monsters` | Monster stat blocks (static data) |

## Architecture

```
┌─────────────────────────────────────────┐
│         NEW D&D SERVICES                │
│  CharacterService │ SpellService        │
│  PartyService     │ DungeonService      │
│  CampaignService  │ MonsterService      │
└──────────────────┬──────────────────────┘
                   │ extends
┌──────────────────▼──────────────────────┐
│         EXISTING CORE                   │
│  AvatarService │ BattleService          │
│  CombatEncounterService │ ItemService   │
└─────────────────────────────────────────┘
```

## Design Principles

1. **Separate collections** - D&D data doesn't pollute avatars
2. **Simplified 5e** - No reactions, simplified action economy
3. **Discord-first** - Buttons > slash commands where possible
4. **AI narration** - Fast models for flavor, slow for plot

## Documents

| Doc | Content |
|-----|---------|
| [01-DATA-MODEL](./01-DATA-MODEL.md) | All schemas, indexes, relationships |
| [02-CHARACTERS](./02-CHARACTERS.md) | Classes, races, leveling, CharacterService |
| [03-COMBAT](./03-COMBAT.md) | Spells, abilities, SpellService |
| [04-DUNGEONS](./04-DUNGEONS.md) | Procedural generation, DungeonService |
| [05-SOCIAL](./05-SOCIAL.md) | Parties, campaigns, PartyService, CampaignService |
| [06-COMMANDS](./06-COMMANDS.md) | Discord UI, slash commands, embeds |
| [07-ROADMAP](./07-ROADMAP.md) | 8-week phased implementation |

## Quick Reference

### XP Thresholds
```
Level:  1     2     3      4      5       6       7       8
XP:     0   300   900  2,700  6,500  14,000  23,000  34,000
```

### Proficiency Bonus
```
Level 1-4: +2   Level 5-8: +3   Level 9-12: +4   Level 13-16: +5   Level 17-20: +6
```

### Core Classes (Phase 1)
Fighter, Wizard, Rogue, Cleric, Ranger, Bard

### Core Races (Phase 1)
Human, Elf, Dwarf, Halfling

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Combat too slow | Medium | High | Max 3 rounds, AI accelerates |
| Spell complexity | Medium | Medium | Start with 20 spells |
| Party coordination | Low | Medium | Async-friendly design |
| AI costs | Medium | High | Fast models, response caching |

## Total Effort

~37 dev-days across 8 weeks (5 phases)
