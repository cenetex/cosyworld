/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * @file registerDiscoveredServices.mjs
 * @description Explicit service registration replacing the previous dynamic globby scan.
 *
 * Every service that was previously auto-discovered via `globby('./services/**\/*.mjs')`
 * is now explicitly imported and registered here, organized by domain.
 *
 * WHY: The dynamic scan silently registered every class export under src/services/,
 * creating naming-collision hazards (e.g., two files named conversationManager.mjs)
 * and making the dependency graph invisible at review time.
 *
 * ADDING A NEW SERVICE: Import the class and add a registration entry in the
 * appropriate domain section below. The registration name (left side) must be
 * the camelCase version of the class name with the first letter lowercased.
 */

import { asClass } from 'awilix';

// ── AI Services ──────────────────────────────────────────────────────────────
import { AIRouterService } from '../services/ai/aiRouterService.mjs';
import { AvatarOpenAIClient } from '../services/ai/avatarOpenAIClient.mjs';
import { BaseAIService } from '../services/ai/baseAIService.mjs';
import { LyriaService } from '../services/ai/lyriaService.mjs';
import { OllamaService } from '../services/ai/ollamaService.mjs';
import { OpenRouterAIService } from '../services/ai/openrouterAIService.mjs';
import { OpenrouterModelCatalogService } from '../services/ai/openrouterModelCatalogService.mjs';
import { PromptService } from '../services/ai/promptService.mjs';
import { ReplicateService } from '../services/ai/replicateService.mjs';
import { SwarmAIService } from '../services/ai/swarmAIService.mjs';
import { VeoService } from '../services/ai/veoService.mjs';

// ── Avatar & Memory ──────────────────────────────────────────────────────────
import { AvatarService } from '../services/avatar/avatarService.mjs';
import { AvatarLocationMemory } from '../services/avatar/avatarLocationMemory.mjs';
import { AvatarRelationshipService } from '../services/avatar/avatarRelationshipService.mjs';
import { KnowledgeService } from '../services/avatar/knowledgeService.mjs';
import { MemoryService } from '../services/avatar/memoryService.mjs';
import { RatiService } from '../services/avatar/ratiService.mjs';
import { SchemaService } from '../services/avatar/schemaService.mjs';

// ── Battle & Combat ──────────────────────────────────────────────────────────
import { BattleMediaService } from '../services/battle/battleMediaService.mjs';
import { BattleService } from '../services/battle/battleService.mjs';
import { BattleVideoComposer } from '../services/battle/battleVideoComposer.mjs';
import { CombatAIService } from '../services/battle/combatAIService.mjs';
import { CombatEncounterService } from '../services/battle/combatEncounterService.mjs';
import { CombatEquipmentService } from '../services/battle/combatEquipmentService.mjs';
import { CombatLogService } from '../services/battle/combatLogService.mjs';
import { CombatMessagingService } from '../services/battle/combatMessagingService.mjs';
import { DiceService } from '../services/battle/diceService.mjs';
import { StatService } from '../services/battle/statService.mjs';
import { StatusEffectService } from '../services/battle/statusEffectService.mjs';
import { TurnLock } from '../services/battle/TurnLock.mjs';

// ── Chat & Conversation ──────────────────────────────────────────────────────
import { AvatarAgentService } from '../services/chat/avatarAgentService.mjs';
import { BackgroundImageAnalyzer } from '../services/chat/backgroundImageAnalyzer.mjs';
import { ChannelManager } from '../services/chat/channelManager.mjs';
import { ConversationManager } from '../services/chat/conversationManager.mjs';
import { ConversationThreadService } from '../services/chat/conversationThreadService.mjs';
import { DecisionMaker } from '../services/chat/decisionMaker.mjs';
import { EncounterService } from '../services/chat/encounterService.mjs';
import { PresenceService } from '../services/chat/presenceService.mjs';
import { TurnScheduler } from '../services/chat/turnScheduler.mjs';

// ── Agent Services ───────────────────────────────────────────────────────────
import { AgentBlockService } from '../services/agent/agentBlockService.mjs';
import { AgentEventService } from '../services/agent/agentEventService.mjs';

// ── Arweave ──────────────────────────────────────────────────────────────────
import { ArweaveService } from '../services/arweave/arweaveService.mjs';

// ── Consortium ───────────────────────────────────────────────────────────────
import { CCELService } from '../services/consortium/ccel/ccelService.mjs';
import { CommonsService } from '../services/consortium/commons/commonsService.mjs';
import { ConsortiumService } from '../services/consortium/core/consortiumService.mjs';
import { EncodingEvolutionService } from '../services/consortium/evolution/encodingEvolutionService.mjs';
import { ConsortiumStorageService } from '../services/consortium/storage/consortiumStorageService.mjs';

// ── Conversation ─────────────────────────────────────────────────────────────
import { ConversationService } from '../services/conversation/conversationService.mjs';

// ── D&D (non-DI-registered in registrations.mjs are skipped here) ────────────
// CharacterService, SpellService, PartyService, DungeonService, MonsterService,
// TutorialQuestService, DMNarratorService, DungeonMasterService, DndTurnContextService
// are already in registrations.mjs.
import { dmProfileService } from '../services/dnd/dmProfileService.mjs';

// ── Foundation (non-core) ────────────────────────────────────────────────────
import { AuditLogService } from '../services/foundation/auditLogService.mjs';
import { SetupStatusService } from '../services/foundation/setupStatusService.mjs';

// ── Knowledge ────────────────────────────────────────────────────────────────
import { KnowledgeBaseService } from '../services/knowledge/knowledgeBaseService.mjs';

// ── Location ─────────────────────────────────────────────────────────────────
import { LocationService } from '../services/location/locationService.mjs';
import { MapService } from '../services/map/mapService.mjs';

// ── Media ────────────────────────────────────────────────────────────────────
import { GeneratedImageService } from '../services/media/GeneratedImageService.mjs';
import { ImageProcessingService } from '../services/media/imageProcessingService.mjs';
import { UploadService } from '../services/media/uploadService.mjs';

// ── Moderation ───────────────────────────────────────────────────────────────
import { UserModerationService } from '../services/moderation/userModerationService.mjs';

// ── Observability ────────────────────────────────────────────────────────────
import { ObservabilityService } from '../services/observability/observabilityService.mjs';

// ── Oneirocom ────────────────────────────────────────────────────────────────
import { OneirocomForumService } from '../services/oneirocom/OneirocomForumService.mjs';

// ── Planner ──────────────────────────────────────────────────────────────────
import { ActionExecutor } from '../services/planner/actionExecutor.mjs';
import AssignmentQueueService from '../services/planner/assignmentQueueService.mjs';
import DMPlannerService from '../services/planner/dmPlannerService.mjs';
import { PlanExecutionService } from '../services/planner/planExecutionService.mjs';
import StepDependencyAnalyzer from '../services/planner/stepDependencyAnalyzer.mjs';
import SummarizerService from '../services/planner/summarizerService.mjs';
import ThreadStateService from '../services/planner/threadStateService.mjs';

// ── Quest ────────────────────────────────────────────────────────────────────
import { QuestGeneratorService } from '../services/quest/questGeneratorService.mjs';

// ── Queue ────────────────────────────────────────────────────────────────────
import { JobQueueService } from '../services/queue/jobQueueService.mjs';

// ── Reflection ───────────────────────────────────────────────────────────────
import { ReflectionService } from '../services/reflectionService.mjs';

// ── S3 ───────────────────────────────────────────────────────────────────────
import { S3Service } from '../services/s3/s3Service.mjs';

// ── Scheduling ───────────────────────────────────────────────────────────────
import { SchedulingService } from '../services/scheduling/schedulingService.mjs';

// ── Security ─────────────────────────────────────────────────────────────────
import { KeyService } from '../services/security/keyService.mjs';
import { ModerationService } from '../services/security/moderationService.mjs';
import { RiskManagerService } from '../services/security/riskManagerService.mjs';
import { SpamControlService } from '../services/security/spamControlService.mjs';

// ── Social (non-explicit) ────────────────────────────────────────────────────
import { DiscordChannelActivityService } from '../services/social/discordChannelActivityService.mjs';
import { MoltbookClient } from '../services/social/moltbookClient.mjs';
import { MoltbookHeartbeatService } from '../services/social/moltbookHeartbeatService.mjs';
import { MoltbookSwarmMissiveService } from '../services/social/moltbookSwarmMissiveService.mjs';

// ── Story (non-explicit) ────────────────────────────────────────────────────
import { ChannelSummaryService } from '../services/story/channelSummaryService.mjs';
import { StoryPlanService } from '../services/story/storyPlanService.mjs';

// ── Tools ────────────────────────────────────────────────────────────────────
import { CooldownService } from '../services/tools/CooldownService.mjs';
import { ToolPlannerService } from '../services/tools/ToolPlannerService.mjs';
import { ActionLog } from '../services/tools/ActionLog.mjs';
import { BasicTool } from '../services/tools/BasicTool.mjs';
import { AttackTool } from '../services/tools/tools/AttackTool.mjs';
import { BreedTool } from '../services/tools/tools/BreedTool.mjs';
import { CastTool } from '../services/tools/tools/CastTool.mjs';
import { ChallengeTool } from '../services/tools/tools/ChallengeTool.mjs';
import { CharacterTool } from '../services/tools/tools/CharacterTool.mjs';
import { CreationTool } from '../services/tools/tools/CreationTool.mjs';
import { DefendTool } from '../services/tools/tools/DefendTool.mjs';
import { DevilTool } from '../services/tools/tools/DevilTool.mjs';
import { DMTool } from '../services/tools/tools/DMTool.mjs';
import { DungeonTool } from '../services/tools/tools/DungeonTool.mjs';
import { FleeTool } from '../services/tools/tools/FleeTool.mjs';
import { HideTool } from '../services/tools/tools/HideTool.mjs';
import { ItemTool } from '../services/tools/tools/ItemTool.mjs';
import { MoveTool } from '../services/tools/tools/MoveTool.mjs';
import { PartyTool } from '../services/tools/tools/PartyTool.mjs';
import { PotionTool } from '../services/tools/tools/PotionTool.mjs';
import { QuestTool } from '../services/tools/tools/QuestTool.mjs';
import { RememberTool } from '../services/tools/tools/RememberTool.mjs';
import { SceneCameraTool } from '../services/tools/tools/SceneCameraTool.mjs';
import { SelfieTool } from '../services/tools/tools/SelfieTool.mjs';
import { SummonTool } from '../services/tools/tools/SummonTool.mjs';
import { ThinkTool } from '../services/tools/tools/ThinkTool.mjs';
import { TutorialTool } from '../services/tools/tools/TutorialTool.mjs';
import { VideoCameraTool } from '../services/tools/tools/VideoCameraTool.mjs';
import { WebSearchTool } from '../services/tools/tools/WebSearchTool.mjs';
import { WikiTool } from '../services/tools/tools/WikiTool.mjs';
import { XSocialTool } from '../services/tools/tools/XSocialTool.mjs';

// ── User Profile ─────────────────────────────────────────────────────────────
import { UserProfileService } from '../services/userProfileService.mjs';

// ── Video ────────────────────────────────────────────────────────────────────
import VideoJobService from '../services/video/videoJobService.mjs';

/**
 * Register all services that were previously discovered dynamically by globby.
 *
 * Each registration uses `asClass(Cls).singleton()` — identical to the old
 * globby scan behaviour. If a registration name already exists in the
 * container (from core.mjs or registrations.mjs), it is skipped to preserve
 * the same precedence semantics.
 *
 * @param {{ container: import('awilix').AwilixContainer, logger: object }} opts
 */
export function registerDiscoveredServices({ container, logger }) {
  const registrations = {
    // ── AI ───────────────────────────────────────────────────────────────
    aiRouterService: AIRouterService,
    avatarOpenAIClient: AvatarOpenAIClient,
    baseAIService: BaseAIService,
    lyriaService: LyriaService,
    ollamaService: OllamaService,
    openrouterAIService: OpenRouterAIService,
    openrouterModelCatalogService: OpenrouterModelCatalogService,
    promptService: PromptService,
    replicateService: ReplicateService,
    swarmAIService: SwarmAIService,
    veoService: VeoService,

    // ── Avatar & Memory ─────────────────────────────────────────────────
    avatarService: AvatarService,
    avatarLocationMemory: AvatarLocationMemory,
    avatarRelationshipService: AvatarRelationshipService,
    knowledgeService: KnowledgeService,
    memoryService: MemoryService,
    ratiService: RatiService,
    schemaService: SchemaService,

    // ── Battle & Combat ─────────────────────────────────────────────────
    battleMediaService: BattleMediaService,
    battleService: BattleService,
    battleVideoComposer: BattleVideoComposer,
    combatAIService: CombatAIService,
    combatEncounterService: CombatEncounterService,
    combatEquipmentService: CombatEquipmentService,
    combatLogService: CombatLogService,
    combatMessagingService: CombatMessagingService,
    diceService: DiceService,
    statService: StatService,
    statusEffectService: StatusEffectService,
    turnLock: TurnLock,

    // ── Chat & Conversation ─────────────────────────────────────────────
    avatarAgentService: AvatarAgentService,
    backgroundImageAnalyzer: BackgroundImageAnalyzer,
    channelManager: ChannelManager,
    conversationManager: ConversationManager,
    conversationThreadService: ConversationThreadService,
    decisionMaker: DecisionMaker,
    encounterService: EncounterService,
    presenceService: PresenceService,
    turnScheduler: TurnScheduler,

    // ── Agent ────────────────────────────────────────────────────────────
    agentBlockService: AgentBlockService,
    agentEventService: AgentEventService,

    // ── Arweave ──────────────────────────────────────────────────────────
    arweaveService: ArweaveService,

    // ── Consortium ───────────────────────────────────────────────────────
    ccelService: CCELService,
    commonsService: CommonsService,
    consortiumService: ConsortiumService,
    encodingEvolutionService: EncodingEvolutionService,
    consortiumStorageService: ConsortiumStorageService,

    // ── Conversation ─────────────────────────────────────────────────────
    conversationService: ConversationService,

    // ── D&D ──────────────────────────────────────────────────────────────
    dmProfileService: dmProfileService,

    // ── Foundation ───────────────────────────────────────────────────────
    auditLogService: AuditLogService,
    setupStatusService: SetupStatusService,

    // ── Knowledge ────────────────────────────────────────────────────────
    knowledgeBaseService: KnowledgeBaseService,

    // ── Location ─────────────────────────────────────────────────────────
    locationService: LocationService,
    mapService: MapService,

    // ── Media ────────────────────────────────────────────────────────────
    generatedImageService: GeneratedImageService,
    imageProcessingService: ImageProcessingService,
    uploadService: UploadService,

    // ── Moderation ───────────────────────────────────────────────────────
    userModerationService: UserModerationService,

    // ── Observability ────────────────────────────────────────────────────
    observabilityService: ObservabilityService,

    // ── Oneirocom ────────────────────────────────────────────────────────
    oneirocomForumService: OneirocomForumService,

    // ── Planner ──────────────────────────────────────────────────────────
    actionExecutor: ActionExecutor,
    assignmentQueueService: AssignmentQueueService,
    dmPlannerService: DMPlannerService,
    planExecutionService: PlanExecutionService,
    stepDependencyAnalyzer: StepDependencyAnalyzer,
    summarizerService: SummarizerService,
    threadStateService: ThreadStateService,

    // ── Quest ────────────────────────────────────────────────────────────
    questGeneratorService: QuestGeneratorService,

    // ── Queue ────────────────────────────────────────────────────────────
    jobQueueService: JobQueueService,

    // ── Reflection ───────────────────────────────────────────────────────
    reflectionService: ReflectionService,

    // ── S3 ───────────────────────────────────────────────────────────────
    s3Service: S3Service,

    // ── Scheduling ───────────────────────────────────────────────────────
    schedulingService: SchedulingService,

    // ── Security ─────────────────────────────────────────────────────────
    keyService: KeyService,
    moderationService: ModerationService,
    riskManagerService: RiskManagerService,
    spamControlService: SpamControlService,

    // ── Social ───────────────────────────────────────────────────────────
    discordChannelActivityService: DiscordChannelActivityService,
    moltbookClient: MoltbookClient,
    moltbookHeartbeatService: MoltbookHeartbeatService,
    moltbookSwarmMissiveService: MoltbookSwarmMissiveService,

    // ── Story ────────────────────────────────────────────────────────────
    channelSummaryService: ChannelSummaryService,
    storyPlanService: StoryPlanService,

    // ── Tools (framework) ────────────────────────────────────────────────
    cooldownService: CooldownService,
    toolPlannerService: ToolPlannerService,
    actionLog: ActionLog,
    basicTool: BasicTool,

    // ── Tools (concrete) ─────────────────────────────────────────────────
    attackTool: AttackTool,
    breedTool: BreedTool,
    castTool: CastTool,
    challengeTool: ChallengeTool,
    characterTool: CharacterTool,
    creationTool: CreationTool,
    defendTool: DefendTool,
    devilTool: DevilTool,
    dMTool: DMTool,
    dungeonTool: DungeonTool,
    fleeTool: FleeTool,
    hideTool: HideTool,
    itemTool: ItemTool,
    moveTool: MoveTool,
    partyTool: PartyTool,
    potionTool: PotionTool,
    questTool: QuestTool,
    rememberTool: RememberTool,
    sceneCameraTool: SceneCameraTool,
    selfieTool: SelfieTool,
    summonTool: SummonTool,
    thinkTool: ThinkTool,
    tutorialTool: TutorialTool,
    videoCameraTool: VideoCameraTool,
    webSearchTool: WebSearchTool,
    wikiTool: WikiTool,
    xSocialTool: XSocialTool,

    // ── User Profile ─────────────────────────────────────────────────────
    userProfileService: UserProfileService,

    // ── Video ────────────────────────────────────────────────────────────
    videoJobService: VideoJobService,
  };

  let registered = 0;
  let skipped = 0;

  for (const [name, ServiceClass] of Object.entries(registrations)) {
    if (container.registrations[name]) {
      skipped++;
      continue;
    }
    try {
      container.register(name, asClass(ServiceClass).singleton());
      registered++;
    } catch (err) {
      logger.error(`[container] Failed to register ${name}: ${err.message}`);
    }
  }

  logger.info(
    `[container] Explicit service registration: ${registered} registered, ${skipped} skipped (already present)`
  );
}
