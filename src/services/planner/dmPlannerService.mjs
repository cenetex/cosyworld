/**
 * DMPlannerService
 * - Periodically scans active threads and assigns simple respond actions to suitable avatars.
 * - MVP: choose up to N avatars per active thread and ask ConversationManager to respond.
 */

export default class DMPlannerService {
  constructor({
    logger = console,
    databaseService,
    threadStateService,
    assignmentQueueService,
    avatarService,
    summarizerService,
    getConversationManager,
  }) {
    this.logger = logger;
    this.databaseService = databaseService;
    this.threadStateService = threadStateService;
    this.assignmentQueueService = assignmentQueueService;
    this.avatarService = avatarService;
    this.summarizerService = summarizerService;
    this.getConversationManager = getConversationManager;

    this.roundSize = Number(process.env.PLANNER_THREAD_BATCH || 5);
    this.maxRespondersPerThread = Number(process.env.PLANNER_MAX_RESPONDERS || 1);
  }

  async db() { return await this.databaseService.getDatabase(); }

  async planRound() {
    const states = await this.threadStateService.getActiveThreadStates(15 * 60 * 1000, this.roundSize);
    const assignments = [];
    for (const st of states) {
      const channelId = st.channelId;
      // Pick candidate avatars present in the channel or recently speaking
      let candidates = [];
      try {
        candidates = await this.avatarService.getAvatarsInChannel?.(channelId, st.guildId) || [];
      } catch {}
  // If no avatars are mapped to this channel, skip creating assignments
  if (!Array.isArray(candidates) || candidates.length === 0) continue;
  // Simple ranking: prefer avatars not in recent author ids
  const recentAuthorIds = new Set((st.recentAuthorIds || []));
      const ranked = candidates
        .filter(a => a && a._id)
        .sort((a, b) => {
          const aRecent = recentAuthorIds.has(`${a._id}`) ? 1 : 0;
          const bRecent = recentAuthorIds.has(`${b._id}`) ? 1 : 0;
          return aRecent - bRecent; // prefer not-recent
        })
        .slice(0, this.maxRespondersPerThread);

      for (const avatar of ranked) {
        assignments.push({
          type: 'respond',
          priority: 1,
          channelId,
          guildId: st.guildId || null,
          avatarId: `${avatar._id}`,
          reason: 'Active thread needs a response',
        });
      }
    }
    // De-duplicate (avatarId+channelId+type)
    const seen = new Set();
    const unique = assignments.filter(a => {
      const key = `${a.type}:${a.channelId}:${a.avatarId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const n = unique.length ? await this.assignmentQueueService.enqueue(unique) : 0;
    if (n > 0) this.logger.info?.(`[DMPlanner] Enqueued ${n} assignments for ${states.length} threads.`);
    return n;
  }

  async executeOne() {
    const job = await this.assignmentQueueService.claimNext('dm-planner');
    if (!job) return false;
    const cm = this.getConversationManager?.();
    if (!cm) {
      await this.assignmentQueueService.fail(job._id, 'No ConversationManager');
      return false;
    }
    try {
      const avatar = await this.avatarService.getAvatarById(job.avatarId);
      const channel = await cm.discordService.client.channels.fetch(job.channelId);
      if (!channel || !avatar) {
        await this.assignmentQueueService.fail(job._id, 'Channel or avatar missing');
        return false;
      }
      // Ask CM to send a response; overrideCooldown to keep flow moving
      await cm.sendResponse(channel, avatar, null, { overrideCooldown: true });
      await this.assignmentQueueService.complete(job._id, { ok: true });
      return true;
    } catch (e) {
      await this.assignmentQueueService.fail(job._id, e.message);
      return false;
    }
  }

  /**
   * Start periodic planning and execution loops with light cadence.
   */
  start() {
    const planEveryMs = Number(process.env.PLANNER_PLAN_INTERVAL_MS || 15_000);
    const execEveryMs = Number(process.env.PLANNER_EXEC_INTERVAL_MS || 5_000);
    this._planInterval = setInterval(() => {
      this.planRound().catch(e => this.logger.warn?.(`[DMPlanner] planRound failed: ${e.message}`));
    }, planEveryMs);
    this._execInterval = setInterval(() => {
      this.executeOne().catch(e => this.logger.warn?.(`[DMPlanner] executeOne failed: ${e.message}`));
    }, execEveryMs);
    this.logger.info?.(`[DMPlanner] started plan=${planEveryMs}ms exec=${execEveryMs}ms`);
  }

  stop() {
    if (this._planInterval) clearInterval(this._planInterval);
    if (this._execInterval) clearInterval(this._execInterval);
    this._planInterval = null;
    this._execInterval = null;
  }
}
