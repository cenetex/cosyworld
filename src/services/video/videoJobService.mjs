/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

export default class VideoJobService {
  constructor({ logger, databaseService, veoService, s3Service, discordService, schedulingService, configService }) {
    this.logger = logger || console;
    this.databaseService = databaseService;
    this.veoService = veoService;
    this.s3Service = s3Service;
    this.discordService = discordService;
    this.schedulingService = schedulingService;
    this.configService = configService;

    this.COLLECTION = 'video_jobs';
    this.pollIntervalMs = Number(process.env.VIDEO_JOBS_POLL_MS || 15_000);
    this.maxAttempts = Number(process.env.VIDEO_JOBS_MAX_ATTEMPTS || 3);
    this.maxConcurrent = Number(process.env.VIDEO_JOBS_MAX_CONCURRENCY || 1);
    this._running = false;
    this._inFlight = 0;
  }

  async col() {
    const db = await this.databaseService.getDatabase();
    return db.collection(this.COLLECTION);
  }

  async start() {
    try {
      // Create indexes if not present
      const col = await this.col();
      try {
        await col.createIndexes([
          { key: { status: 1, nextRunAt: 1 } },
          { key: { createdAt: -1 } },
          { key: { updatedAt: -1 } },
        ]);
      } catch {}

      const tick = async () => {
        try { await this.processLoop(); } catch (e) { this.logger.warn?.(`[VideoJobService] loop error: ${e.message}`); }
      };
      if (this.schedulingService?.addTask) {
        this.schedulingService.addTask('video-jobs', tick, this.pollIntervalMs);
        this.logger.info?.('[VideoJobService] Started via SchedulingService');
      } else {
        setInterval(tick, this.pollIntervalMs);
        this.logger.info?.('[VideoJobService] Started via setInterval');
      }
    } catch (e) {
      this.logger.error?.('[VideoJobService] start failed:', e);
    }
  }

  async enqueue({ keyframeUrl, prompt, channelId, guildId, avatarId, avatarName, config = { aspectRatio: '16:9', numberOfVideos: 1 } }) {
    const now = new Date();
    const doc = {
      type: 'veo-image-to-video',
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      nextRunAt: now,
      attempts: 0,
      prompt: String(prompt || ''),
      keyframeUrl,
      channelId: channelId || null,
      guildId: guildId || null,
      avatarId: avatarId || null,
      avatarName: avatarName || null,
      config,
      result: null,
      lastError: null,
    };
    const col = await this.col();
    const res = await col.insertOne(doc);
    return res.insertedId;
  }

  async markCompleted(id, uris = []) {
    const col = await this.col();
    await col.updateOne({ _id: id }, { $set: { status: 'done', result: { uris }, updatedAt: new Date() } });
  }

  async markFailed(id, error, backoffMs = 60_000) {
    const col = await this.col();
    const doc = await col.findOne({ _id: id });
    const attempts = (doc?.attempts || 0) + 1;
    const status = attempts >= this.maxAttempts ? 'failed' : 'queued';
    const nextRunAt = new Date(Date.now() + (status === 'queued' ? Math.min(backoffMs * attempts, 15 * 60_000) : 0));
    await col.updateOne({ _id: id }, { $set: { status, attempts, lastError: String(error?.message || error), updatedAt: new Date(), nextRunAt } });
  }

  async processLoop() {
    if (this._running) return;
    this._running = true;
    try {
      while (this._inFlight < this.maxConcurrent) {
        const job = await this._claimJob();
        if (!job) break;
        this._inFlight++;
        this._process(job).finally(() => { this._inFlight = Math.max(0, this._inFlight - 1); });
      }
    } finally {
      this._running = false;
    }
  }

  async _claimJob() {
    const col = await this.col();
    const now = new Date();
    const res = await col.findOneAndUpdate(
      { status: { $in: ['queued', 'running'] }, nextRunAt: { $lte: now } },
      { $set: { status: 'running', updatedAt: now, heartbeatAt: now } },
      { sort: { status: 1, createdAt: 1 }, returnDocument: 'after' }
    );
    return res?.value || null;
  }

  async _process(job) {
    try {
      // Respect global Veo rate limits; if not allowed, defer
      if (!this.veoService?.checkRateLimit?.()) {
        await this._defer(job._id, 60_000);
        return;
      }
      // Download keyframe and kick off generation (idempotent if repeated)
      const buf = await this.s3Service.downloadImage(job.keyframeUrl);
      const base64 = buf.toString('base64');
      const uris = await this.veoService.generateVideosFromImages({
        prompt: job.prompt,
        images: [{ data: base64, mimeType: 'image/png' }],
        config: job.config || { aspectRatio: '16:9', numberOfVideos: 1 }
      });

      if (uris && uris.length) {
        await this.markCompleted(job._id, uris);
        await this._notify(job, uris).catch(() => {});
      } else {
        throw new Error('No URIs returned from Veo');
      }
    } catch (e) {
      this.logger.warn?.(`[VideoJobService] job ${String(job._id)} failed: ${e.message}`);
      await this.markFailed(job._id, e);
    }
  }

  async _defer(id, ms) {
    const col = await this.col();
    await col.updateOne({ _id: id }, { $set: { status: 'queued', nextRunAt: new Date(Date.now() + ms), updatedAt: new Date() } });
  }

  async _notify(job, uris = []) {
    try {
      if (!this.discordService?.sendAsWebhook) return;
      if (!job.channelId || !job.avatarId) return;
      const clipLines = uris.map(u => `-# [ 🎥 [Scene Clip](${u}) ]`).join('\n');
      await this.discordService.sendAsWebhook(job.channelId, clipLines, { _id: job.avatarId, name: job.avatarName || 'Avatar' });
    } catch (e) {
      this.logger.warn?.(`[VideoJobService] notify failed: ${e.message}`);
    }
  }
}
