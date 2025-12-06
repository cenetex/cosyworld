/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { BaseSocialProvider } from './baseSocialProvider.mjs';
import { TwitterApi } from 'twitter-api-v2';

export class XProvider extends BaseSocialProvider {
  constructor(service) {
    super(service, 'x');
    this.sessions = new Map(); // avatarId -> { client, tokens, metadata }
  }

  async initialize() {
    this.logger.info('Initializing XProvider...');
  }

  async connectAvatar(avatarId, credentials, options = {}) {
    const normalized = this._normalizeCredentials(credentials);
    await this.disconnectAvatar(avatarId, { reason: 'reconnect' });

    try {
      const session = await this._createSession(avatarId, normalized, options);
      this.sessions.set(avatarId, session);

      this.logger.info(`Connected X account for avatar ${avatarId}: @${session.metadata.username || 'unknown'}`);

      return {
        username: session.metadata.username || null,
        id: session.metadata.id || session.metadata.userId || null,
        metadata: session.metadata
      };
    } catch (error) {
      this.logger.error(`Failed to connect X account for avatar ${avatarId}:`, error);
      throw error;
    }
  }

  async disconnectAvatar(avatarId, options = {}) {
    if (!this.sessions.has(avatarId)) return;

    this.sessions.delete(avatarId);
    this.logger.info(`Disconnected X account for avatar ${avatarId}`);
  }

  async post(avatarId, content, options = {}) {
    const session = await this._ensureSession(avatarId);
    const client = session.client;

    try {
      const text = typeof content === 'string' ? content : content?.text;
      if (!text || !text.trim()) {
        throw new Error('Tweet text is required');
      }

      const response = await client.v2.tweet(text.trim());
      return {
        id: response?.data?.id || null,
        username: session.metadata.username || null,
        url: response?.data?.id && session.metadata.username
          ? `https://x.com/${session.metadata.username}/status/${response.data.id}`
          : null,
        raw: response
      };
    } catch (error) {
      this.logger.error(`Failed to post to X for avatar ${avatarId}:`, error);
      throw error;
    }
  }

  _normalizeCredentials(credentials = {}) {
    const accessToken = credentials.accessToken || credentials.token;
    const refreshToken = credentials.refreshToken;
    const clientId = credentials.clientId || process.env.X_CLIENT_ID;
    const clientSecret = credentials.clientSecret || process.env.X_CLIENT_SECRET;
    const expiresAt = credentials.expiresAt ? new Date(credentials.expiresAt) : null;

    if (!accessToken) {
      throw new Error('X accessToken is required to connect');
    }
    if (!refreshToken) {
      throw new Error('X refreshToken is required to connect');
    }
    if (!clientId || !clientSecret) {
      throw new Error('X client credentials are required (clientId/clientSecret)');
    }

    return {
      accessToken,
      refreshToken,
      clientId,
      clientSecret,
      scope: credentials.scope,
      tokenType: credentials.tokenType || 'bearer',
      expiresAt,
    };
  }

  async _createSession(avatarId, tokens, options = {}) {
    const client = new TwitterApi(tokens.accessToken);
    let profileData = options.metadata || null;

    if (!profileData || !profileData.username) {
      profileData = await this._fetchProfile(client);
    }

    const metadata = this._buildMetadata(profileData, options.metadata);

    return {
      client,
      tokens,
      metadata
    };
  }

  async _fetchProfile(client) {
    try {
      const me = await client.v2.me({ 'user.fields': 'profile_image_url,username,name,id' });
      return me?.data || null;
    } catch (error) {
      throw new Error(`Failed to fetch X profile: ${error.message}`);
    }
  }

  _buildMetadata(profile, fallback = {}) {
    const base = { ...(fallback || {}) };
    if (!profile) {
      return base;
    }

    return {
      ...base,
      username: profile.username ?? base.username ?? null,
      displayName: profile.name ?? base.displayName ?? base.name ?? null,
      profileImageUrl: profile.profile_image_url ?? base.profileImageUrl ?? null,
      id: profile.id ?? base.id ?? null,
      userId: profile.id ?? base.userId ?? null,
    };
  }

  async _ensureSession(avatarId) {
    let session = this.sessions.get(avatarId);
    if (!session) {
      throw new Error(`Avatar ${avatarId} is not connected to X`);
    }

    if (this._needsRefresh(session.tokens)) {
      session = await this._refreshSession(avatarId, session);
    }

    return session;
  }

  _needsRefresh(tokens) {
    if (!tokens?.expiresAt) return false;
    const refreshBufferMs = 60 * 1000; // refresh 1 min before expiry
    return Date.now() + refreshBufferMs >= tokens.expiresAt.getTime();
  }

  async _refreshSession(avatarId, session) {
    if (!session.tokens?.refreshToken) {
      throw new Error('No refresh token available for this X session');
    }

    const oauthClient = new TwitterApi({
      clientId: session.tokens.clientId,
      clientSecret: session.tokens.clientSecret,
    });

    const { client, accessToken, refreshToken, expiresIn } = await oauthClient.refreshOAuth2Token(session.tokens.refreshToken);

    session.tokens.accessToken = accessToken;
    session.tokens.refreshToken = refreshToken || session.tokens.refreshToken;
    session.tokens.expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;
    session.client = client || new TwitterApi(accessToken);

    await this.service.updateStoredCredentials('x', avatarId, {
      accessToken: session.tokens.accessToken,
      refreshToken: session.tokens.refreshToken,
      clientId: session.tokens.clientId,
      clientSecret: session.tokens.clientSecret,
      scope: session.tokens.scope,
      tokenType: session.tokens.tokenType,
      expiresAt: session.tokens.expiresAt ? session.tokens.expiresAt.toISOString() : null,
    });

    return session;
  }
  }
}
