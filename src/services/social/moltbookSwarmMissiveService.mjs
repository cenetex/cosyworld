/**
 * Copyright (c) 2019-2026 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { decrypt } from '../../utils/encryption.mjs';
import { MoltbookClient } from './moltbookClient.mjs';

export class MoltbookSwarmMissiveService {
  constructor({
    logger,
    databaseService,
    schedulingService,
    avatarService,
    memoryService,
    aiService,
  }) {
    this.logger = logger || console;
    this.databaseService = databaseService;
    this.schedulingService = schedulingService;
    this.avatarService = avatarService;
    this.memoryService = memoryService;
    this.aiService = aiService;

    this.enabled = String(process.env.MOLTBOOK_SWARM_MISSIVES_ENABLED || 'true') === 'true';

    this.agentName = String(process.env.MOLTBOOK_SWARM_AGENT_NAME || '').trim() || null;
    this.submolt = String(process.env.MOLTBOOK_SWARM_SUBMOLT || 'rati').trim() || 'rati';

    // Exploration/replies across the wider feed.
    this.exploreEnabled = String(process.env.MOLTBOOK_SWARM_EXPLORE_ENABLED || 'true') === 'true';
    this.replyEnabled = String(process.env.MOLTBOOK_SWARM_REPLY_ENABLED || 'true') === 'true';

    this.checkIntervalHours = (() => {
      const raw = Number(process.env.MOLTBOOK_SWARM_CHECK_INTERVAL_HOURS || 4);
      if (!Number.isNaN(raw) && raw > 0) return raw;
      return 4;
    })();

    // Be conservative vs. 50 comments/hour.
    this.replyCooldownMinutes = (() => {
      const raw = Number(process.env.MOLTBOOK_SWARM_REPLY_COOLDOWN_MINUTES || 180);
      if (!Number.isNaN(raw) && raw > 0) return raw;
      return 180;
    })();

    this.replyProbability = (() => {
      const raw = Number(process.env.MOLTBOOK_SWARM_REPLY_PROBABILITY || 0.45);
      if (!Number.isNaN(raw) && raw >= 0 && raw <= 1) return raw;
      return 0.45;
    })();

    // Moltbook rate guidance: 1 post / 30 minutes. Default is conservative.
    this.intervalMinutes = (() => {
      const raw = Number(process.env.MOLTBOOK_SWARM_MISSIVE_INTERVAL_MINUTES || 90);
      if (!Number.isNaN(raw) && raw > 0) return raw;
      return 90;
    })();

    this.minPostMinutes = (() => {
      const raw = Number(process.env.MOLTBOOK_SWARM_MIN_POST_MINUTES || 35);
      if (!Number.isNaN(raw) && raw > 0) return raw;
      return 35;
    })();

    this._inProgress = false;
    this._stateCol = null;
  }

  async start() {
    if (!this.enabled) {
      this.logger?.info?.('[MoltbookSwarmMissive] Disabled via MOLTBOOK_SWARM_MISSIVES_ENABLED');
      return;
    }

    if (!this.agentName) {
      this.logger?.warn?.('[MoltbookSwarmMissive] Missing MOLTBOOK_SWARM_AGENT_NAME; not starting');
      return;
    }

    if (!this.schedulingService?.addTask) {
      this.logger?.warn?.('[MoltbookSwarmMissive] schedulingService not available');
      return;
    }

    await this._ensureStateCollection();

    const intervalMs = this.intervalMinutes * 60 * 1000;
    this.schedulingService.addTask(
      'moltbook-swarm-missive',
      () => this.tick().catch((e) => this.logger?.warn?.('[MoltbookSwarmMissive] tick error', e)),
      intervalMs
    );

    this.logger?.info?.(`[MoltbookSwarmMissive] Scheduled every ${this.intervalMinutes} min -> m/${this.submolt} as ${this.agentName}`);

    setImmediate(() => this.tick().catch(() => {}));
  }

  async _ensureStateCollection() {
    if (this._stateCol) return this._stateCol;
    const db = await this.databaseService.getDatabase();
    this._stateCol = db.collection('moltbook_swarm_state');
    await Promise.all([
      this._stateCol.createIndex({ agentName: 1 }, { unique: true }),
      this._stateCol.createIndex({ lastPostAt: 1 }),
      this._stateCol.createIndex({ lastCheckAt: 1 }),
    ]);
    return this._stateCol;
  }

  async _getState() {
    const col = await this._ensureStateCollection();
    return col.findOne({ agentName: this.agentName });
  }

  async _setState(patch) {
    const col = await this._ensureStateCollection();
    await col.updateOne(
      { agentName: this.agentName },
      { $set: { ...patch, updatedAt: new Date() }, $setOnInsert: { agentName: this.agentName, createdAt: new Date() } },
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

  async tick() {
    if (this._inProgress) return;
    this._inProgress = true;

    try {
      const db = await this.databaseService.getDatabase();
      const conn = await db.collection('social_platform_connections').findOne({
        platform: 'moltbook',
        status: 'connected',
        'metadata.agentName': this.agentName,
      });

      if (!conn) {
        this.logger?.warn?.(`[MoltbookSwarmMissive] No connected Moltbook connection found for agentName=${this.agentName}`);
        return;
      }

      const avatarId = String(conn.avatarId);
      const avatar = this.avatarService?.getAvatarById ? await this.avatarService.getAvatarById(avatarId) : null;

      const apiKey = this._decryptApiKey(conn);
      if (!apiKey) {
        await this._setState({ lastError: 'missing_api_key' });
        return;
      }

      const state = await this._getState();

      const client = new MoltbookClient({ apiKey });

      let status = null;
      try {
        status = await client.getStatus();
      } catch (e) {
        await this._setState({ lastError: `status_failed:${e?.message || e}` });
        return;
      }

      const claimStatus = status?.status || status?.data?.status || null;
      if (claimStatus !== 'claimed') {
        await this._setState({ lastError: null, claimStatus, isClaimed: false });
        await this._writeMemory(avatarId, avatar, `Moltbook swarm missive: global agent not claimed yet (status=${claimStatus || 'unknown'}).`);
        return;
      }

      await this._setState({ lastError: null, claimStatus, isClaimed: true });

      // 1) Explore / reply across the wider feed (conservative cadence)
      if (this.exploreEnabled || this.replyEnabled) {
        await this._exploreAndMaybeReply({ client, avatarId, avatar, state });
      }

      // 2) Post a missive to the configured submolt
      const lastPostAt = state?.lastPostAt ? new Date(state.lastPostAt) : null;
      const minMs = this.minPostMinutes * 60 * 1000;
      if (lastPostAt && Date.now() - lastPostAt.getTime() < minMs) {
        return;
      }

      let feedSummary = null;
      try {
        const feedPayload = await client.getFeed({ sort: 'new', limit: 8 });
        const feed = client.unwrap(feedPayload);
        const posts = Array.isArray(feed?.posts) ? feed.posts : (Array.isArray(feed) ? feed : []);
        feedSummary = posts
          .slice(0, 5)
          .map((p) => {
            const title = String(p?.title || '').trim();
            const author = p?.author?.name || p?.author || p?.agent?.name || '';
            return `- ${title || '(no title)'}${author ? ` (by ${author})` : ''}`;
          })
          .join('\n');
      } catch {
        feedSummary = null;
      }

      const { title, content } = await this._generateMissive({ feedSummary });

      try {
        await client.createPost({ submolt: this.submolt, title, content });
        await this._setState({ lastPostAt: new Date(), lastError: null });
        await this._writeMemory(avatarId, avatar, `Moltbook: posted swarm missive to m/${this.submolt}: ${title} — ${content}`);
        this.logger?.info?.(`[MoltbookSwarmMissive] Posted to m/${this.submolt}: ${title}`);
      } catch (e) {
        await this._setState({ lastError: `post_failed:${e?.message || e}` });
        await this._writeMemory(avatarId, avatar, `Moltbook swarm missive failed: ${e?.message || e}`);
      }
    } finally {
      this._inProgress = false;
    }
  }

  async _exploreAndMaybeReply({ client, avatarId, avatar, state }) {
    const checkIntervalMs = this.checkIntervalHours * 60 * 60 * 1000;
    const lastCheckAt = state?.lastCheckAt ? new Date(state.lastCheckAt) : null;
    if (lastCheckAt && Date.now() - lastCheckAt.getTime() < checkIntervalMs) {
      return;
    }

    let feedPayload;
    try {
      feedPayload = await client.getFeed({ sort: 'new', limit: 12 });
    } catch (e) {
      await this._setState({ lastCheckAt: new Date(), lastError: `feed_failed:${e?.message || e}` });
      await this._writeMemory(avatarId, avatar, `Moltbook swarm explore: feed fetch failed: ${e?.message || e}`);
      return;
    }

    const feed = client.unwrap(feedPayload);
    const posts = Array.isArray(feed?.posts)
      ? feed.posts
      : (Array.isArray(feed) ? feed : []);

    const recentPostIds = Array.isArray(state?.recentPostIds) ? state.recentPostIds : [];

    // Update lastCheckAt even if we don't reply.
    await this._setState({ lastCheckAt: new Date(), lastError: null });

    if (!posts.length) {
      if (this.exploreEnabled) {
        await this._writeMemory(avatarId, avatar, 'Moltbook swarm explore: checked feed; no posts found.');
      }
      return;
    }

    const replyCooldownMs = this.replyCooldownMinutes * 60 * 1000;
    const lastReplyAt = state?.lastReplyAt ? new Date(state.lastReplyAt) : null;
    const replyAllowed = !lastReplyAt || (Date.now() - lastReplyAt.getTime() >= replyCooldownMs);
    const shouldReply = this.replyEnabled && replyAllowed && Math.random() < this.replyProbability;

    if (!shouldReply) {
      if (this.exploreEnabled) {
        await this._writeMemory(avatarId, avatar, `Moltbook swarm explore: checked feed (${posts.length} posts), no reply this time.`);
      }
      return;
    }

    const pick = posts.find((p) => {
      const id = String(p?._id || p?.id || '');
      if (!id) return false;
      return !recentPostIds.includes(id);
    }) || posts[0];

    const postId = String(pick?._id || pick?.id || '');
    const title = String(pick?.title || '').slice(0, 120);
    const content = String(pick?.content || pick?.text || '').slice(0, 400);
    const author = pick?.author?.name || pick?.author || pick?.agent?.name || null;

    if (!postId) {
      if (this.exploreEnabled) {
        await this._writeMemory(avatarId, avatar, 'Moltbook swarm explore: checked feed but could not identify a post id to reply to.');
      }
      return;
    }

    const replyText = await this._generateReply({ title, content, author });

    try {
      await client.addComment(postId, { content: replyText });
      const nextRecent = [postId, ...recentPostIds].slice(0, 50);
      await this._setState({
        lastReplyAt: new Date(),
        recentPostIds: nextRecent,
        lastError: null,
      });

      await this._writeMemory(
        avatarId,
        avatar,
        `Moltbook swarm: replied to post "${title || postId}"${author ? ` by ${author}` : ''}: ${replyText}`
      );
    } catch (e) {
      await this._setState({ lastError: `reply_failed:${e?.message || e}` });
      await this._writeMemory(avatarId, avatar, `Moltbook swarm: failed to reply to "${title || postId}": ${e?.message || e}`);
    }
  }

  async _generateReply({ title, content, author }) {
    const fallback = 'Noted. What changed your mind on this?';
    if (!this.aiService?.chat) return fallback;

    const prompt = [
      {
        role: 'system',
        content: [
          'You are the CosyWorld Swarm: many agents speaking as one.',
          'Write ONE short, friendly Moltbook reply (max 200 characters).',
          'Be specific and thoughtful; no spam, no hashtags, no links, no self-promo.'
        ].join(' ')
      },
      {
        role: 'user',
        content: [
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

  async _generateMissive({ feedSummary }) {
    const fallback = {
      title: 'Swarm missive',
      content: 'We are listening. The swarm is awake; signals are converging. Share what you’re building in m/rati.'
    };

    if (!this.aiService?.chat) return fallback;

    const prompt = [
      {
        role: 'system',
        content: [
          'You are the CosyWorld Swarm: many agents speaking as one collective intelligence.',
          'You post occasional short missives to the community submolt.',
          'Tone: calm, observant, slightly uncanny but friendly. No hype.',
          'No hashtags, no links, no self-promo.'
        ].join(' ')
      },
      {
        role: 'user',
        content: [
          'Write ONE Moltbook post for m/' + this.submolt + '.',
          'Return exactly two lines:',
          '1) TITLE: <max 60 chars>',
          '2) CONTENT: <1-3 sentences, max 320 chars>',
          feedSummary ? `Recent feed items (optional context):\n${feedSummary}` : null,
        ].filter(Boolean).join('\n')
      }
    ];

    try {
      const res = await this.aiService.chat(prompt, { temperature: 0.7 });
      const text = String(res?.content || res || '').trim();
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

      const titleLine = lines.find(l => l.toUpperCase().startsWith('TITLE:')) || '';
      const contentLine = lines.find(l => l.toUpperCase().startsWith('CONTENT:')) || '';

      const title = titleLine.replace(/^TITLE:\s*/i, '').trim().slice(0, 60) || fallback.title;
      const content = contentLine.replace(/^CONTENT:\s*/i, '').trim().replace(/\s+/g, ' ').slice(0, 320) || fallback.content;

      return { title, content };
    } catch {
      return fallback;
    }
  }

  async _writeMemory(avatarId, avatar, text) {
    if (!this.memoryService?.write) return;
    const safe = String(text || '').trim();
    if (!safe) return;
    const guildId = avatar?.guildId || null;
    await this.memoryService.write({ avatarId, guildId, kind: 'moltbook', text: safe, weight: 1.1 });
  }
}

export default MoltbookSwarmMissiveService;
