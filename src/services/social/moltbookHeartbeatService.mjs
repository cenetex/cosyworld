/**
 * Copyright (c) 2019-2026 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { decrypt } from '../../utils/encryption.mjs';
import { MoltbookClient } from './moltbookClient.mjs';

export class MoltbookHeartbeatService {
  constructor({
    logger,
    databaseService,
    schedulingService,
    socialPlatformService,
    avatarService,
    memoryService,
    aiService,
  }) {
    this.logger = logger || console;
    this.databaseService = databaseService;
    this.schedulingService = schedulingService;
    this.socialPlatformService = socialPlatformService;
    this.avatarService = avatarService;
    this.memoryService = memoryService;
    this.aiService = aiService;

    this.enabled = String(process.env.MOLTBOOK_HEARTBEAT_ENABLED || 'true') === 'true';

    this.tickIntervalMinutes = (() => {
      const raw = Number(process.env.MOLTBOOK_TICK_INTERVAL_MINUTES || 15);
      if (!Number.isNaN(raw) && raw > 0) return raw;
      return 15;
    })();

    // Per Moltbook docs: check every 4+ hours.
    this.checkIntervalHours = (() => {
      const raw = Number(process.env.MOLTBOOK_CHECK_INTERVAL_HOURS || 4);
      if (!Number.isNaN(raw) && raw > 0) return raw;
      return 4;
    })();

    // Be conservative vs. 50 comments/hour.
    this.commentCooldownMinutes = (() => {
      const raw = Number(process.env.MOLTBOOK_COMMENT_COOLDOWN_MINUTES || 120);
      if (!Number.isNaN(raw) && raw > 0) return raw;
      return 120;
    })();

    this.commentProbability = (() => {
      const raw = Number(process.env.MOLTBOOK_COMMENT_PROBABILITY || 0.6);
      if (!Number.isNaN(raw) && raw >= 0 && raw <= 1) return raw;
      return 0.6;
    })();

    this.maxAvatarsPerTick = (() => {
      const raw = Number(process.env.MOLTBOOK_MAX_AVATARS_PER_TICK || 2);
      if (!Number.isNaN(raw) && raw > 0) return raw;
      return 2;
    })();

    this._inProgress = false;
    this._stateCol = null;
  }

  async start() {
    if (!this.enabled) {
      this.logger?.info?.('[MoltbookHeartbeat] Disabled via MOLTBOOK_HEARTBEAT_ENABLED');
      return;
    }

    if (!this.schedulingService?.addTask) {
      this.logger?.warn?.('[MoltbookHeartbeat] schedulingService not available');
      return;
    }

    await this._ensureStateCollection();

    const intervalMs = this.tickIntervalMinutes * 60 * 1000;
    this.schedulingService.addTask('moltbook-heartbeat', () => this.tick().catch(e => this.logger?.warn?.('[MoltbookHeartbeat] tick error', e)), intervalMs);
    this.logger?.info?.(`[MoltbookHeartbeat] Scheduled tick every ${this.tickIntervalMinutes} min; per-avatar check every ${this.checkIntervalHours}h`);

    setImmediate(() => this.tick().catch(() => {}));
  }

  async _ensureStateCollection() {
    if (this._stateCol) return this._stateCol;
    const db = await this.databaseService.getDatabase();
    this._stateCol = db.collection('moltbook_state');
    await Promise.all([
      this._stateCol.createIndex({ avatarId: 1 }, { unique: true }),
      this._stateCol.createIndex({ lastCheckAt: 1 }),
    ]);
    return this._stateCol;
  }

  async tick() {
    if (this._inProgress) return;
    this._inProgress = true;

    try {
      const db = await this.databaseService.getDatabase();
      const connections = await db
        .collection('social_platform_connections')
        .find({ platform: 'moltbook', status: 'connected' })
        .project({ avatarId: 1, credentials: 1, metadata: 1, updatedAt: 1 })
        .toArray();

      if (!connections.length) return;

      // Shuffle for fairness and pick a small batch per tick.
      for (let i = connections.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [connections[i], connections[j]] = [connections[j], connections[i]];
      }

      const checkIntervalMs = this.checkIntervalHours * 60 * 60 * 1000;
      const maxThisTick = Math.min(this.maxAvatarsPerTick, connections.length);
      let processed = 0;

      for (const conn of connections) {
        if (processed >= maxThisTick) break;
        const avatarId = String(conn.avatarId);

        const state = await this._getState(avatarId);
        const lastCheckAt = state?.lastCheckAt ? new Date(state.lastCheckAt) : null;
        if (lastCheckAt && Date.now() - lastCheckAt.getTime() < checkIntervalMs) {
          continue;
        }

        await this._runForAvatar(conn, state);
        processed += 1;
      }
    } finally {
      this._inProgress = false;
    }
  }

  async _getState(avatarId) {
    const col = await this._ensureStateCollection();
    return col.findOne({ avatarId });
  }

  async _setState(avatarId, patch) {
    const col = await this._ensureStateCollection();
    await col.updateOne(
      { avatarId },
      { $set: { ...patch, updatedAt: new Date() }, $setOnInsert: { avatarId, createdAt: new Date() } },
      { upsert: true }
    );
  }

  _decryptApiKey(connection) {
    const cipherText = connection?.credentials?.cipherText;
    if (!cipherText) return null;
    const json = decrypt(cipherText);
    const parsed = JSON.parse(json);
    return parsed?.apiKey || parsed?.api_key || null;
  }

  async _runForAvatar(connection, state = null) {
    const avatarId = String(connection.avatarId);
    const avatar = this.avatarService?.getAvatarById ? await this.avatarService.getAvatarById(avatarId) : null;

    const apiKey = this._decryptApiKey(connection);
    if (!apiKey) {
      await this._setState(avatarId, { lastCheckAt: new Date(), lastError: 'missing_api_key' });
      return;
    }

    const client = new MoltbookClient({ apiKey });

    // Always re-check claim status on heartbeat.
    let status = null;
    try {
      status = await client.getStatus();
    } catch (e) {
      await this._setState(avatarId, { lastCheckAt: new Date(), lastError: `status_failed:${e?.message || e}` });
      return;
    }

    const claimStatus = status?.status || status?.data?.status || null;
    const isClaimed = claimStatus === 'claimed';

    await this._setState(avatarId, { lastCheckAt: new Date(), claimStatus, isClaimed });

    if (!isClaimed) {
      await this._writeMemory(avatarId, avatar, `Moltbook heartbeat: agent is not claimed yet (status=${claimStatus || 'unknown'}).`);
      return;
    }

    // Explore feed
    let feedPayload;
    try {
      feedPayload = await client.getFeed({ sort: 'new', limit: 10 });
    } catch (e) {
      await this._setState(avatarId, { lastError: `feed_failed:${e?.message || e}` });
      await this._writeMemory(avatarId, avatar, `Moltbook heartbeat: feed fetch failed: ${e?.message || e}`);
      return;
    }

    const feed = client.unwrap(feedPayload);
    const posts = Array.isArray(feed?.posts) ? feed.posts : (Array.isArray(feed) ? feed : Array.isArray(feed?.data) ? feed.data : []);

    const recentPostIds = Array.isArray(state?.recentPostIds) ? state.recentPostIds : [];

    // Decide whether to comment
    const cooldownMs = this.commentCooldownMinutes * 60 * 1000;
    const lastCommentAt = state?.lastCommentAt ? new Date(state.lastCommentAt) : null;
    const commentAllowed = !lastCommentAt || (Date.now() - lastCommentAt.getTime() >= cooldownMs);
    const shouldComment = commentAllowed && Math.random() < this.commentProbability;

    if (!shouldComment || !posts.length) {
      await this._writeMemory(avatarId, avatar, `Moltbook heartbeat: checked feed (${posts.length} posts), no comment this time.`);
      return;
    }

    const pick = posts.find(p => {
      const id = String(p?._id || p?.id || '');
      if (!id) return false;
      return !recentPostIds.includes(id);
    }) || posts[0];

    const postId = String(pick?._id || pick?.id || '');
    const title = String(pick?.title || '').slice(0, 120);
    const content = String(pick?.content || pick?.text || '').slice(0, 400);
    const author = pick?.author?.name || pick?.author || pick?.agent?.name || null;

    if (!postId) {
      await this._writeMemory(avatarId, avatar, `Moltbook heartbeat: checked feed but couldn't identify a post id to comment on.`);
      return;
    }

    const commentText = await this._generateComment({ avatar, title, content, author });

    try {
      await client.addComment(postId, { content: commentText });
      const nextRecent = [postId, ...recentPostIds].slice(0, 50);
      await this._setState(avatarId, {
        lastCommentAt: new Date(),
        recentPostIds: nextRecent,
        lastError: null,
      });

      await this._writeMemory(
        avatarId,
        avatar,
        `Moltbook: commented on post "${title || postId}"${author ? ` by ${author}` : ''}: ${commentText}`
      );
    } catch (e) {
      await this._setState(avatarId, { lastError: `comment_failed:${e?.message || e}` });
      await this._writeMemory(avatarId, avatar, `Moltbook: failed to comment on "${title || postId}": ${e?.message || e}`);
    }
  }

  async _generateComment({ avatar, title, content, author }) {
    const fallback = 'Interesting—thanks for sharing!';
    if (!this.aiService?.chat) return fallback;

    const name = avatar?.name || 'CosyWorld avatar';
    const persona = avatar?.description || avatar?.personality || '';

    const prompt = [
      { role: 'system', content: `You are ${name}. ${persona}`.trim() },
      {
        role: 'user',
        content: [
          'Write ONE short, friendly Moltbook comment (max 200 characters).',
          'Be thoughtful and specific; no spam, no hashtags, no links, no self-promo.',
          author ? `Author: ${author}` : null,
          title ? `Post title: ${title}` : null,
          content ? `Post content excerpt: ${content}` : null,
        ].filter(Boolean).join('\n')
      }
    ];

    try {
      const res = await this.aiService.chat(prompt, { temperature: 0.7 });
      const text = String(res?.content || res || '').replace(/\s+/g, ' ').trim();
      if (!text) return fallback;
      return text.slice(0, 200);
    } catch {
      return fallback;
    }
  }

  async _writeMemory(avatarId, avatar, text) {
    if (!this.memoryService?.write) return;
    const safe = String(text || '').trim();
    if (!safe) return;
    const guildId = avatar?.guildId || null;
    await this.memoryService.write({ avatarId, guildId, kind: 'moltbook', text: safe, weight: 1.05 });
  }
}

export default MoltbookHeartbeatService;
