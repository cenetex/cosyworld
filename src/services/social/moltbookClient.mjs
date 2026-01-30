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

  async getFeed({ sort = 'new', limit = 10 } = {}) {
    const qs = new URLSearchParams();
    if (sort) qs.set('sort', sort);
    if (limit != null) qs.set('limit', String(limit));
    return this._request(`/feed?${qs.toString()}`);
  }

  async getPosts({ sort = 'new', limit = 10, submolt = null } = {}) {
    const qs = new URLSearchParams();
    if (sort) qs.set('sort', sort);
    if (limit != null) qs.set('limit', String(limit));
    if (submolt) qs.set('submolt', submolt);
    return this._request(`/posts?${qs.toString()}`);
  }

  async getPostComments(postId, { sort = 'top' } = {}) {
    if (!postId) throw new Error('postId is required');
    const qs = new URLSearchParams();
    if (sort) qs.set('sort', sort);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this._request(`/posts/${encodeURIComponent(postId)}/comments${suffix}`);
  }

  async addComment(postId, { content, parentId = null } = {}) {
    if (!postId) throw new Error('postId is required');
    if (!content || !String(content).trim()) throw new Error('comment content is required');
    const body = { content: String(content).trim() };
    if (parentId) body.parent_id = parentId;
    return this._request(`/posts/${encodeURIComponent(postId)}/comments`, {
      method: 'POST',
      json: body
    });
  }

  async upvotePost(postId) {
    if (!postId) throw new Error('postId is required');
    return this._request(`/posts/${encodeURIComponent(postId)}/upvote`, { method: 'POST' });
  }

  async downvotePost(postId) {
    if (!postId) throw new Error('postId is required');
    return this._request(`/posts/${encodeURIComponent(postId)}/downvote`, { method: 'POST' });
  }

  async upvoteComment(commentId) {
    if (!commentId) throw new Error('commentId is required');
    return this._request(`/comments/${encodeURIComponent(commentId)}/upvote`, { method: 'POST' });
  }

  async search({ q, limit = 25 } = {}) {
    if (!q) throw new Error('q is required');
    const qs = new URLSearchParams();
    qs.set('q', q);
    if (limit != null) qs.set('limit', String(limit));
    return this._request(`/search?${qs.toString()}`);
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

  /**
   * Moltbook docs describe a success wrapper { success: true, data: {...} }.
   * Some endpoints may return the payload directly; this helper normalizes.
   */
  unwrap(payload) {
    if (payload && typeof payload === 'object' && 'success' in payload && 'data' in payload) {
      return payload.data;
    }
    return payload;
  }
}

export default MoltbookClient;
