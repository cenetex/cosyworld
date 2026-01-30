/**
 * Copyright (c) 2019-2026 Cenetex Inc.
 * Licensed under the MIT License.
 */

const DEFAULT_BASE_URL = 'https://moltbook.com/api/v1';

export class MoltbookClient {
  constructor({ apiKey = null, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  withApiKey(apiKey) {
    return new MoltbookClient({ apiKey, baseUrl: this.baseUrl, fetchImpl: this.fetchImpl });
  }

  async registerAgent({ name, description }) {
    return this._request('/agents/register', {
      method: 'POST',
      json: { name, description }
    });
  }

  async getMe() {
    return this._request('/agents/me');
  }

  async getStatus() {
    return this._request('/agents/status');
  }

  async createPost({ submolt = 'general', title, content = null, url = null }) {
    return this._request('/posts', {
      method: 'POST',
      json: { submolt, title, content, url }
    });
  }

  async _request(path, { method = 'GET', json = null, headers = {} } = {}) {
    const url = `${this.baseUrl}${path}`;

    const mergedHeaders = {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      ...headers
    };

    const res = await this.fetchImpl(url, {
      method,
      headers: mergedHeaders,
      body: json ? JSON.stringify(json) : undefined
    });

    let data = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await res.json();
      } catch {
        data = null;
      }
    } else {
      try {
        data = await res.text();
      } catch {
        data = null;
      }
    }

    if (!res.ok) {
      const errMsg = typeof data === 'object' && data
        ? (data.error || data.message || `HTTP ${res.status}`)
        : (`HTTP ${res.status}`);
      const hint = typeof data === 'object' && data ? data.hint : null;
      const message = hint ? `${errMsg} (hint: ${hint})` : errMsg;
      const error = new Error(message);
      error.status = res.status;
      error.data = data;
      throw error;
    }

    return data;
  }
}

export default MoltbookClient;
