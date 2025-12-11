/**
 * Non-async container registrations that should remain at module-evaluation time.
 */

import { asClass, asFunction, asValue } from 'awilix';

import { publishEvent } from '../events/envelope.mjs';
import { CombatNarrativeService } from '../services/combat/CombatNarrativeService.mjs';
import { NftMetadataService } from '../services/nft/nftMetadataService.mjs';
import { PromptAssembler } from '../services/ai/promptAssembler.mjs';

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
