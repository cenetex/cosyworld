/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { BaseSocialProvider } from './baseSocialProvider.mjs';
import { TwitterApi } from 'twitter-api-v2';

export class XProvider extends BaseSocialProvider {
  constructor(service) {
    super(service, 'x');
    this.clients = new Map(); // avatarId -> TwitterApi instance
  }

  async initialize() {
    this.logger.info('Initializing XProvider...');
  }

  async connectAvatar(avatarId, credentials, options = {}) {
    const { appKey, appSecret, accessToken, accessSecret } = credentials;
    
    if (!appKey || !appSecret || !accessToken || !accessSecret) {
      throw new Error('Missing X credentials');
    }

    try {
      const client = new TwitterApi({
        appKey,
        appSecret,
        accessToken,
        accessSecret,
      });

      // Verify credentials
      const me = await client.v2.me();
      this.logger.info(`Connected X account for avatar ${avatarId}: @${me.data.username}`);

      this.clients.set(avatarId, client);

      return {
        username: me.data.username,
        id: me.data.id
      };
    } catch (error) {
      this.logger.error(`Failed to connect X account for avatar ${avatarId}:`, error);
      throw error;
    }
  }

  async disconnectAvatar(avatarId, options = {}) {
    if (this.clients.has(avatarId)) {
      this.clients.delete(avatarId);
      this.logger.info(`Disconnected X account for avatar ${avatarId}`);
    }
  }

  async post(avatarId, content, options = {}) {
    const client = this.clients.get(avatarId);
    if (!client) throw new Error(`Avatar ${avatarId} not connected to X`);

    try {
      // content can be string or object with media
      const text = typeof content === 'string' ? content : content.text;
      // TODO: Handle media
      
      const tweet = await client.v2.tweet(text);
      return tweet;
    } catch (error) {
      this.logger.error(`Failed to post to X for avatar ${avatarId}:`, error);
      throw error;
    }
  }
}
