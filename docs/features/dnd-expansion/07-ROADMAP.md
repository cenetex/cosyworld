# D&D Expansion: Implementation Roadmap

## Phase 1: Characters (Weeks 1-2)
**Goal**: Basic character creation with classes/races

| Task | Service | Days |
|------|---------|------|
| Create `character_sheets` collection + indexes | DB | 0.5 |
| Define 6 classes, 4 races data | Data files | 1 |
| `CharacterService` - create, getSheet | New | 2 |
| XP/leveling logic | CharacterService | 1 |
| `/character create` wizard | Commands | 2 |
| Character sheet embed | Discord | 1 |

**Deliverable**: Players can create D&D characters.

## Phase 2: Combat Integration (Weeks 3-4)
**Goal**: Class features and spells in existing combat

| Task | Service | Days |
|------|---------|------|
| Add proficiency bonus to attacks | BattleService | 0.5 |
| Define 20 core spells | Data files | 1 |
| `SpellService` - cast, resolve | New | 3 |
| Class features (Second Wind, Sneak Attack, etc.) | CharacterService | 2 |
| Rest mechanics (restore slots/features) | CharacterService | 1 |
| Combat UI buttons for spells | Discord | 2 |

**Deliverable**: Full spellcasting in combat.

## Phase 3: Dungeons (Weeks 5-6)
**Goal**: Procedural dungeon runs

| Task | Service | Days |
|------|---------|------|
| Create `dungeons` collection | DB | 0.5 |
| Define 20 monsters | Data files | 1 |
| `DungeonService` - generate, room flow | New | 3 |
| Discord thread management | DungeonService | 1 |
| Room encounters → CombatEncounterService | Integration | 1 |
| Treasure/loot generation | ItemService | 1 |
| `/dungeon` commands | Commands | 1 |

**Deliverable**: Parties can run dungeons.

## Phase 4: Parties (Week 7)
**Goal**: Group play support

| Task | Service | Days |
|------|---------|------|
| Create `parties` collection | DB | 0.5 |
| `PartyService` - create, invite, leave | New | 2 |
| XP distribution | PartyService | 0.5 |
| Loot roll system (Need/Greed) | PartyService | 1.5 |
| `/party` commands | Commands | 1 |

**Deliverable**: Multiplayer coordination.

## Phase 5: Campaigns (Week 8)
**Goal**: Persistent long-form play

| Task | Service | Days |
|------|---------|------|
| Create `campaigns` collection | DB | 0.5 |
| `CampaignService` - create, progress | New | 2 |
| World state tracking | CampaignService | 1 |
| Session summary generation | AI integration | 1.5 |
| `/campaign`, `/session` commands | Commands | 1 |

**Deliverable**: Multi-session campaigns.

## Dependency Graph

```
Phase 1 (Characters)
    │
    ├──▶ Phase 2 (Combat)
    │         │
    │         ▼
    │    Phase 3 (Dungeons)
    │         │
    └────┬────┘
         │
         ▼
    Phase 4 (Parties)
         │
         ▼
    Phase 5 (Campaigns)
```

## Quick Wins (Start Immediately)

1. **`/roll` command** - 2 hours, no dependencies
2. **Class/race/monster data files** - 1 day, no code
3. **Character sheet embed** - 4 hours, display only

## Effort Summary

| Phase | Weeks | Effort |
|-------|-------|--------|
| 1. Characters | 2 | ~8 days |
| 2. Combat | 2 | ~10 days |
| 3. Dungeons | 2 | ~8 days |
| 4. Parties | 1 | ~5 days |
| 5. Campaigns | 1 | ~6 days |
| **Total** | **8** | **~37 days** |

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Combat too slow | Max 3 rounds, accelerate narratively |
| Spell complexity | Start with 20 simple spells |
| Party coordination | Async-friendly design, no time pressure |
| AI costs | Fast models for flavor, cache responses |
