/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */



export class ReflectionService {
  constructor({ avatarService, conversationManager, schedulingService, logger }) {
    this.avatarService = avatarService;
    this.conversationManager = conversationManager;
    this.schedulingService = schedulingService;
    this.logger = logger || console;
  }

  initialize() {
    this.logger.info('[ReflectionService] Scheduling generateReflections task');
    this.schedulingService.addTask(
      'generateReflections',
      () => this.generateReflections(),
      5 * 60 * 1000 // every 5 minutes
    );
    // run immediately
    this.generateReflections();
  }

  async generateReflections() {
    try {
      const avatars = (await this.avatarService.getActiveAvatars()).slice(0, 3);
      if (avatars.length === 0) {
        this.logger.info('[ReflectionService] No active avatars for reflections');
        return;
      }
      await Promise.all(
        avatars.map(av => 
          this.conversationManager.generateNarrative(av).catch(err =>
            this.logger.error(`[ReflectionService] Error generating reflection for ${av.name}: ${err.message}`)
          )
        )
      );
      this.logger.info('[ReflectionService] Reflections generated');
    } catch (error) {
      this.logger.error(`[ReflectionService] generateReflections failed: ${error.message}`);
    }
  }
}