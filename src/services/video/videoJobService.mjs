import { resolveAdminAvatarId } from '../social/adminAvatarResolver.mjs';
/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import axios from 'axios';

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

  // Purge queued/running jobs on restart if configured
  await this._purgeQueuedOnStart();

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
      // Kick once immediately
      await tick();
    } catch (e) {
      this.logger.error?.('[VideoJobService] start failed:', e);
    }
  }

  async _purgeQueuedOnStart() {
    try {
      const clearFlag = (process.env.VIDEO_JOBS_CLEAR_ON_START ?? 'true').toString().toLowerCase();
      const shouldClear = clearFlag === 'true' || clearFlag === '1' || clearFlag === 'yes';
      if (!shouldClear) return;
      const hardDeleteFlag = (process.env.VIDEO_JOBS_DELETE_ON_PURGE ?? 'false').toString().toLowerCase();
      const hardDelete = hardDeleteFlag === 'true' || hardDeleteFlag === '1' || hardDeleteFlag === 'yes';
      const col = await this.col();
      const filter = { status: { $in: ['queued', 'running'] } };
      if (hardDelete) {
        const res = await col.deleteMany(filter);
        this.logger.warn?.(`[VideoJobService] Purged ${res?.deletedCount || 0} queued/running job(s) on start (hard delete)`);
      } else {
        const res = await col.updateMany(filter, { $set: { status: 'cancelled', lastError: 'RESTART_PURGE', updatedAt: new Date(), nextRunAt: null } });
        this.logger.warn?.(`[VideoJobService] Cancelled ${res?.modifiedCount || 0} queued/running job(s) on start`);
      }
    } catch (e) {
      this.logger.warn?.(`[VideoJobService] purge-on-start failed: ${e.message}`);
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
  const id = res.insertedId;
  this.logger.info?.(`[VideoJobService] enqueued job ${String(id)} for channel=${channelId} avatar=${avatarName || avatarId}`);
  // Nudge the worker immediately so we don't wait for the next poll
  try { Promise.resolve().then(() => this.processLoop()); } catch {}
  return id;
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
  return { attempts, status, nextRunAt };
  }

  async markCancelled(id, reason = 'cancelled') {
    const col = await this.col();
    await col.updateOne({ _id: id }, { $set: { status: 'cancelled', lastError: String(reason), updatedAt: new Date(), nextRunAt: null } });
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
      { status: 'queued', nextRunAt: { $lte: now } },
      { $set: { status: 'running', updatedAt: now, heartbeatAt: now } },
      { sort: { status: 1, createdAt: 1 }, returnDocument: 'after' }
    );
  const job = res?.value || null;
  if (job) this.logger.info?.(`[VideoJobService] claimed job ${String(job._id)} status=${job.status}`);
  else {
    try {
      const queuedCount = await col.countDocuments({ status: 'queued' });
      const runningCount = await col.countDocuments({ status: 'running' });
      this.logger.info?.(`[VideoJobService] no claimable jobs. queued=${queuedCount} running=${runningCount} now=${now.toISOString()}`);
    } catch {}
  }
  return job;
  }

  async _process(job) {
    try {
      this.logger.info?.(`[VideoJobService] processing job ${String(job._id)}...`);
  if (this._shouldNotifyProgress()) await this._notifyStart(job).catch(() => {});
      // Respect global Veo rate limits; if not allowed, defer (now async)
      if (!(await this.veoService?.checkRateLimit?.())) {
        await this.markCancelled(job._id, 'RATE_LIMIT');
        this.logger.warn?.(`[VideoJobService] cancelled job ${String(job._id)} due to rate limit`);
        await this._notifyCancel(job).catch(() => {});
        return;
      }
      // Download keyframe and kick off generation (idempotent if repeated)
      let base64;
      try {
        const buf = await this.s3Service.downloadImage(job.keyframeUrl);
        base64 = buf?.toString('base64');
      } catch (e) {
        this.logger.warn?.(`[VideoJobService] s3 keyframe download failed: ${e.message}`);
      }
      if (!base64 && /^https?:\/\//i.test(job.keyframeUrl)) {
        try {
          const resp = await axios.get(job.keyframeUrl, { responseType: 'arraybuffer' });
          base64 = Buffer.from(resp.data).toString('base64');
        } catch (e2) {
          this.logger.warn?.(`[VideoJobService] http keyframe download failed: ${e2.message}`);
        }
      }
      if (!base64) throw new Error('Failed to download keyframe image');
      const uris = await this.veoService.generateVideosFromImages({
        prompt: job.prompt,
        images: [{ data: base64, mimeType: 'image/png' }],
        config: job.config || { aspectRatio: '16:9', numberOfVideos: 1 }
      });

      if (uris && uris.length) {
        await this.markCompleted(job._id, uris);
        this.logger.info?.(`[VideoJobService] job ${String(job._id)} completed with ${uris.length} clip(s)`);
        await this._notify(job, uris).catch(() => {});
        // Optional: auto-post videos to X for admin account with channel summary
        try {
          const autoX = String(process.env.X_AUTO_POST_VIDEOS || 'false').toLowerCase();
          if (autoX === 'true' && this.configService?.services?.xService && job.channelId) {
            // Resolve admin identity
            let admin = null;
            try {
              const envId = resolveAdminAvatarId();
              if (envId && /^[a-f0-9]{24}$/i.test(envId)) {
                admin = await this.configService.services.avatarService.getAvatarById(envId);
              } else {
                const aiCfg = this.configService?.getAIConfig?.(process.env.AI_SERVICE);
                const model = aiCfg?.chatModel || aiCfg?.model || process.env.OPENROUTER_CHAT_MODEL || process.env.GOOGLE_AI_CHAT_MODEL || 'default';
                const safe = String(model).toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
                admin = { _id: `model:${safe}`, name: `System (${model})`, username: process.env.X_ADMIN_USERNAME || undefined };
              }
            } catch {}
            if (admin) {
              let summary = '';
              try { summary = await this.configService.services.conversationManager.getChannelSummary(admin._id, job.channelId); } catch {}
              if (typeof summary !== 'string') summary = String(summary || '');
              const content = `${job.prompt || 'New clip'} — ${summary}`.slice(0, 240);
              for (const u of uris) {
                try { await this.configService.services.xService.postVideoToX(admin, u, content); } catch (e) { this.logger.warn?.(`Auto X video post failed: ${e.message}`); }
              }
            }
          }
        } catch (e) { this.logger.debug?.(`auto X video post skipped: ${e.message}`); }
      } else {
        throw new Error('No URIs returned from Veo');
      }
    } catch (e) {
      this.logger.warn?.(`[VideoJobService] job ${String(job._id)} failed: ${e.message}`);
      const { status, attempts, nextRunAt } = await this.markFailed(job._id, e);
      if (status === 'failed') {
        await this._notifyFailure(job, e).catch(() => {});
      } else if (this._shouldNotifyProgress() && attempts === 1) {
        // Optional light notice on first retry
        await this._notifyRetry(job, attempts, nextRunAt).catch(() => {});
      }
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
      // Build a minimal avatar object that matches sendAsWebhook expectations
      const avatar = { _id: job.avatarId, id: job.avatarId, name: job.avatarName || 'Avatar', imageUrl: null };
      await this.discordService.sendAsWebhook(job.channelId, clipLines, avatar);
    } catch (e) {
      this.logger.warn?.(`[VideoJobService] notify failed: ${e.message}`);
    }
  }

  async _notifyCancel(job) {
    try {
      if (!this.discordService?.sendAsWebhook) return;
      if (!job.channelId || !job.avatarId) return;
      const text = `-# [ 🎥 video request cancelled: rate limit reached ]`;
      const avatar = { _id: job.avatarId, id: job.avatarId, name: job.avatarName || 'Avatar', imageUrl: null };
      await this.discordService.sendAsWebhook(job.channelId, text, avatar);
    } catch (e) {
      this.logger.warn?.(`[VideoJobService] notifyCancel failed: ${e.message}`);
    }
  }

  _shouldNotifyProgress() {
    const flag = (process.env.VIDEO_JOBS_NOTIFY_PROGRESS ?? 'true').toString().toLowerCase();
    return flag === 'true' || flag === '1' || flag === 'yes';
  }

  async _notifyStart(job) {
    try {
      if (!this.discordService?.sendAsWebhook) return;
      if (!job.channelId || !job.avatarId) return;
      const text = `-# [ 🎥 processing your video... ]`;
      const avatar = { _id: job.avatarId, id: job.avatarId, name: job.avatarName || 'Avatar', imageUrl: null };
      await this.discordService.sendAsWebhook(job.channelId, text, avatar);
    } catch (e) {
      this.logger.warn?.(`[VideoJobService] notifyStart failed: ${e.message}`);
    }
  }

  async _notifyRetry(job, attempts, nextRunAt) {
    try {
      if (!this.discordService?.sendAsWebhook) return;
      if (!job.channelId || !job.avatarId) return;
      const when = nextRunAt ? ` Will retry soon.` : '';
      const text = `-# [ 🎥 temporary issue, retrying... (attempt ${attempts}) ]${when}`;
      const avatar = { _id: job.avatarId, id: job.avatarId, name: job.avatarName || 'Avatar', imageUrl: null };
      await this.discordService.sendAsWebhook(job.channelId, text, avatar);
    } catch (e) {
      this.logger.warn?.(`[VideoJobService] notifyRetry failed: ${e.message}`);
    }
  }

  async _notifyFailure(job, error) {
    try {
      if (!this.discordService?.sendAsWebhook) return;
      if (!job.channelId || !job.avatarId) return;
      const msg = (error?.message || 'unknown error').slice(0, 180);
      const text = `-# [ 🎥 video request failed: ${msg} ]`;
      const avatar = { _id: job.avatarId, id: job.avatarId, name: job.avatarName || 'Avatar', imageUrl: null };
      await this.discordService.sendAsWebhook(job.channelId, text, avatar);
    } catch (e) {
      this.logger.warn?.(`[VideoJobService] notifyFailure failed: ${e.message}`);
    }
  }
}
