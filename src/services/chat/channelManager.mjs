export class ChannelManager {
  constructor({
    logger,
    databaseService,
    discordService,
    schedulingService,
    locationService,
    mapService,
    conversationManager
  }) {
    this.databaseService = databaseService;
    this.discordService = discordService;
    this.schedulingService = schedulingService;
    this.locationService = locationService;
    this.mapService = mapService;
    this.conversationManager = conversationManager;
    this.logger = logger || console;
    
    
    this.ACTIVITY_TIMEOUT = 60 * 60 * 1000; // 60 minutes
    this.logger.info('[ChannelManager] Initialized');
    
  }

  async initializeServices() {
    this.logger.info('[ChannelManager] Registering ambient response periodic task');

    const ambientTask = async() => {
      try {
        await this.triggerAmbientResponses();
      } catch (err) {
        this.logger.warn(`[ChannelManager] Error in ambient response task: ${err.message}`);
      }
    }
    this.schedulingService.addTask( 'triggerAmbientResponses', ambientTask, 60 * 60 * 1000 );
    ambientTask();
  }

  async triggerAmbientResponses() {
    this.logger.info('[ChannelManager] Triggering ambient responses');
    
    const activeChannels = await this.getMostRecentActiveChannels(3);
    for (const channel of activeChannels) {
      // Ensure location exists
      await this.locationService.getLocationByChannelId(channel.id);

      // Update ambiance if stale (tied to avatar activity via periodic check)
      if (await this.locationService.summaryIsStale(channel.id)) {
        const channelHistory = await this.conversationManager.getChannelHistory(channel.id);
        await this.locationService.generateLocationSummary(channel.id, channelHistory);
      }

      // Handle avatar responses
      const avatars = (await this.mapService.getLocationAndAvatars(channel.id)).avatars;
      const selected = avatars.sort(() => Math.random() - 0.5).slice(0, 2);
      for (const avatar of selected) {
        await this.conversationManager.sendResponse(channel, avatar);
      }
    }
  }

  /**
   * Checks if a channel is currently active based on the activity timeout.
   * @param {string} channelId - The ID of the channel.
   * @returns {boolean} - True if the channel is active, false otherwise.
   */
  async isChannelActive(channelId) {
    const db = await this.databaseService.getDatabase();
    const doc = await db.collection('channel_activity').findOne({ _id: channelId });
    return doc && doc.lastActivityTimestamp >= Date.now() - this.ACTIVITY_TIMEOUT;
  }

  /**
   * Retrieves all channels that are currently active within the timeout period.
   * @returns {Array} - Array of active channel objects.
   */
  async getActiveChannels() {
    const now = Date.now();
    const activeDocs = await this.channelActivityCollection.find({
      lastActivityTimestamp: { $gte: now - this.ACTIVITY_TIMEOUT }
    }).toArray();
    const activeChannels = activeDocs
      .map(doc => this.discordService.client.channels.cache.get(doc._id))
      .filter(c => c && c.isTextBased());
    return activeChannels;
  }

  /**
   * Retrieves the X most recently active channels.
   * @param {number} limit - The number of recent channels to retrieve.
   * @returns {Array} - Array of the most recently active channel objects.
   */
  async getMostRecentActiveChannels(limit) {
    const recentDocs = await this.channelActivityCollection.find()
      .sort({ lastActivityTimestamp: -1 })
      .limit(limit)
      .toArray();
    const recentChannels = recentDocs
      .map(doc => this.discordService.client.channels.cache.get(doc._id))
      .filter(c => c && c.isTextBased());
    return recentChannels;
  }
}