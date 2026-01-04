/**
 * Non-async container registrations that should remain at module-evaluation time.
 */

import { asClass, asFunction, asValue } from 'awilix';

import { publishEvent } from '../events/envelope.mjs';
import { CombatNarrativeService } from '../services/combat/CombatNarrativeService.mjs';
import { NftMetadataService } from '../services/nft/nftMetadataService.mjs';
import { PromptAssembler } from '../services/ai/promptAssembler.mjs';

// D&D Services
import { CharacterService } from '../services/dnd/CharacterService.mjs';
import { SpellService } from '../services/dnd/SpellService.mjs';
import { PartyService } from '../services/dnd/PartyService.mjs';
import { DungeonService } from '../services/dnd/DungeonService.mjs';
import { MonsterService } from '../services/dnd/MonsterService.mjs';
import { TutorialQuestService } from '../services/dnd/TutorialQuestService.mjs';
import { QuestService } from '../services/quests/QuestService.mjs';
import { TUTORIAL_QUEST } from '../data/quests/tutorial.mjs';
import { DMNarratorService } from '../services/dnd/DMNarratorService.mjs';
import { DungeonMasterService } from '../services/dnd/DungeonMasterService.mjs';

// Combat target resolution (V3 fix for "Ghost Enemy" bug)
import { CombatTargetRegistry } from '../services/battle/CombatTargetRegistry.mjs';
import { CombatUIService } from '../services/battle/CombatUIService.mjs';

// Entity resolution (V3 unified entity lookup)
import { EntityResolver } from '../services/entities/EntityResolver.mjs';

export function registerPreReady({ container }) {
  container.register({
    eventPublisher: asFunction(() => ({ publishEvent })).singleton(),
  });

  container.register({
    combatNarrativeService: asClass(CombatNarrativeService).singleton(),
  });

  container.register({
    nftMetadataService: asClass(NftMetadataService).singleton(),
  });

  // D&D Services
  container.register({
    characterService: asClass(CharacterService).singleton(),
    spellService: asClass(SpellService).singleton(),
    partyService: asClass(PartyService).singleton(),
    dungeonService: asClass(DungeonService).singleton(),
    monsterService: asClass(MonsterService).singleton(),
    tutorialQuestService: asClass(TutorialQuestService).singleton(),
    dmNarratorService: asClass(DMNarratorService).singleton(),
    dungeonMasterService: asClass(DungeonMasterService).singleton(),
    questService: asFunction(({ databaseService, characterService, partyService, dungeonService, discordService, logger }) => {
      const service = new QuestService({ databaseService, characterService, partyService, dungeonService, discordService, logger });
      // Register built-in quests
      service.registerQuest(TUTORIAL_QUEST);
      return service;
    }).singleton(),
    // Combat target registry (V3 fix for "Ghost Enemy" bug)
    combatTargetRegistry: asClass(CombatTargetRegistry).singleton(),
    // Combat UI service (V3 centralized embed management)
    combatUIService: asClass(CombatUIService).singleton(),
    // Entity resolver (V3 unified entity lookup)
    entityResolver: asClass(EntityResolver).singleton(),
  });

  // Make container itself injectable as 'services' for late-binding/plugin use.
  container.register({ services: asValue(container) });
}

// Historically registered after containerReady is created.
export function registerPostReady({ container }) {
  container.register({
    promptAssembler: asFunction(({ logger, memoryService, configService }) =>
      new PromptAssembler({ logger, memoryService, configService })
    ).singleton(),
  });
}
