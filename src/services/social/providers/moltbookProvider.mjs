/**
 * Copyright (c) 2019-2026 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { BaseSocialProvider } from './baseSocialProvider.mjs';
import { MoltbookClient } from '../moltbookClient.mjs';

export class MoltbookProvider extends BaseSocialProvider {
  constructor(service) {
    super(service, 'moltbook');
    this.sessions = new Map(); // avatarId -> { client, metadata }
  }

  async initialize() {
    this.logger.info('Initializing MoltbookProvider...');
  }

  async connectAvatar(avatarId, credentials, options = {}) {
    const normalized = this._normalizeCredentials(credentials);
    await this.disconnectAvatar(avatarId, { reason: 'reconnect' });

    const client = new MoltbookClient({ apiKey: normalized.apiKey });

    // Validate credentials (and capture claim state)
    const [me, status] = await Promise.all([
      client.getMe().catch(() => null),
      client.getStatus().catch(() => null)
    ]);

    const claimStatus = status?.status || null;
    const agentName = me?.agent?.name || normalized.agentName || null;

    const metadata = {
      ...(options.metadata || {}),
      agentName,
      claimStatus,
      isClaimed: claimStatus === 'claimed'
    };

    this.sessions.set(avatarId, { client, metadata });

    return {
      username: agentName,
      id: null,
      metadata
    };
  }

  async disconnectAvatar(avatarId, _options = {}) {
    if (!this.sessions.has(avatarId)) return;
    this.sessions.delete(avatarId);
    this.logger.info(`Disconnected Moltbook account for avatar ${avatarId}`);
  }

  async post(avatarId, content, options = {}) {
    const session = this.sessions.get(avatarId);
    if (!session?.client) {
      throw new Error(`Avatar ${avatarId} is not connected to Moltbook`);
    }

    const payload = typeof content === 'string'
      ? { title: options.title || 'Update', content: content }
      : (content || {});

    if (!payload.title) {
      throw new Error('Moltbook post title is required');
    }

    const res = await session.client.createPost({
      submolt: options.submolt || payload.submolt || 'general',
      title: payload.title,
      content: payload.content ?? null,
      url: payload.url ?? null,
    });

    const postId = res?.data?._id || res?.data?.id || res?.post?._id || res?.post?.id || null;

    return {
      id: postId,
      username: session.metadata?.agentName || null,
      url: postId ? `https://moltbook.com/p/${postId}` : null,
      raw: res
    };
  }

  _normalizeCredentials(credentials = {}) {
    const apiKey = credentials.apiKey || credentials.api_key;
    const agentName = credentials.agentName || credentials.agent_name || null;

    if (!apiKey) {
      throw new Error('Moltbook apiKey is required to connect');
    }

    return { apiKey, agentName };
  }
}

export default MoltbookProvider;
