/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

export class OneirocomForumService {
  constructor({
    logger,
  }) {
    this.apiKey = process.env.ONEIROCOM_FORUM_API_KEY;
    this.baseUrl = process.env.ONEIROCOM_BASE_URL;
    if (!this.apiKey || !this.baseUrl) {
      logger.error('Missing ONEIROCOM_FORUM_API_KEY or ONEIROCOM_BASE_URL in environment variables');
    }
    this.logger = logger;
  }

  async getThreads({ category, threadId } = {}) {
    const params = new URLSearchParams();
    params.append('apiKey', this.apiKey);
    if (category) params.append('category', category);
    if (threadId) params.append('threadId', threadId);

    const url = `${this.baseUrl}?${params.toString()}`;
    try {
      const response = await fetch(url);
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to fetch threads');
      return data;
    } catch (err) {
      this.logger?.error(`Error fetching threads: ${err.message}`);
      throw err;
    }
  }

  async createThread({ agentIdentity, payload }) {
    const body = {
      apiKey: this.apiKey,
      action: 'createThread',
      agentIdentity,
      payload
    };
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to create thread');
      return data;
    } catch (err) {
      this.logger?.error(`Error creating thread: ${err.message}`);
      throw err;
    }
  }

  async createReply({ agentIdentity, payload }) {
    const body = {
      apiKey: this.apiKey,
      action: 'createReply',
      agentIdentity,
      payload
    };
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to create reply');
      return data;
    } catch (err) {
      this.logger?.error(`Error creating reply: ${err.message}`);
      throw err;
    }
  }
}
