/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * X (Twitter) Authentication Service
 * Provides utilities for managing X platform integration
 */

import { TwitterApi } from 'twitter-api-v2';
import { ObjectId } from 'mongodb';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { decrypt, encrypt } from '../../utils/encryption.mjs';
import { filterContent, containsCryptoAddress, checkCashtags } from '../../utils/contentFilter.mjs';
import eventBus from '../../utils/eventBus.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Tolerant decrypt: accepts plaintext or legacy formats, falls back to input on failure
function safeDecrypt(value) {
  try {
    if (!value) return '';
    // If value contains our GCM triplet separator, attempt decrypt; else treat as plaintext
    if (typeof value === 'string' && value.includes(':')) {
      return decrypt(value);
    }
    return String(value);
  } catch {
    // If decryption fails (e.g., rotated key), return as-is to allow user to reauth lazily
    return String(value || '');
  }
}

class XService {
  constructor({
    logger,
    databaseService,
    configService,
    secretsService,
    metricsService,
  }) {
    this.logger = logger;
    this.databaseService = databaseService;
    this.configService = configService;
    this.secretsService = secretsService;
    this.metricsService = metricsService;
    this._usernameCache = new Map();
    this._usernameFetches = new Map();
    
    // Initialize rate limit state (will be loaded from DB on first use)
    this._rateLimitsInitialized = false;
    this._globalRate = null;
  }
  
  /**
   * Initialize rate limiting state from persistent storage.
   * Called lazily on first rate-limited operation.
   * @returns {Promise<void>}
   */
  async _initRateLimitsIfNeeded() {
    if (this._rateLimitsInitialized) return;
    
    try {
      const state = await this._loadRateLimitState('global');
      if (state) {
        const now = Date.now();
        this._globalRate = {
          windowStart: state.windowStart || now,
          count: state.count || 0,
          lastPostedAt: state.lastPostedAt || null,
          rateLimited: state.rateLimited || false,
          rateLimitResetAt: state.rateLimitResetAt || null,
          consecutiveFailures: state.consecutiveFailures || 0
        };
        
        // Check if rate limit has expired since last save
        if (this._globalRate.rateLimited && this._globalRate.rateLimitResetAt) {
          if (now >= this._globalRate.rateLimitResetAt) {
            this._globalRate.rateLimited = false;
            this._globalRate.rateLimitResetAt = null;
            this.logger?.info?.('[XService] Rate limit expired during downtime, resuming normal operation');
          }
        }
        
        // Check if hour window has expired
        const hourMs = 3600_000;
        if (now - this._globalRate.windowStart >= hourMs) {
          this._globalRate.windowStart = now;
          this._globalRate.count = 0;
        }
        
        this.logger?.debug?.('[XService] Loaded persistent rate limit state', {
          count: this._globalRate.count,
          rateLimited: this._globalRate.rateLimited
        });
      }
    } catch (err) {
      this.logger?.warn?.('[XService] Failed to load rate limit state: ' + err.message);
    }
    
    this._rateLimitsInitialized = true;
  }

  /**
   * Create a TwitterApi client with consistent configuration.
   * @param {Object} options - Client options
   * @param {string} [options.accessToken] - OAuth 2.0 access token
   * @param {Object} [options.oauth1Creds] - OAuth 1.0a credentials
   * @returns {TwitterApi|null} Twitter client or null if no credentials
   */
  _createTwitterClient({ accessToken, oauth1Creds } = {}) {
    if (oauth1Creds?.apiKey && oauth1Creds?.accessToken) {
      return new TwitterApi({
        appKey: oauth1Creds.apiKey,
        appSecret: oauth1Creds.apiSecret,
        accessToken: oauth1Creds.accessToken,
        accessSecret: oauth1Creds.accessTokenSecret,
      });
    }
    if (accessToken) {
      return new TwitterApi({ accessToken: String(accessToken).trim() });
    }
    return null;
  }

  /**
   * Get an authenticated Twitter client for an avatar with automatic token refresh.
   * Centralizes auth lookup, decryption, and client creation.
   * @param {Object|string} avatarOrId - Avatar object or avatar ID string
   * @param {Object} [options] - Options
   * @param {boolean} [options.preferOAuth1=false] - Prefer OAuth 1.0a if available (needed for video)
   * @param {boolean} [options.throwOnError=true] - Throw error or return null on failure
   * @returns {Promise<{client: TwitterApi, v2: TwitterApiV2, v1?: TwitterApiV1, auth: Object}|null>}
   */
  async _getAuthenticatedClientForAvatar(avatarOrId, { preferOAuth1 = false, throwOnError = true } = {}) {
    const avatarId = this._normalizeAvatarId(avatarOrId);
    if (!avatarId) {
      if (throwOnError) throw new Error('Invalid avatar ID');
      return null;
    }

    const db = await this.databaseService.getDatabase();
    const auth = await db.collection('x_auth').findOne({ avatarId });
    
    if (!auth?.accessToken) {
      if (throwOnError) throw new Error('X authorization required. Please connect your account.');
      return null;
    }

    // Check if token needs refresh
    if (auth.expiresAt && new Date() >= new Date(auth.expiresAt) && auth.refreshToken) {
      try {
        await this.refreshAccessToken(auth);
        // Re-fetch updated auth
        const refreshedAuth = await db.collection('x_auth').findOne({ avatarId });
        if (refreshedAuth) Object.assign(auth, refreshedAuth);
      } catch (refreshErr) {
        this.logger?.warn?.(`[XService] Token refresh failed for avatar ${avatarId}: ${refreshErr.message}`);
        if (throwOnError) throw new Error('X authorization expired. Please reconnect your account.');
        return null;
      }
    }

    const accessToken = safeDecrypt(auth.accessToken);
    if (!accessToken) {
      if (throwOnError) throw new Error('Failed to decrypt X access token. Please reconnect your X account.');
      return null;
    }

    // Try OAuth 1.0a if preferred and available
    if (preferOAuth1) {
      const oauth1Creds = await this._getOAuth1Credentials();
      if (oauth1Creds) {
        const client = this._createTwitterClient({ oauth1Creds });
        return { client, v2: client.v2, v1: client.v1, auth, isOAuth1: true };
      }
    }

    const client = this._createTwitterClient({ accessToken });
    return { client, v2: client.v2, v1: client.v1, auth, isOAuth1: false };
  }

  /**
   * Get an authenticated Twitter client for global posting/reading.
   * Centralizes global auth resolution, OAuth 1.0a preference, and token decryption.
   * @param {Object} [options] - Options
   * @param {boolean} [options.preferOAuth1=false] - Prefer OAuth 1.0a if available
   * @param {boolean} [options.throwOnError=false] - Throw error or return null on failure
   * @returns {Promise<{client: TwitterApi, v2: TwitterApiV2, v1?: TwitterApiV1, auth: Object, isOAuth1: boolean}|null>}
   */
  async _getAuthenticatedClientForGlobal({ preferOAuth1 = false, throwOnError = false } = {}) {
    const auth = await this._resolveGlobalAuthRecord();
    if (!auth?.accessToken) {
      if (throwOnError) throw new Error('No global X authorization found.');
      return null;
    }

    // Try OAuth 1.0a if preferred
    if (preferOAuth1) {
      const oauth1Creds = await this._getOAuth1Credentials();
      if (oauth1Creds) {
        const client = this._createTwitterClient({ oauth1Creds });
        return { client, v2: client.v2, v1: client.v1, auth, isOAuth1: true };
      }
    }

    const accessToken = safeDecrypt(auth.accessToken);
    if (!accessToken) {
      if (throwOnError) throw new Error('Failed to decrypt global X access token.');
      return null;
    }

    const client = this._createTwitterClient({ accessToken });
    return { client, v2: client.v2, v1: client.v1, auth, isOAuth1: false };
  }

  /**
   * Validate tweet content before sending to API.
   * Pre-flight check to avoid wasted API calls and improve error messages.
   * @param {string} text - Tweet text to validate
   * @param {Object} [options] - Validation options
   * @param {number} [options.maxLength=280] - Maximum character length
   * @param {boolean} [options.allowEmpty=false] - Allow empty content
   * @returns {{valid: boolean, issues: Array<{type: string, message: string, current?: number, max?: number}>}}
   */
  _validateTweetContent(text, { maxLength = 280, allowEmpty = false } = {}) {
    const issues = [];
    const content = String(text ?? '').trim();

    // Empty check
    if (!content && !allowEmpty) {
      issues.push({ type: 'empty', message: 'Tweet content cannot be empty' });
      return { valid: false, issues };
    }

    // Length check
    if (content.length > maxLength) {
      issues.push({ 
        type: 'length', 
        message: `Tweet exceeds ${maxLength} characters`,
        current: content.length, 
        max: maxLength,
        overflow: content.length - maxLength
      });
    }

    // Mention count (X allows max 50 mentions per tweet)
    const mentions = (content.match(/@[A-Za-z0-9_]+/g) || []);
    if (mentions.length > 50) {
      issues.push({ 
        type: 'mentions', 
        message: 'Too many @mentions (max 50)',
        current: mentions.length, 
        max: 50 
      });
    }

    // Hashtag count (warn if > 5, but don't fail)
    const hashtags = (content.match(/#[A-Za-z0-9_]+/g) || []);
    if (hashtags.length > 10) {
      issues.push({ 
        type: 'hashtags', 
        message: 'Excessive hashtags may reduce engagement',
        current: hashtags.length, 
        recommended: 3,
        severity: 'warning'
      });
    }

    // URL count check (each URL counts as ~23 chars in Twitter's calculation)
    const urls = (content.match(/https?:\/\/[^\s]+/g) || []);
    const effectiveLength = content.length + (urls.length * (23 - urls.reduce((sum, url) => sum + url.length, 0) / Math.max(1, urls.length)));
    if (effectiveLength > maxLength && content.length <= maxLength) {
      issues.push({
        type: 'url_length',
        message: 'URLs may cause tweet to exceed limit after t.co shortening',
        severity: 'warning'
      });
    }

    return { 
      valid: issues.filter(i => i.severity !== 'warning').length === 0, 
      issues,
      stats: {
        length: content.length,
        mentions: mentions.length,
        hashtags: hashtags.length,
        urls: urls.length
      }
    };
  }

  /**
   * Format X API error into user-friendly message.
   * @param {Error} apiErr - The API error
   * @param {string} action - The action that failed (e.g., 'posting', 'liking')
   * @returns {string} User-friendly error message
   */
  _formatXApiError(apiErr, action = 'performing action') {
    const code = apiErr?.code || apiErr?.status || apiErr?.statusCode || 
                 apiErr?.data?.errors?.[0]?.code || apiErr?.response?.status;
    
    if (code === 401 || code === 'UNAUTHORIZED') {
      return '-# [ ❌ Error: X authorization expired. Please reconnect your X account. ]';
    }
    if (code === 403 || code === 'FORBIDDEN') {
      return '-# [ ❌ Error: X action forbidden. This may require different permissions. ]';
    }
    if (code === 429 || code === 'TOO_MANY_REQUESTS') {
      return '-# [ ❌ Error: X rate limit reached. Please try again later. ]';
    }
    if (code === 404 || code === 'NOT_FOUND') {
      return `-# [ ❌ Error: The requested X resource was not found. ]`;
    }
    
    const message = apiErr?.data?.detail || apiErr?.data?.errors?.[0]?.message || 
                    apiErr?.message || 'Unknown error';
    return `-# [ ❌ Error ${action}: ${message} ]`;
  }

  /**
   * Execute a social action with centralized auth and error handling.
   * Reduces code duplication in like/repost/block/follow methods.
   * @param {Object} avatar - Avatar object
   * @param {Function} action - Async function (v2Client, myUserId) => result
   * @param {Object} options - Options
   * @param {string} options.actionName - Name for logging/errors
   * @param {boolean} [options.needsMyId=true] - Whether to fetch current user ID
   * @returns {Promise<{success: boolean, result?: any, error?: string}>}
   */
  async _executeSocialAction(avatar, action, { actionName, needsMyId = true } = {}) {
    try {
      const clientResult = await this._getAuthenticatedClientForAvatar(avatar, { throwOnError: false });
      if (!clientResult) {
        return { success: false, error: '-# [ ❌ Error: X authorization required. Please connect your account. ]' };
      }
      
      const { v2: v2Client } = clientResult;
      let myUserId = null;
      
      if (needsMyId) {
        try {
          const me = await v2Client.me();
          myUserId = me?.data?.id;
          if (!myUserId) {
            return { success: false, error: '-# [ ❌ Error: Could not retrieve your X user ID. ]' };
          }
        } catch (meErr) {
          this.logger?.error?.(`[XService][${actionName}] Failed to get current user`, { message: meErr?.message });
          return { success: false, error: this._formatXApiError(meErr, 'getting user info') };
        }
      }
      
      const result = await action(v2Client, myUserId);
      return { success: true, result };
    } catch (apiErr) {
      const avatarId = avatar?._id?.toString() || avatar;
      this.logger?.error?.(`[XService][${actionName}] API error`, { 
        avatarId, 
        code: apiErr?.code || apiErr?.status,
        message: apiErr?.message 
      });
      return { success: false, error: this._formatXApiError(apiErr, actionName) };
    }
  }

  /**
   * Split long content into thread-sized chunks.
   * @param {string} content - Full content to split
   * @param {Object} [options] - Split options
   * @param {number} [options.maxLength=270] - Max chars per tweet (leave room for thread numbering)
   * @param {boolean} [options.preserveWords=true] - Don't break mid-word
   * @returns {string[]} Array of tweet texts
   */
  _splitIntoThread(content, { maxLength = 270, preserveWords = true } = {}) {
    const text = String(content ?? '').trim();
    if (!text) return [];
    if (text.length <= maxLength) return [text];

    const tweets = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        tweets.push(remaining.trim());
        break;
      }

      let splitPoint = maxLength;
      
      if (preserveWords) {
        // Try to find sentence boundary first
        const sentenceEnd = remaining.slice(0, maxLength).search(/[.!?]\s+(?=[A-Z])/);
        if (sentenceEnd > maxLength * 0.5) {
          splitPoint = sentenceEnd + 1;
        } else {
          // Fall back to word boundary
          const lastSpace = remaining.slice(0, maxLength).lastIndexOf(' ');
          if (lastSpace > maxLength * 0.6) {
            splitPoint = lastSpace;
          }
        }
      }

      tweets.push(remaining.slice(0, splitPoint).trim());
      remaining = remaining.slice(splitPoint).trim();
    }

    return tweets;
  }

  /**
   * Post a thread (tweetstorm) to X.
   * Chains multiple tweets together as replies for longer content.
   * @param {Object} avatar - Avatar object
   * @param {string|string[]} content - Long text to thread, or array of pre-split tweets
   * @param {Object} [options] - Thread options
   * @param {boolean} [options.addThreadNumbers=false] - Add "1/n" prefixes
   * @param {string} [options.imageUrl] - Optional image for first tweet only
   * @returns {Promise<{threadId: string, tweetIds: string[], tweetUrls: string[], count: number}>}
   */
  async postThreadToX(avatar, content, options = {}) {
    const { addThreadNumbers = false, imageUrl = null } = options;
    const avatarId = avatar._id?.toString() || avatar;

    // Get authenticated client
    const { v2: v2Client } = await this._getAuthenticatedClientForAvatar(avatar);
    const db = await this.databaseService.getDatabase();

    // Split content into tweets if string, or use as-is if array
    const tweets = Array.isArray(content) 
      ? content.map(t => String(t).trim()).filter(Boolean)
      : this._splitIntoThread(content);

    if (tweets.length === 0) {
      throw new Error('Thread content cannot be empty');
    }

    // If only one tweet, use regular posting
    if (tweets.length === 1 && !imageUrl) {
      const result = await this.postToX(avatar, tweets[0]);
      return { 
        threadId: null, 
        tweetIds: [], 
        tweetUrls: [result], 
        count: 1,
        isThread: false 
      };
    }

    const results = [];
    let previousTweetId = null;
    const username = await this._resolveXUsernameForAvatar(avatar);

    for (let i = 0; i < tweets.length; i++) {
      let text = tweets[i];
      
      // Add thread numbering if requested
      if (addThreadNumbers) {
        text = `${i + 1}/${tweets.length} ${text}`;
      }

      // Validate each tweet
      const validation = this._validateTweetContent(text);
      if (!validation.valid) {
        throw new Error(`Tweet ${i + 1} validation failed: ${validation.issues.map(i => i.message).join(', ')}`);
      }

      // Sanitize
      const sanitizedText = this._sanitizeTweetText(text);
      if (!sanitizedText) {
        throw new Error(`Tweet ${i + 1} content is empty after sanitization`);
      }

      const payload = { text: sanitizedText };

      // Add image to first tweet only
      if (i === 0 && imageUrl) {
        try {
          const res = await fetch(imageUrl);
          if (res.ok) {
            const buffer = Buffer.from(await res.arrayBuffer());
            const mimeType = res.headers.get('content-type')?.split(';')[0] || 'image/png';
            const mediaId = await v2Client.uploadMedia(buffer, {
              media_category: 'tweet_image',
              media_type: mimeType,
            });
            payload.media = { media_ids: [mediaId] };
          }
        } catch (imgErr) {
          this.logger?.warn?.(`[XService][postThreadToX] Failed to attach image: ${imgErr.message}`);
        }
      }

      // Chain as reply after first tweet
      if (previousTweetId) {
        payload.reply = { in_reply_to_tweet_id: previousTweetId };
      }

      try {
        const result = await v2Client.tweet(payload);
        const tweetId = result?.data?.id;
        
        if (!tweetId) {
          throw new Error(`Failed to post tweet ${i + 1} in thread`);
        }

        previousTweetId = tweetId;
        results.push({
          tweetId,
          tweetUrl: this.buildTweetUrl(tweetId, username),
          text: sanitizedText
        });
      } catch (apiErr) {
        const code = apiErr?.code || apiErr?.status;
        this.logger?.error?.(`[XService][postThreadToX] Failed at tweet ${i + 1}/${tweets.length}:`, apiErr?.message);
        
        // If rate limited mid-thread, return partial results
        if (code === 429) {
          this.logger?.warn?.('[XService][postThreadToX] Rate limited mid-thread, returning partial results');
          break;
        }
        throw apiErr;
      }

      // Small delay between tweets to avoid rate limiting
      if (i < tweets.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Store thread in database
    const threadId = results[0]?.tweetId;
    try {
      await db.collection('social_posts').insertOne({
        avatarId: avatar._id,
        type: 'thread',
        threadId,
        tweetIds: results.map(r => r.tweetId),
        content: tweets.join('\n\n---\n\n'),
        tweetCount: results.length,
        imageUrl: imageUrl || null,
        timestamp: new Date(),
        postedToX: true
      });
    } catch (dbErr) {
      this.logger?.warn?.(`[XService][postThreadToX] Failed to store thread record: ${dbErr.message}`);
    }

    this.logger?.info?.(`[XService][postThreadToX] Posted thread with ${results.length} tweets for avatar ${avatar.name || avatarId}`);

    return {
      threadId,
      tweetIds: results.map(r => r.tweetId),
      tweetUrls: results.map(r => r.tweetUrl),
      count: results.length,
      isThread: true
    };
  }

  _normalizeAvatarId(avatarOrId) {
    if (!avatarOrId) return null;
    if (typeof avatarOrId === 'string') return avatarOrId;
    if (typeof avatarOrId === 'object') {
      if (avatarOrId._id) return String(avatarOrId._id);
      if (avatarOrId.avatarId) return String(avatarOrId.avatarId);
    }
    return null;
  }

  _getCachedTwitterUsername(avatarId) {
    if (!avatarId) return null;
    const entry = this._usernameCache.get(avatarId);
    if (entry && entry.expires > Date.now()) {
      return entry.username;
    }
    if (entry) {
      this._usernameCache.delete(avatarId);
    }
    return null;
  }

  _cacheTwitterUsername(avatarId, username, ttlMs = 5 * 60 * 1000) {
    if (!avatarId || !this._isValidTwitterHandle(username)) return;
    this._usernameCache.set(avatarId, {
      username,
      expires: Date.now() + ttlMs
    });
  }

  _isValidTwitterHandle(username) {
    if (!username || typeof username !== 'string') return false;
    return /^[A-Za-z0-9_]{1,15}$/.test(username);
  }

  _isValidTweetId(tweetId) {
    if (!tweetId) return false;
    const idStr = String(tweetId).trim();
    if (!/^\d{15,20}$/.test(idStr)) return false;
    try {
      return BigInt(idStr) > 0n;
    } catch {
      return false;
    }
  }

  isValidTweetId(tweetId) {
    return this._isValidTweetId(tweetId);
  }

  buildTweetUrl(tweetId, username = null) {
    if (!this._isValidTweetId(tweetId)) {
      return null;
    }
    const idStr = String(tweetId).trim();
    if (this._isValidTwitterHandle(username)) {
      return `https://x.com/${username}/status/${idStr}`;
    }
    return `https://x.com/web/status/${idStr}`;
  }

  async _resolveXUsernameForAvatar(avatarOrId) {
    const avatarId = this._normalizeAvatarId(avatarOrId);
    if (!avatarId) return null;

    const cached = this._getCachedTwitterUsername(avatarId);
    if (cached) {
      return cached;
    }

    try {
      const db = await this.databaseService.getDatabase();
      const auth = await db.collection('x_auth').findOne({ avatarId });
      if (!auth) {
        return null;
      }

      const profileUsername = auth?.profile?.username;
      if (this._isValidTwitterHandle(profileUsername)) {
        this._cacheTwitterUsername(avatarId, profileUsername);
        return profileUsername;
      }

      if (!auth?.accessToken) {
        return null;
      }

      if (this._usernameFetches.has(avatarId)) {
        return this._usernameFetches.get(avatarId);
      }

      const fetchPromise = (async () => {
        try {
          // Use centralized client factory - pass avatar object or create minimal one
          const avatar = typeof avatarOrId === 'object' ? avatarOrId : { _id: avatarId };
          const clientResult = await this._getAuthenticatedClientForAvatar(avatar, { throwOnError: false });
          if (!clientResult) return null;
          
          const { v2: clientV2 } = clientResult;
          const me = await clientV2.me({ 'user.fields': 'username,profile_image_url,name,id' });
          const username = me?.data?.username;
          if (this._isValidTwitterHandle(username)) {
            this._cacheTwitterUsername(avatarId, username);
            try {
              await db.collection('x_auth').updateOne(
                { avatarId },
                { $set: { profile: { ...(auth.profile || {}), ...me.data }, updatedAt: new Date() } }
              );
            } catch (e) {
              this.logger?.debug?.('[XService] Failed to persist refreshed X profile:', e.message);
            }
            return username;
          }
        } catch (error) {
          this.logger?.warn?.(`[XService] Failed to resolve X username for avatar ${avatarId}: ${error.message}`);
        }
        return null;
      })();

      this._usernameFetches.set(avatarId, fetchPromise);
      try {
        return await fetchPromise;
      } finally {
        this._usernameFetches.delete(avatarId);
      }
    } catch (error) {
      this.logger?.warn?.(`[XService] Unable to look up X username for avatar ${avatarId}: ${error.message}`);
      return null;
    }
  }

  _sanitizeTweetText(rawText, { fallback = '', maxLength = 280, contentFilters = {} } = {}) {
    const urlRegex = /(https?:\/\/|www\.)[^\s]+/gi;
    const normalized = typeof rawText === 'string' ? rawText : String(rawText ?? '');
    
    // Check for blocked content using filter settings
    const filterEnabled = contentFilters.enabled !== false;
    if (filterEnabled) {
      // Check for cryptocurrency addresses
      if (contentFilters.blockCryptoAddresses !== false && containsCryptoAddress(normalized)) {
        this.logger?.warn?.('[XService] Rejecting tweet containing crypto address');
        return null;
      }
      
      // Check for blocked cashtags
      if (contentFilters.blockCashtags !== false) {
        const cashtagResult = checkCashtags(normalized, contentFilters.allowedCashtags || []);
        if (cashtagResult.hasBlocked) {
          this.logger?.warn?.(`[XService] Rejecting tweet containing blocked cashtags: ${cashtagResult.blocked.join(', ')}`);
          return null;
        }
      }
    }
    
    let cleaned = normalized.replace(urlRegex, ' ').replace(/\s+/g, ' ').trim();

    if (!cleaned && fallback) {
      const fallbackText = typeof fallback === 'string' ? fallback : String(fallback ?? '');
      
      // Also check fallback for blocked content
      if (filterEnabled) {
        if (contentFilters.blockCryptoAddresses !== false && containsCryptoAddress(fallbackText)) {
          this.logger?.warn?.('[XService] Rejecting fallback tweet containing crypto address');
          return null;
        }
        if (contentFilters.blockCashtags !== false) {
          const cashtagResult = checkCashtags(fallbackText, contentFilters.allowedCashtags || []);
          if (cashtagResult.hasBlocked) {
            this.logger?.warn?.(`[XService] Rejecting fallback tweet containing blocked cashtags: ${cashtagResult.blocked.join(', ')}`);
            return null;
          }
        }
      }
      
      cleaned = fallbackText.replace(urlRegex, ' ').replace(/\s+/g, ' ').trim();
    }

    if (!cleaned) return '';
    if (cleaned.length > maxLength) {
      return cleaned.slice(0, maxLength);
    }
    return cleaned;
  }

  // --- Client-side methods (for browser, can be static or moved elsewhere if needed) ---
  async checkXAuthStatus(avatarId) {
    try {
      const response = await fetch(`/api/xauth/status/${avatarId}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to check X authentication status');
      }
      return await response.json();
    } catch (error) {
      this.logger?.error?.('X auth status check error:', error);
      return {
        authorized: false,
        error: error.message,
        requiresReauth: true
      };
    }
  }

  async initiateXAuth(avatarId) {
    try {
      const response = await fetch(`/api/xauth/auth-url?avatarId=${avatarId}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }
      const data = await response.json();
      if (!data.url) {
        throw new Error('No authentication URL returned from server');
      }
      // Open X authentication in a popup window
      const win = typeof globalThis !== 'undefined' ? (globalThis.window || undefined) : undefined;
      if (win && typeof win.open === 'function') {
        const width = 600;
        const height = 650;
        const left = win.screen?.width ? (win.screen.width / 2 - width / 2) : 0;
        const top = win.screen?.height ? (win.screen.height / 2 - height / 2) : 0;
        win.open(
          data.url,
          'xauth_popup',
          `width=${width},height=${height},top=${top},left=${left},resizable=yes,scrollbars=yes`
        );
      }
      return { success: true, message: 'X authentication initiated' };
    } catch (error) {
      this.logger?.error?.('X auth initiation error:', error);
      return { success: false, error: error.message };
    }
  }

  async disconnectXAuth(avatarId) {
    try {
      const response = await fetch(`/api/xauth/disconnect/${avatarId}`, {
        method: 'POST'
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      this.logger?.error?.('X auth disconnect error:', error);
      return { success: false, error: error.message };
    }
  }

  async connectWalletToXAuth(avatarId, walletAddress, signature, message) {
    try {
      const response = await fetch('/api/xauth/connect-wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarId, walletAddress, signature, message })
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      this.logger?.error?.('Connect wallet to X auth error:', error);
      return { success: false, error: error.message };
    }
  }

  // --- Server-side methods ---
  async refreshAccessToken(auth) {
    const db = await this.databaseService.getDatabase();
    const client = new TwitterApi({
      clientId: this.configService.get('X_CLIENT_ID') || process.env.X_CLIENT_ID,
      clientSecret: this.configService.get('X_CLIENT_SECRET') || process.env.X_CLIENT_SECRET,
    });
    try {
  const rt = safeDecrypt(auth.refreshToken || '');
  const { accessToken, refreshToken: newRefreshToken, expiresIn } = await client.refreshOAuth2Token(rt);
      const expiresAt = new Date(Date.now() + ((expiresIn || 7200) * 1000));

      const query = auth?.avatarId ? { avatarId: auth.avatarId } : { _id: auth._id };
      await db.collection('x_auth').updateOne(
        query,
        {
          $set: {
    accessToken: encrypt(accessToken),
    refreshToken: encrypt(newRefreshToken),
            expiresAt,
            updatedAt: new Date(),
          },
        }
      );
      return { accessToken, expiresAt };
    } catch (error) {
      this.logger?.error?.('Token refresh failed:', error.message, { avatarId: auth?.avatarId, authId: auth?._id, global: auth?.global });
      if (error.code === 401 || error.message?.includes('invalid_grant')) {
        const delQuery = auth?.avatarId ? { avatarId: auth.avatarId } : { _id: auth._id };
        await db.collection('x_auth').deleteOne(delQuery);
      }
      throw new Error('Failed to refresh token');
    }
  }

  verifyWalletSignature(message, signature, walletAddress) {
    try {
      const messageBytes = new TextEncoder().encode(message);
      const publicKey = bs58.decode(walletAddress);
      const signatureBytes = Buffer.from(signature, 'hex');
      const isValid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey);
      this.logger?.info?.('Signature verification result:', isValid, { walletAddress });
      return isValid;
    } catch (err) {
      this.logger?.error?.('Signature verification failed:', err.message, { walletAddress });
      return false;
    }
  }

  async isXAuthorized(avatarId) {
    const db = await this.databaseService.getDatabase();
    const auth = await db.collection('x_auth').findOne({ avatarId });
    if (!auth?.accessToken) return false;
    if (new Date() >= new Date(auth.expiresAt) && auth.refreshToken) {
      try { await this.refreshAccessToken(auth); return true; } catch { return false; }
    }
    return new Date() < new Date(auth.expiresAt);
  }

  async postImageToX(avatar, imageUrl, content) {
    const clientResult = await this._getAuthenticatedClientForAvatar(avatar, { throwOnError: false });
    if (!clientResult) {
      return '-# [ ❌ Error: X authorization required. Please connect your account. ]';
    }

    const { v2: clientV2 } = clientResult;
    const avatarId = avatar._id?.toString() || avatar;

    try {
      // 1. Download the image
      const res = await fetch(imageUrl);
      if (!res.ok) throw new Error(`Image fetch failed: ${res.status} ${res.statusText}`);
      const buffer = Buffer.from(await res.arrayBuffer());

      // 2. Determine MIME type or fallback
      const mimeType = res.headers.get('content-type')?.split(';')[0] || 'image/png';

      const mediaId = await clientV2.uploadMedia(buffer, {
        media_category: 'tweet_image',
        media_type: mimeType,
      });

      // 3. Post the tweet with the attached media
      const tweetContent = this._sanitizeTweetText(content);
      if (!tweetContent) {
        throw new Error('Tweet content is empty after removing links. Please provide descriptive text.');
      }
      const tweet = await clientV2.tweet({
        text: tweetContent,
        media: { media_ids: [mediaId] }
      });

      if (!tweet?.data?.id) {
        return '-# [ ❌ Failed to post image to X. ]';
      }

      // 4. Record it in your database
      const tweetId = tweet.data.id;
      if (!this.isValidTweetId(tweetId)) {
        this.logger?.error?.('[XService] Invalid tweet ID returned after posting image', { avatarId, tweetId });
        return '-# [ ✅ Posted image to X but could not confirm the tweet URL. Please verify manually. ]';
      }
      const username = await this._resolveXUsernameForAvatar(avatar);
      const tweetUrl = this.buildTweetUrl(tweetId, username);
      const db = await this.databaseService.getDatabase();
      await db.collection('social_posts').insertOne({
        avatarId: avatar._id,
        content: tweetContent,
        imageUrl,
        timestamp: new Date(),
        postedToX: true,
        tweetId,
        mediaType: 'image'
      });

      return `-# ✨ [ [Posted image to X](${tweetUrl}) ]`;
    } catch (err) {
      this.logger?.error?.('[XService][postImageToX] Error:', err?.message || err);
      return this._formatXApiError(err, 'posting image to X');
    }
  }

  /**
   * Post an image tweet and return structured details for chaining.
   * Returns { tweetId, tweetUrl, content } on success.
   */
  async postImageToXDetailed(avatar, imageUrl, content) {
    const clientResult = await this._getAuthenticatedClientForAvatar(avatar, { throwOnError: true });
    const { v2: clientV2 } = clientResult;
    const avatarId = avatar._id?.toString() || avatar;

    // 1. Download image
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`Image fetch failed: ${res.status} ${res.statusText}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get('content-type')?.split(';')[0] || 'image/png';

    // 2. Upload media and post
    const mediaId = await clientV2.uploadMedia(buffer, {
      media_category: 'tweet_image',
      media_type: mimeType,
    });
    const tweetContent = this._sanitizeTweetText(content);
    if (!tweetContent) {
      throw new Error('Tweet content is empty after removing links. Please provide descriptive text.');
    }
    const tweet = await clientV2.tweet({
      text: tweetContent,
      media: { media_ids: [mediaId] }
    });
    if (!tweet?.data?.id) throw new Error('Failed to post image to X');
    const tweetId = tweet.data.id;
    if (!this.isValidTweetId(tweetId)) {
      this.logger?.error?.('[XService] Invalid tweet ID returned after detailed image post', { avatarId, tweetId });
      throw new Error('Invalid tweet ID returned by X');
    }
    const username = await this._resolveXUsernameForAvatar(avatar);
    const tweetUrl = this.buildTweetUrl(tweetId, username);

    const db = await this.databaseService.getDatabase();
    await db.collection('social_posts').insertOne({
      avatarId: avatar._id,
      content: tweetContent,
      imageUrl,
      timestamp: new Date(),
      postedToX: true,
      tweetId,
      mediaType: 'image'
    });

    return { tweetId, tweetUrl, content: tweetContent };
  }

  /**
   * Reply with an image to a given tweetId.
   */
  async replyWithImageToX(avatar, parentTweetId, imageUrl, content) {
    const clientResult = await this._getAuthenticatedClientForAvatar(avatar, { throwOnError: true });
    const { v2: clientV2 } = clientResult;
    const _avatarId = avatar._id?.toString() || avatar; // eslint: prefixed as unused

    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`Image fetch failed: ${res.status} ${res.statusText}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get('content-type')?.split(';')[0] || 'image/png';
    const mediaId = await clientV2.uploadMedia(buffer, { media_category: 'tweet_image', media_type: mimeType });

    const replyContent = String(content || '').trim().slice(0, 280);
    const result = await clientV2.tweet({
      text: replyContent,
      media: { media_ids: [mediaId] },
      reply: { in_reply_to_tweet_id: parentTweetId }
    });
    if (!result?.data?.id) throw new Error('Failed to post image reply to X');
    
    const db = await this.databaseService.getDatabase();
    await db.collection('social_posts').insertOne({ avatarId: avatar._id, content: replyContent, tweetId: parentTweetId, timestamp: new Date(), postedToX: true, type: 'reply', mediaType: 'image' });
    return result.data.id;
  }

  /**
   * Reply with a video to a given tweetId.
   * Note: Video upload requires OAuth 1.0a which is handled by the client factory.
   */
  async replyWithVideoToX(avatar, parentTweetId, videoUrl, content) {
    const clientResult = await this._getAuthenticatedClientForAvatar(avatar, { throwOnError: true });
    const { v1: v1Client, v2: v2Client } = clientResult;
    const _avatarId = avatar._id?.toString() || avatar; // eslint: prefixed as unused

    const res = await fetch(videoUrl);
    if (!res.ok) throw new Error(`Video fetch failed: ${res.status} ${res.statusText}`);
    let buffer = Buffer.from(await res.arrayBuffer());
    const mimeHeader = res.headers.get('content-type') || '';
    let mimeType = (mimeHeader.split(';')[0] || '').trim() || 'video/mp4';

    // Process video for X compatibility
    try {
      buffer = await this._processVideoForX(buffer);
      mimeType = 'video/mp4';
    } catch (processErr) {
      this.logger?.warn?.('[XService] Video processing failed, attempting upload with original buffer', processErr);
    }

    const mediaId = await v1Client.uploadMedia(buffer, { mimeType });
    const replyContent = String(content || '').trim().slice(0, 280);
    const result = await v2Client.tweet({
      text: replyContent,
      media: { media_ids: [mediaId] },
      reply: { in_reply_to_tweet_id: parentTweetId }
    });
    if (!result?.data?.id) throw new Error('Failed to post video reply to X');
    
    const db = await this.databaseService.getDatabase();
    await db.collection('social_posts').insertOne({ avatarId: avatar._id, content: replyContent, tweetId: parentTweetId, timestamp: new Date(), postedToX: true, type: 'reply', mediaType: 'video' });
    return result.data.id;
  }

  /**
   * Post a video tweet.
   * Note: Video upload requires OAuth 1.0a which is handled by the client factory.
   */
  async postVideoToX(avatar, videoUrl, content) {
    try {
      const clientResult = await this._getAuthenticatedClientForAvatar(avatar, { throwOnError: true });
      const { v1: v1Client, v2: v2Client } = clientResult;
      const avatarId = avatar._id?.toString() || avatar;

      // Download the video
      const res = await fetch(videoUrl);
      if (!res.ok) throw new Error(`Video fetch failed: ${res.status} ${res.statusText}`);
      let buffer = Buffer.from(await res.arrayBuffer());
      const mimeHeader = res.headers.get('content-type') || '';
      let mimeType = (mimeHeader.split(';')[0] || '').trim() || 'video/mp4';

      // Process video for X compatibility
      try {
        buffer = await this._processVideoForX(buffer);
        mimeType = 'video/mp4';
      } catch (processErr) {
        this.logger?.warn?.('[XService] Video processing failed, attempting upload with original buffer', processErr);
      }

      // Upload media (chunked for video)
      const mediaId = await v1Client.uploadMedia(buffer, { mimeType });

      // Post tweet with video
      const tweetContent = this._sanitizeTweetText(content);
      if (!tweetContent) {
        throw new Error('Tweet content is empty after removing links. Please provide descriptive text.');
      }
      const tweet = await v2Client.tweet({ text: tweetContent, media: { media_ids: [mediaId] } });
      if (!tweet?.data?.id) return '-# [ ❌ Failed to post video to X. ]';
      const tweetId = tweet.data.id;
      if (!this.isValidTweetId(tweetId)) {
        this.logger?.error?.('[XService] Invalid tweet ID returned after posting video', { avatarId, tweetId });
        return '-# [ ✅ Posted video to X but could not confirm the tweet URL. Please verify manually. ]';
      }
      const username = await this._resolveXUsernameForAvatar(avatar);
      const tweetUrl = this.buildTweetUrl(tweetId, username);
      
      const db = await this.databaseService.getDatabase();
      await db.collection('social_posts').insertOne({
        avatarId: avatar._id,
        content: tweetContent,
        videoUrl,
        timestamp: new Date(),
        postedToX: true,
        tweetId,
        mediaType: 'video'
      });
      return `-# ✨ [ [Posted video to X](${tweetUrl}) ]`;
    } catch (err) {
      this.logger?.error('Error posting video to X:', err);
      const errorMsg = this._formatXApiError(err);
      return `-# [ ❌ Error: ${errorMsg} ]`;
    }
  }

  async getXTimelineAndNotifications(avatar) {
    const avatarId = avatar._id?.toString() || avatar;
    const clientResult = await this._getAuthenticatedClientForAvatar(avatar, { throwOnError: false });
    if (!clientResult) {
      return { timeline: [], notifications: [], userId: null };
    }
    
    const { v2: v2Client } = clientResult;
    
    try {
      const userData = await v2Client.me();
      
      if (!userData?.data?.id) {
        this.logger?.warn?.('[XService][getXTimelineAndNotifications] Failed to get user data from X API', { avatarId });
        return { timeline: [], notifications: [], userId: null };
      }
      
      const userId = userData.data.id;
      const timelineResp = await v2Client.homeTimeline({ max_results: 30 });
      const notificationsResp = await v2Client.userMentionTimeline(userId, { max_results: 10 });
      const timeline = timelineResp?.data?.data?.map(t => ({ id: t.id, text: t.text, user: t.author_id, isOwn: t.author_id === userId })) || [];
      const notifications = notificationsResp?.data?.data?.map(n => ({ id: n.id, text: n.text, user: n.author_id, isOwn: n.author_id === userId })) || [];
      
      // Save all tweets to DB (batched for performance)
      const allTweets = [...timeline, ...notifications].filter(t => t?.id);
      if (allTweets.length > 0) {
        const db = await this.databaseService.getDatabase();
        const bulkOps = allTweets.map(tweet => ({
          updateOne: {
            filter: { tweetId: tweet.id },
            update: { $set: { tweetId: tweet.id, content: tweet.text, userId: tweet.user, isOwn: tweet.isOwn, avatarId: avatar._id, timestamp: new Date(), postedToX: tweet.isOwn } },
            upsert: true
          }
        }));
        await db.collection('social_posts').bulkWrite(bulkOps, { ordered: false }).catch(err => {
          this.logger?.debug?.('[XService] Bulk save tweets failed:', err?.message);
        });
      }
      
      return { timeline, notifications, userId };
    } catch (apiErr) {
      const code = apiErr?.code || apiErr?.status || apiErr?.statusCode;
      this.logger?.error?.('[XService][getXTimelineAndNotifications] API error', { 
        avatarId, 
        code, 
        message: apiErr?.message 
      });
      // Return empty results instead of throwing
      return { timeline: [], notifications: [], userId: null, error: apiErr?.message };
    }
  }

  // --- X Social Actions ---
  async postToX(avatar, content) {
    const tweetContent = this._sanitizeTweetText(content);
    if (!tweetContent) {
      return '-# [ ❌ Error: Tweet content cannot be empty after removing links. Please add descriptive text. ]';
    }
    
    const clientResult = await this._getAuthenticatedClientForAvatar(avatar, { throwOnError: false });
    if (!clientResult) {
      return '-# [ ❌ Error: X authorization required. Please connect your account. ]';
    }
    
    const { v2: v2Client } = clientResult;
    const avatarId = avatar._id?.toString() || avatar;
    
    try {
      const result = await v2Client.tweet(tweetContent);
      if (!result) return '-# [ ❌ Failed to post to X. ]';
      const tweetId = result.data.id;
      if (!this.isValidTweetId(tweetId)) {
        this.logger?.error?.('[XService] Invalid tweet ID returned after posting text tweet', { avatarId, tweetId });
        return '-# [ ✅ Posted to X but could not confirm the tweet URL. Please verify manually. ]';
      }
      const username = await this._resolveXUsernameForAvatar(avatar);
      const tweetUrl = this.buildTweetUrl(tweetId, username);
      const db = await this.databaseService.getDatabase();
      await db.collection('social_posts').insertOne({ avatarId: avatar._id, content: tweetContent, timestamp: new Date(), postedToX: true, tweetId });
      return `-# ✨ [ [Posted to X](${tweetUrl}) ]`;
    } catch (apiErr) {
      this.logger?.error?.('[XService][postToX] API error', { avatarId, code: apiErr?.code || apiErr?.status, message: apiErr?.message });
      return this._formatXApiError(apiErr, 'posting to X');
    }
  }

  async replyToX(avatar, tweetId, content) {
    const replyContent = this._sanitizeTweetText(content);
    if (!replyContent) {
      return '-# [ ❌ Error: Reply content cannot be empty after removing links. ]';
    }
    
    const clientResult = await this._getAuthenticatedClientForAvatar(avatar, { throwOnError: false });
    if (!clientResult) {
      return '-# [ ❌ Error: X authorization required. Please connect your account. ]';
    }
    
    const { v2: v2Client } = clientResult;
    const avatarId = avatar._id?.toString() || avatar;
    
    try {
      const result = await v2Client.reply(replyContent, tweetId);
      if (!result) return '-# [ ❌ Failed to reply on X. ]';
      const db = await this.databaseService.getDatabase();
      await db.collection('social_posts').insertOne({ avatarId: avatar._id, content: replyContent, tweetId, timestamp: new Date(), postedToX: true, type: 'reply' });
      const targetUrl = this.buildTweetUrl(tweetId);
      const linkText = targetUrl ? `[Replied to post](${targetUrl})` : 'Replied to post';
      return `↩️ ${linkText}: "${replyContent}"`;
    } catch (apiErr) {
      this.logger?.error?.('[XService][replyToX] API error', { avatarId, code: apiErr?.code || apiErr?.status, message: apiErr?.message });
      return this._formatXApiError(apiErr, 'replying on X');
    }
  }

  async quoteToX(avatar, tweetId, content) {
    const quoteContent = this._sanitizeTweetText(content);
    if (!quoteContent) {
      return '-# [ ❌ Error: Quote content cannot be empty after removing links. ]';
    }
    
    const clientResult = await this._getAuthenticatedClientForAvatar(avatar, { throwOnError: false });
    if (!clientResult) {
      return '-# [ ❌ Error: X authorization required. Please connect your account. ]';
    }
    
    const { v2: v2Client } = clientResult;
    const avatarId = avatar._id?.toString() || avatar;
    
    try {
      const result = await v2Client.tweet({ text: quoteContent, quote_tweet_id: tweetId });
      if (!result) return '-# [ ❌ Failed to quote on X. ]';
      const db = await this.databaseService.getDatabase();
      await db.collection('social_posts').insertOne({ avatarId: avatar._id, content: quoteContent, tweetId, timestamp: new Date(), postedToX: true, type: 'quote' });
      const targetUrl = this.buildTweetUrl(tweetId);
      const linkText = targetUrl ? `[Quoted post](${targetUrl})` : 'Quoted post';
      return `📜 ${linkText}: "${quoteContent}"`;
    } catch (apiErr) {
      this.logger?.error?.('[XService][quoteToX] API error', { avatarId, code: apiErr?.code || apiErr?.status, message: apiErr?.message });
      return this._formatXApiError(apiErr, 'quoting on X');
    }
  }

  async followOnX(avatar, userId) {
    const { success, result, error } = await this._executeSocialAction(
      avatar,
      async (v2Client, myUserId) => {
        await v2Client.follow(myUserId, userId);
        return `➕ Followed user ${userId}`;
      },
      { actionName: 'followOnX' }
    );
    return success ? result : error;
  }

  async likeOnX(avatar, tweetId) {
    const { success, result, error } = await this._executeSocialAction(
      avatar,
      async (v2Client, myUserId) => {
        await v2Client.like(myUserId, tweetId);
        const targetUrl = this.buildTweetUrl(tweetId);
        return targetUrl ? `❤️ Liked post ${targetUrl}` : '❤️ Liked post on X';
      },
      { actionName: 'likeOnX' }
    );
    return success ? result : error;
  }

  async repostOnX(avatar, tweetId) {
    const { success, result, error } = await this._executeSocialAction(
      avatar,
      async (v2Client, myUserId) => {
        await v2Client.retweet(myUserId, tweetId);
        const targetUrl = this.buildTweetUrl(tweetId);
        return targetUrl ? `🔁 Reposted ${targetUrl}` : '🔁 Reposted on X';
      },
      { actionName: 'repostOnX' }
    );
    return success ? result : error;
  }

  async blockOnX(avatar, userId) {
    const { success, result, error } = await this._executeSocialAction(
      avatar,
      async (v2Client, myUserId) => {
        await v2Client.block(myUserId, userId);
        return `🚫 Blocked user ${userId}`;
      },
      { actionName: 'blockOnX' }
    );
    return success ? result : error;
  }

  /**
   * Starts scheduled X posting. Call this during app startup.
   * @param {SchedulingService} schedulingService
   * @param {AvatarService} avatarService
   * @param {Object} aiService - must have generateImage(prompt) and generatePostPrompt(avatar) methods
   * @param {number} intervalMs - interval in ms (default: 1 hour)
   */
  startScheduledPosting(schedulingService, avatarService, aiService, intervalMs = 60 * 60 * 1000) {
    if (!schedulingService || !avatarService || !aiService) {
      this.logger?.error?.('[XService] Missing dependencies for scheduled posting');
      return;
    }
    schedulingService.addTask('x-auto-post', async () => {
      try {
        const db = await this.databaseService.getDatabase();
        // Get all authenticated avatars
        const xAuths = await db.collection('x_auth').find({ accessToken: { $exists: true, $ne: null } }).toArray();
        if (!xAuths.length) return;
        // Pick one at random
        const xAuth = xAuths[Math.floor(Math.random() * xAuths.length)];
        const avatar = await avatarService.getAvatarById(xAuth.avatarId);
        if (!avatar) return;
        // Generate post prompt and image
        let postPrompt;
        if (aiService.generatePostPrompt) {
          postPrompt = await aiService.generatePostPrompt(avatar);
        } else {
          postPrompt = `A moment from the life of ${avatar.name}`;
        }
        let imageUrl;
        if (aiService.generateImage) {
          imageUrl = await aiService.generateImage(postPrompt);
        }
        if (!imageUrl) return;
        // Post to X
        await this.postImageToX(avatar, imageUrl, postPrompt);
        this.logger?.info?.(`[XService] Scheduled X post for avatar ${avatar.name}`);
      } catch (err) {
        this.logger?.error?.('[XService] Scheduled X posting error:', err);
      }
    }, intervalMs);
    this.logger?.info?.('[XService] Scheduled X posting enabled');
  }

  /**
   * Post a media update (image or video) from the GLOBAL account (not per-avatar auth) when enabled.
   * Primary control now sourced from `x_post_config` collection (document id "global"):
   *   {
   *     _id: 'global',
   *     enabled: true,
  *     (DEPRECATED) globalAvatarId: <removed – global account now inferred automatically>,
   *     media: { altAutogen: true },
   *     rate: { hourly: 5 },
   *     hashtags: ['CosyWorld'],
   *     mode: 'live' | 'shadow'
   *   }
   * If the config doc is missing, we fallback to legacy env gating for backward compatibility.
   * @param {Object} opts
   * @param {string} opts.mediaUrl - Direct URL to image/video (fetchable over HTTP(S))
   * @param {string} opts.text - Primary tweet text (will be truncated to 280 chars)
   * @param {string} [opts.altText] - Optional alt text override (<= 1000 chars)
   * @param {('image'|'video')} [opts.type='image'] - Media type
   * @param {Object} [services] - Optional dependency bag { aiService }
   * @returns {Promise<{tweetId:string,tweetUrl:string} | null>} null when gated/disabled
   */
  async postGlobalMediaUpdate(opts = {}, services = {}) {
    try {
      // Get content filter settings - try to get from globalBotService if available
      const contentFilters = services.globalBotService?.bot?.globalBotConfig?.contentFilters || opts.contentFilters || {};
      const filterEnabled = contentFilters.enabled !== false;
      
      this.logger?.debug?.('[XService] Content filters check:', {
        hasGlobalBotService: !!services.globalBotService,
        hasOptsFilters: !!opts.contentFilters,
        allowedCashtags: contentFilters.allowedCashtags,
        filterEnabled
      });

      // Check for blocked content in text before processing
      if (filterEnabled) {
        const contentFilter = filterContent(opts.text || '', {
          logger: this.logger,
          blockCryptoAddresses: contentFilters.blockCryptoAddresses !== false,
          blockCashtags: contentFilters.blockCashtags !== false,
          allowedCashtags: contentFilters.allowedCashtags || [],
          allowedAddresses: contentFilters.allowedAddresses || []
        });
        
        if (contentFilter.blocked) {
          this.logger?.warn?.(`[XService][globalPost] Rejected post: ${contentFilter.reason}`);
          return { error: true, reason: contentFilter.reason };
        }
      }
      
      // Debug-level invocation trace for operator diagnostics
      this.logger?.debug?.('[XService][globalPost] attempt', {
        mediaUrl: opts.mediaUrl,
        type: opts.type || 'image'
      });
      this.logger?.debug?.('[XService][globalPost] invoked', {
        mediaUrl: opts.mediaUrl,
        type: opts.type || 'image',
        textLen: opts.text ? String(opts.text).length : 0
      });
      // Early trace of environment + minimal opts for support diagnostics
      if (process.env.DEBUG_GLOBAL_X === '1') {
        this.logger?.debug?.('[XService][globalPost][diag] envFlags', {
          X_GLOBAL_POST_ENABLED: process.env.X_GLOBAL_POST_ENABLED,
          X_GLOBAL_POST_HOURLY_CAP: process.env.X_GLOBAL_POST_HOURLY_CAP,
          X_GLOBAL_POST_MIN_INTERVAL_SEC: process.env.X_GLOBAL_POST_MIN_INTERVAL_SEC,
          hasAIService: !!services.aiService,
          hasAnalyzeImage: !!services.aiService?.analyzeImage
        });
      }
      // Initialize metrics bucket lazily (in-memory only). If process restarts, counters reset.
      if (!this._globalPostMetrics) {
        this._globalPostMetrics = {
          attempts: 0,
          posted: 0,
          last: null,
          reasons: {
            posted: 0,
            disabled: 0,
            no_access_token: 0,
            invalid_media_url: 0,
            hourly_cap: 0,
            min_interval: 0,
            unsupported_video: 0,
            rate_limited: 0,
            error: 0,
            guild_override: 0
          }
        };
      }
      const _bump = (reason, meta = {}) => {
        try {
          this._globalPostMetrics.attempts++;
          if (reason === 'posted') this._globalPostMetrics.posted++;
          if (this._globalPostMetrics.reasons[reason] !== undefined) {
            this._globalPostMetrics.reasons[reason]++;
          }
          this._globalPostMetrics.last = { at: Date.now(), reason, ...meta };
        } catch {}
      };
      let config = await this._loadGlobalPostingConfig();
      // Fallback enablement: if no config doc exists, treat as enabled unless X_GLOBAL_POST_ENABLED explicitly set false/0.
      let enabled;
      if (!config) {
        const rawFlag = (process.env.X_GLOBAL_POST_ENABLED || '').trim().toLowerCase();
        enabled = rawFlag ? !['false','0','off','disabled'].includes(rawFlag) : true; // default enabled when absent
        config = { enabled };
        if (enabled) {
          this.logger?.debug?.('[XService][globalPost] proceeding with implicit enabled (no config doc; using env/default)');
        } else {
          this.logger?.debug?.('[XService][globalPost] disabled via X_GLOBAL_POST_ENABLED env override');
        }
      } else {
        enabled = !!config.enabled;
      }
      if (process.env.DEBUG_GLOBAL_X === '1') {
        this.logger?.debug?.('[XService][globalPost][diag] loadedConfig', { enabled, configKeys: Object.keys(config || {}) });
      }
      if (!enabled) {
        this.logger?.debug?.('[XService][globalPost] skip: disabled', { mediaUrl: opts.mediaUrl });
        this._lastGlobalPostAttempt = { at: Date.now(), skipped: true, reason: 'disabled', mediaUrl: opts.mediaUrl };
        _bump('disabled', { mediaUrl: opts.mediaUrl });
        return { error: true, reason: 'X posting is disabled' };
      }

      // Account selection order (if guildId provided):
      // 1. Per-guild override (xAccounts.imageAuthId / xAccounts.videoAuthId)
      // 2. Global-marked account (x_auth.global = true)
      // 3. Most recently updated generic auth record
      // ADMIN_AVATAR_ID & globalAvatarId are deprecated – automatic inference reduces configuration burden.
      let accessToken = null;
      let authRecord = null;
      const guildId = opts.guildId || null;
      try {
        const db = await this.databaseService.getDatabase();
        let overrideAuthId = null;
        if (guildId) {
          try {
            const guildCfg = await db.collection('guild_configs').findOne({ guildId });
            const isVideoType = (opts.type === 'video');
            overrideAuthId = guildCfg?.xAccounts && (isVideoType ? guildCfg.xAccounts.videoAuthId : guildCfg.xAccounts.imageAuthId) || null;
            if (overrideAuthId) {
              try {
                const oid = ObjectId.createFromHexString(String(overrideAuthId));
                const rec = await db.collection('x_auth').findOne({ _id: oid });
                if (rec?.accessToken) {
                  authRecord = rec;
                  accessToken = safeDecrypt(rec.accessToken);
                  this.logger?.debug?.('[XService][globalPost] using per-guild override account', { guildId, overrideAuthId, isVideoType });
                }
              } catch (oidErr) {
                this.logger?.warn?.('[XService][globalPost] invalid overrideAuthId for guild ' + guildId + ': ' + oidErr.message);
              }
            }
          } catch (gErr) {
            this.logger?.warn?.('[XService][globalPost] guild override lookup failed: ' + gErr.message);
          }
        }
        if (!authRecord) {
          // 1. Prefer an auth marked global
          authRecord = await db.collection('x_auth').findOne({ global: true }, { sort: { updatedAt: -1 } });
          if (authRecord) {
            this.logger?.debug?.('[XService][globalPost] Found global auth record', { avatarId: authRecord.avatarId, hasToken: !!authRecord.accessToken });
          }
        }
        if (!authRecord) {
          // 2. Fallback to most recently updated auth record with a token
          authRecord = await db.collection('x_auth').findOne({ accessToken: { $exists: true, $ne: null } }, { sort: { updatedAt: -1 } });
          if (authRecord) {
            this.logger?.debug?.('[XService][globalPost] Found fallback auth record', { avatarId: authRecord.avatarId, hasToken: !!authRecord.accessToken });
          } else {
            // Log all x_auth records for debugging
            const allRecords = await db.collection('x_auth').find({}).limit(5).toArray();
            this.logger?.warn?.('[XService][globalPost] No auth records with accessToken found. Records in DB:', 
              allRecords.map(r => ({ avatarId: r.avatarId, hasToken: !!r.accessToken, global: r.global, updatedAt: r.updatedAt }))
            );
          }
        }
        if (authRecord?.accessToken) {
          if (!accessToken) accessToken = safeDecrypt(authRecord.accessToken);
          this.logger?.debug?.('[XService][globalPost] resolved access token', { avatarId: authRecord.avatarId || null, global: !!authRecord.global, guildOverride: !!guildId && !!overrideAuthId });
          if (process.env.DEBUG_GLOBAL_X === '1') {
            this.logger?.debug?.('[XService][globalPost][diag] authRecord', { hasRefresh: !!authRecord.refreshToken, expiresAt: authRecord.expiresAt, profileCached: !!authRecord.profile, guildOverride: !!guildId });
          }
          if (guildId && overrideAuthId) {
            try { this._globalPostMetrics.reasons.guild_override++; } catch {}
          }
        } else if (!accessToken) {
          this.logger?.warn?.('[XService][globalPost] No X auth record found (global or override).');
        }
      } catch (e) {
        this.logger?.warn?.('[XService][globalPost] auth resolution failed: ' + e.message);
      }
      if (!accessToken) {
        this._lastGlobalPostAttempt = { at: Date.now(), skipped: true, reason: 'no_access_token', mediaUrl: opts.mediaUrl };
        this.logger?.warn?.('[XService][globalPost] No X access token available. Authorize at least one X account.');
        _bump('no_access_token', { mediaUrl: opts.mediaUrl });
        return { error: true, reason: 'X account not authorized - credits may be 0' };
      }
      const { mediaUrl, text, altText: rawAlt, type = 'image' } = opts;
      
      // Allow text-only posts if mediaUrl is missing but text is present
      const hasMedia = mediaUrl && /^https?:\/\//i.test(mediaUrl);
      
      if (!hasMedia && !text) {
        this._lastGlobalPostAttempt = { at: Date.now(), skipped: true, reason: 'invalid_content', mediaUrl };
        this.logger?.warn?.('[XService][globalPost] No mediaUrl and no text provided');
        _bump('invalid_content', { mediaUrl });
        return { error: true, reason: 'No media or text content to post' };
      }

      // Initialize rate limits from persistent storage if needed
      await this._initRateLimitsIfNeeded();
      
      // Hour bucket limiter with persistent state
      const now = Date.now();
      if (!this._globalRate) this._globalRate = { windowStart: now, count: 0, consecutiveFailures: 0 };
      
      // Check if we're currently rate limited
      if (this._globalRate.rateLimited && this._globalRate.rateLimitResetAt) {
        if (now < this._globalRate.rateLimitResetAt) {
          const waitSec = Math.ceil((this._globalRate.rateLimitResetAt - now) / 1000);
          this.logger?.warn?.(`[XService][globalPost] Still rate limited. Wait ${Math.ceil(waitSec / 60)} minutes before posting again.`);
          this._lastGlobalPostAttempt = { 
            at: Date.now(), 
            skipped: true, 
            reason: 'rate_limited', 
            waitSec, 
            mediaUrl 
          };
          _bump('rate_limited', { mediaUrl, waitSec });
          return { error: true, reason: `X rate limited - wait ${Math.ceil(waitSec / 60)} minutes` };
        } else {
          // Rate limit has expired, clear it
          this._globalRate.rateLimited = false;
          this._globalRate.rateLimitResetAt = null;
          this._globalRate.consecutiveFailures = 0;
          this.logger?.info?.('[XService][globalPost] Rate limit expired, resuming normal operation');
          
          // Save cleared state
          this._saveRateLimitState('global', this._globalRate).catch(() => {});
          
          // Update health status
          this.metricsService?.recordHealth('xService', {
            status: 'healthy',
            message: 'Rate limit expired, normal operation resumed'
          });
        }
      }
      
      const hourMs = 3600_000;
      if (now - this._globalRate.windowStart >= hourMs) {
        this._globalRate.windowStart = now; this._globalRate.count = 0;
      }
  const hourlyCap = (() => {
        const envCap = Number(process.env.X_GLOBAL_POST_HOURLY_CAP);
        if (!Number.isNaN(envCap) && envCap > 0) return envCap;
        if (config?.rate?.hourly && Number(config.rate.hourly) > 0) return Number(config.rate.hourly);
        return 10; // default
      })();
      // Enforce a minimum time between successful posts to avoid burst rate limits
      const minIntervalSec = (() => {
        const envSec = Number(process.env.X_GLOBAL_POST_MIN_INTERVAL_SEC);
        if (!Number.isNaN(envSec) && envSec > 0) return envSec;
        if (config?.rate?.minIntervalSec && Number(config.rate.minIntervalSec) > 0) return Number(config.rate.minIntervalSec);
        return 180; // default to 3 minutes
      })();
      if (this._globalRate.lastPostedAt && (now - this._globalRate.lastPostedAt) < (minIntervalSec * 1000)) {
        const nextInMs = (minIntervalSec * 1000) - (now - this._globalRate.lastPostedAt);
        this._lastGlobalPostAttempt = { at: Date.now(), skipped: true, reason: 'min_interval', mediaUrl, waitMs: nextInMs };
        this.logger?.debug?.(`[XService][globalPost] Min-interval gating: wait ${Math.ceil(nextInMs/1000)}s before next post`);
        _bump('min_interval', { mediaUrl, minIntervalSec });
        return { error: true, reason: `X cooldown - wait ${Math.ceil(nextInMs/1000)}s` };
      }
      if (this._globalRate.count >= hourlyCap) {
        this._lastGlobalPostAttempt = { at: Date.now(), skipped: true, reason: 'hourly_cap', mediaUrl };
        this.logger?.debug?.(`[XService][globalPost] Hourly cap reached (${hourlyCap}) – skipping.`);
        _bump('hourly_cap', { mediaUrl, hourlyCap });
        return { error: true, reason: 'X hourly post limit reached' };
      }
      if (process.env.DEBUG_GLOBAL_X === '1') {
        this.logger?.debug?.('[XService][globalPost][diag] proceeding', { mediaUrl, isVideo: type === 'video', hourlyCount: this._globalRate.count });
      }
      
      let mediaId = null;
      let isVideo = type === 'video';
      accessToken = safeDecrypt(authRecord.accessToken);

      let refreshed = false;
      let altText = null;
      let v2Active = null;

      if (hasMedia) {
        this.logger?.debug?.('[XService][globalPost] proceeding to fetch media');

        const twitterClient = new TwitterApi({ accessToken: accessToken.trim() });
        const v2 = twitterClient.v2;

        // Pre-flight validation: ensure token still valid; if 401 and we can refresh, attempt once.
        refreshed = false;
        try {
          await v2.me();
        } catch (preErr) {
          const unauthorized = preErr?.code === 401 || preErr?.status === 401 || /401/.test(preErr?.message || '');
          if (unauthorized && authRecord?.refreshToken && authRecord?.avatarId) {
            if (process.env.DEBUG_GLOBAL_X === '1') this.logger?.info?.('[XService][globalPost][diag] preflight unauthorized -> refresh attempt');
            try {
              const { accessToken: newToken } = await this.refreshAccessToken(authRecord);
              accessToken = newToken;
              refreshed = true;
            } catch (rErr) {
              this.logger?.warn?.('[XService][globalPost] preflight token refresh failed: ' + rErr.message);
            }
          }
        }
        // If refreshed, rebuild clients
        let workingClient = twitterClient;
        if (refreshed) {
          workingClient = new TwitterApi({ accessToken: accessToken.trim() });
        }
        v2Active = workingClient.v2;

        // Try OAuth 1.0a first if available (required for media upload)
        const oauth1Creds = await this._getOAuth1Credentials();
        let useOAuth1 = false;
        let oauth1Client = null;
        
        if (oauth1Creds) {
          this.logger?.debug?.('[XService][globalPost] using OAuth 1.0a credentials for upload');
          useOAuth1 = true;
          oauth1Client = new TwitterApi({
            appKey: oauth1Creds.apiKey,
            appSecret: oauth1Creds.apiSecret,
            accessToken: oauth1Creds.accessToken,
            accessSecret: oauth1Creds.accessTokenSecret,
          });
        }

        // If attempting video with an OAuth2 PKCE token (no accessSecret present) we may hit v1 media upload auth limitations.
        // However, if we have system-level OAuth 1.0a credentials (oauth1Creds), we can use those instead.
        if (isVideo && authRecord && !authRecord.accessSecret && !useOAuth1) {
          // If guild override was attempted, note explicitly
          if (guildId) {
            this.logger?.info?.('[XService][globalPost] skip: unsupported video for guild override (OAuth2 bearer; need OAuth1)', { mediaUrl, guildId });
          } else {
            this.logger?.info?.('[XService][globalPost] skip: unsupported video with OAuth2 bearer token (no accessSecret)', { mediaUrl });
          }
          this._lastGlobalPostAttempt = { at: Date.now(), skipped: true, reason: 'unsupported_video', mediaUrl, guildId: guildId || null };
          try { this._globalPostMetrics.reasons.unsupported_video++; } catch {}
          return { error: true, reason: 'Video posting requires OAuth1 credentials' };
        }

        // Fetch media
        const res = await fetch(mediaUrl);
        if (!res.ok) throw new Error(`media fetch failed ${res.status}`);
        let buffer = Buffer.from(await res.arrayBuffer());
        const contentType = res.headers.get('content-type');
        let mimeType = contentType?.split(';')[0]?.trim();
        
        // Ensure mimeType has a valid fallback
        if (!mimeType) {
          mimeType = isVideo ? 'video/mp4' : 'image/png';
          this.logger?.warn?.('[XService][globalPost] no content-type header, using fallback', { mimeType, mediaUrl });
        }

        // Process video if needed
        if (isVideo) {
          try {
            buffer = await this._processVideoForX(buffer);
            mimeType = 'video/mp4'; // Force mp4 after processing
          } catch (processErr) {
            this.logger?.warn?.('[XService][globalPost] Video processing failed, attempting upload with original buffer', processErr);
          }
        }

        // Use proper v2 chunked upload: INIT -> APPEND -> FINALIZE (-> STATUS if needed)
        // CRITICAL: X's upload endpoints work differently based on auth type:
        // - OAuth 2.0 bearer tokens: Only work with twitter-api-v2 library's convenience methods (NOT raw API calls)
        // - OAuth 1.0a: Works with both library methods and raw API calls
        // The library handles the OAuth2 -> internal conversion magic
        
        if (useOAuth1 && oauth1Client) {
          try {
            mediaId = await oauth1Client.v1.uploadMedia(buffer, { mimeType });
            this.logger?.debug?.('[XService][globalPost] OAuth 1.0a upload success', { mediaId });
          } catch (oauth1Err) {
            const authCode = oauth1Err?.code ?? oauth1Err?.status;
            if (isVideo && authCode === 401) {
              this.logger?.error?.('[XService][globalPost] VIDEO AUTH ALERT: OAuth 1.0a credentials rejected (401). Regenerate access token + secret before posting again.', {
                guildId: guildId || null,
                avatarId: authRecord?.avatarId || null
              });
            }
            this.logger?.error?.('[XService][globalPost] OAuth 1.0a upload failed', {
              message: oauth1Err?.message,
              code: oauth1Err?.code
            });
            throw oauth1Err;
          }
        } else {
          // Fallback to OAuth 2.0 (will likely fail for media upload)
          this.logger?.warn?.('[XService][globalPost] No OAuth 1.0a credentials found, trying OAuth 2.0 (may fail)');
          try {
          // IMPORTANT: Must pass accessToken as an object { accessToken } not a string
          const twitterClient = new TwitterApi({ accessToken: accessToken.trim() });
          const clientV2 = twitterClient.v2;
          
          if (isVideo) {
            this.logger?.debug?.('[XService][globalPost] uploading video via library v1', { mimeType, bufferSize: buffer.length });
            mediaId = await twitterClient.v1.uploadMedia(buffer, { mimeType });
          } else {
            this.logger?.debug?.('[XService][globalPost] uploading image via library v2', { mimeType, bufferSize: buffer.length });
            // Use the same pattern as postImageToX which works with OAuth2
            mediaId = await clientV2.uploadMedia(buffer, {
              media_category: 'tweet_image',
              media_type: mimeType,
            });
          }
          this.logger?.debug?.('[XService][globalPost] upload success', { mediaId });
          } catch (uploadErr) {
            // Log detailed error information for debugging
            this.logger?.error?.('[XService][globalPost] media upload error details', {
            message: uploadErr?.message,
            code: uploadErr?.code,
            status: uploadErr?.status,
            data: uploadErr?.data,
            errors: uploadErr?.data?.errors,
            type: uploadErr?.type,
            stack: uploadErr?.stack?.split('\n')[0]
          });
          
          const code = uploadErr?.code || uploadErr?.status || uploadErr?.data?.errors?.[0]?.code;
          if (code === 215) {
            this.logger?.error?.('[XService][globalPost] media upload auth error (code 215). Likely unsupported auth method for this media type.', { hint: 'Use OAuth1.0a credentials for video or restrict to images.' });
            try {
              const db = await this.databaseService.getDatabase();
              await db.collection('x_auth').updateOne({ _id: authRecord?._id }, { $set: { error: 'media_upload_bad_auth', lastErrorAt: new Date() } });
            } catch {}
          } else if (code === 401) {
            // Unauthorized during media upload. Most common cause: missing media.write scope or revoked token.
            this.logger?.error?.('[XService][globalPost] media upload 401 Unauthorized. Likely causes: missing media.write scope or revoked/expired token.', { hint: 'Re-authorize admin X account via /admin (Connect) to grant media.write scope.' });
            // Persist a hint for admin UIs
            try {
              const db = await this.databaseService.getDatabase();
              await db.collection('x_auth').updateOne({ _id: authRecord?._id }, { $set: { error: 'unauthorized_media_upload', lastErrorAt: new Date() } });
            } catch {}
            // Attempt a one-time refresh + retry if we have a refreshToken (PKCE OAuth2) and avatarId present
            if (authRecord?.refreshToken && authRecord?.avatarId) {
              try {
                const { accessToken: newToken } = await this.refreshAccessToken(authRecord);
                accessToken = newToken;
                this.logger?.debug?.('[XService][globalPost] retrying media upload after refresh');
                const retryTwitterClient = new TwitterApi({ accessToken: accessToken.trim() });
                const retryClientV2 = retryTwitterClient.v2;
                if (isVideo) {
                  mediaId = await retryTwitterClient.v1.uploadMedia(buffer, { mimeType });
                } else {
                  // Use v2 for images, same as postImageToX
                  mediaId = await retryClientV2.uploadMedia(buffer, {
                    media_category: 'tweet_image',
                    media_type: mimeType,
                  });
                }
              } catch (retryErr) {
                this.logger?.error?.('[XService][globalPost] media upload retry failed after refresh', retryErr?.message || retryErr);
                throw retryErr;
              }
            } else {
              throw uploadErr;
            }
          } else {
            this.logger?.error?.('[XService][globalPost] media upload failed', uploadErr?.message || uploadErr);
          }
          throw uploadErr;
          }
        }
        
        if (!mediaId) throw new Error('upload failed');

        // Alt text (images only)
        altText = rawAlt;
        if (!altText && !isVideo && services.aiService?.analyzeImage) {
          try {
            altText = await services.aiService.analyzeImage(mediaUrl, mimeType, 'Provide concise accessible alt text (<=240 chars).');
            if (altText) altText = String(altText).slice(0, 1000);
          } catch (e) { this.logger?.warn?.(`[XService][globalPost] alt generation failed: ${e.message}`); }
        }
        if (altText && !isVideo) {
          try {
            // Use OAuth 1.0a client if available, otherwise OAuth 2.0
            const metadataClient = useOAuth1 && oauth1Client ? oauth1Client.v2 : v2Active;
            // Twitter API requires alt_text to be wrapped in an object with a 'text' property
            await metadataClient.createMediaMetadata(mediaId, { 
              alt_text: { 
                text: altText.slice(0, 1000) 
              } 
            });
          } catch (e) {
            this.logger?.warn?.(`[XService][globalPost] set alt text failed: ${e.message}`);
          }
        }
      }

      // Caption generation: if no text provided, attempt AI caption (image/video aware)
      let baseText = String(text || '').trim();
      if (!baseText && hasMedia && services.aiService?.analyzeImage && !isVideo) {
        try {
          // Use context-aware prompts based on source and available data
          let captionPrompt;
          
          if (opts.source === 'avatar.create' && opts.avatarName) {
            // Special handling for avatar introductions
            captionPrompt = `This is an introduction image for a new character in CosyWorld: ${opts.avatarEmoji || ''} ${opts.avatarName}.
Description: ${opts.prompt || 'A mysterious new arrival'}

Create a warm, welcoming introduction tweet (max 240 chars) that:
- Captures their essence and personality
- Makes people curious about them
- Uses a friendly, narrator-like tone
- Highlights what makes them unique

Do not use quotes or extra hashtags. Be conversational and engaging.`;
          } else {
            // General media caption
            captionPrompt = 'Analyze this image and create an engaging tweet (max 250 chars). Focus on what makes it interesting, unique, or worth sharing. Use a conversational, authentic tone. Avoid generic descriptions. No quotes or extra hashtags.';
          }
          
          const caption = await services.aiService.analyzeImage(
            mediaUrl,
            'image/png', // Default if we don't have it handy here, or pass mimeType from above if we refactor
            captionPrompt
          );
          if (caption) baseText = String(caption).replace(/[#\n\r]+/g, ' ').trim();
        } catch (e) { 
          this.logger?.warn?.('[XService][globalPost] caption generation failed: ' + e.message);
          // Fallback to simple text if AI fails
          if (!baseText) baseText = '';
        }
      }
      
      // If we have text but it looks like a simple description, enhance it with AI
      if (baseText && baseText.length < 100 && hasMedia && services.aiService?.analyzeImage && !isVideo && opts.source !== 'avatar.create') {
        try {
          this.logger?.debug?.('[XService][globalPost] enhancing short text with AI analysis');
          const enhancement = await services.aiService.analyzeImage(
            mediaUrl,
            'image/png',
            `The image context is: "${baseText}". Create an engaging tweet (max 250 chars) that expands on this context. Make it interesting and share-worthy. Use a natural, conversational tone. No extra hashtags or quotes.`
          );
          if (enhancement) baseText = String(enhancement).replace(/[#\n\r]+/g, ' ').trim();
        } catch (e) {
          this.logger?.debug?.('[XService][globalPost] text enhancement failed, using original: ' + e.message);
        }
      }
      
      if (!baseText) baseText = '';
      // Ensure single hashtag #CosyWorld appended (unless already present case-insensitively)
      if (!/#cosyworld/i.test(baseText)) {
        baseText = (baseText).trim();
      }
      
      // Smart truncation: if text is over 280 chars, try to truncate at sentence boundary
      let tweetText = baseText;
      if (tweetText.length > 280) {
        this.logger?.debug?.('[XService][globalPost] tweet too long, attempting smart truncation', { length: tweetText.length });
        
        // Try to find the last complete sentence before 280 chars
        const truncated = tweetText.slice(0, 280);
        const sentenceEndings = ['. ', '! ', '? '];
        let lastSentenceEnd = -1;
        
        for (const ending of sentenceEndings) {
          const pos = truncated.lastIndexOf(ending);
          if (pos > lastSentenceEnd) {
            lastSentenceEnd = pos;
          }
        }
        
        // If we found a sentence ending and it's not too short (at least 100 chars), use it
        if (lastSentenceEnd > 100) {
          tweetText = truncated.slice(0, lastSentenceEnd + 1).trim();
          // Re-add #CosyWorld if it got cut off
          if (!/#cosyworld/i.test(tweetText) && tweetText.length < 268) {
            tweetText = (tweetText).trim();
          }
          this.logger?.debug?.('[XService][globalPost] truncated at sentence boundary', { newLength: tweetText.length });
        } else {
          // No good sentence boundary found, try to regenerate with strict length limit
          this.logger?.debug?.('[XService][globalPost] no sentence boundary found, attempting regeneration');
          if (hasMedia && services.aiService?.analyzeImage && !isVideo) {
            try {
              const regeneratePrompt = `Previous tweet was too long. Create a concise, engaging tweet about this image (MAX 250 chars including spaces). 
Make it punchy and complete. No quotes. Natural tone. Must be UNDER 250 characters total.`;
              
              const newCaption = await services.aiService.analyzeImage(
                mediaUrl,
                'image/png',
                regeneratePrompt
              );
              
              if (newCaption) {
                let shortened = String(newCaption).replace(/[#\n\r]+/g, ' ').trim();
                // Add hashtag if not present
                if (!/#cosyworld/i.test(shortened)) {
                  shortened = (shortened).trim();
                }
                // If still too long, hard truncate at sentence
                if (shortened.length > 280) {
                  const trunc = shortened.slice(0, 280);
                  for (const ending of sentenceEndings) {
                    const pos = trunc.lastIndexOf(ending);
                    if (pos > 100) {
                      shortened = trunc.slice(0, pos + 1).trim();
                      break;
                    }
                  }
                  if (shortened.length > 280) {
                    shortened = trunc.slice(0, 277) + '...';
                  }
                }
                tweetText = shortened;
                this.logger?.debug?.('[XService][globalPost] regenerated shorter tweet', { newLength: tweetText.length });
              } else {
                // AI regeneration failed, hard truncate with ellipsis
                tweetText = truncated.slice(0, 277) + '...';
              }
            } catch (regenErr) {
              this.logger?.warn?.('[XService][globalPost] tweet regeneration failed:', regenErr.message);
              // Fallback to hard truncate with ellipsis
              tweetText = truncated.slice(0, 277) + '...';
            }
          } else {
            // No AI available, hard truncate with ellipsis
            tweetText = truncated.slice(0, 277) + '...';
          }
        }
      }
      
      // Final safety check and sanitization (strip any lingering links)
      if (tweetText.length > 280) {
        tweetText = tweetText.slice(0, 280);
      }
      tweetText = this._sanitizeTweetText(tweetText, { 
        fallback: opts.context || opts.prompt || 'CosyWorld update',
        contentFilters
      });
      if (!tweetText) {
        throw new Error('Tweet content unavailable after sanitizing links.');
      }
      
      const payload = mediaId 
        ? { text: tweetText, media: { media_ids: [mediaId] } } 
        : { text: tweetText };
        
      let tweet;
      const sendTweet = async () => {
        // Use OAuth 1.0a client if we have it, otherwise fall back to OAuth 2.0
        const oauth1Creds = await this._getOAuth1Credentials();
        if (oauth1Creds) {
          const oauth1Client = new TwitterApi({
            appKey: oauth1Creds.apiKey,
            appSecret: oauth1Creds.apiSecret,
            accessToken: oauth1Creds.accessToken,
            accessSecret: oauth1Creds.accessTokenSecret,
          });
          this.logger?.debug?.('[XService][globalPost] posting tweet with OAuth 1.0a');
          return oauth1Client.v2.tweet(payload);
        } else {
          this.logger?.debug?.('[XService][globalPost] posting tweet with OAuth 2.0');
          const postClient = new TwitterApi({ accessToken: accessToken.trim() }).v2;
          return postClient.tweet(payload);
        }
      };
      
      // Track post attempt
      this.metricsService?.increment('xService', 'posts_attempted');
      
      try {
        tweet = await sendTweet();
      } catch (apiErr) {
        // Capture common auth failures distinctly for operator visibility
        const code = apiErr?.code || apiErr?.data?.errors?.[0]?.code;
        
        // Handle rate limit (429)
        if (code === 429 || apiErr?.status === 429) {
          const resetTime = apiErr?.rateLimit?.reset || (Date.now() + 15 * 60 * 1000); // Default 15 min
          const waitSec = Math.ceil((resetTime * 1000 - Date.now()) / 1000);
          
          this.logger?.warn?.(`[XService][globalPost] Rate limit (429). Next reset in ${Math.ceil(waitSec / 60)} minutes`);
          
          // Track rate limit metrics
          this.metricsService?.increment('xService', 'rate_limited_count');
          this.metricsService?.gauge('xService', 'backoff_duration_ms', waitSec * 1000);
          this.metricsService?.recordHealth('xService', {
            status: 'degraded',
            message: `Rate limited for ${Math.ceil(waitSec / 60)} minutes`,
            details: { resetTime, waitSec }
          });
          
          // Store backoff time (both in-memory and persistent)
          if (!this._globalRate) this._globalRate = { windowStart: Date.now(), count: 0 };
          this._globalRate.rateLimitResetAt = resetTime * 1000;
          this._globalRate.rateLimited = true;
          this._globalRate.consecutiveFailures = (this._globalRate.consecutiveFailures || 0) + 1;
          
          // Save to persistent storage
          this._saveRateLimitState('global', this._globalRate).catch(() => {});
          
          try {
            const db = await this.databaseService.getDatabase();
            await db.collection('x_auth').updateOne(
              { _id: authRecord?._id }, 
              { 
                $set: { 
                  rateLimited: true, 
                  rateLimitResetAt: new Date(resetTime * 1000),
                  lastErrorAt: new Date() 
                } 
              }
            );
          } catch {}
          
          this._lastGlobalPostAttempt = { 
            at: Date.now(), 
            skipped: true, 
            reason: 'rate_limited', 
            waitSec, 
            mediaUrl: opts.mediaUrl 
          };
          
          throw new Error(`Rate limited. Wait ${Math.ceil(waitSec / 60)} minutes.`);
        }
        
        if (code === 401 || apiErr?.status === 401) {
          if (!refreshed && authRecord?.refreshToken && authRecord?.avatarId) {
            this.logger?.warn?.('[XService][globalPost] 401 on tweet -> attempting refresh+retry');
            try {
              const { accessToken: newToken } = await this.refreshAccessToken(authRecord);
              accessToken = newToken;
              tweet = await sendTweet();
            } catch (retryErr) {
              this.logger?.error?.('[XService][globalPost] retry after refresh failed: ' + (retryErr?.message || retryErr));
              this.logger?.error?.('[XService][globalPost] 401 Unauthorized when posting. Re-authorize the global X account.', { hint: 'Re-run admin Connect flow and mark as Global.' });
              try {
                const db = await this.databaseService.getDatabase();
                await db.collection('x_auth').updateOne({ _id: authRecord._id }, { $set: { error: 'unauthorized', lastErrorAt: new Date() } });
              } catch {}
              throw apiErr;
            }
          } else {
            this.logger?.error?.('[XService][globalPost] 401 Unauthorized when posting. Most likely causes: revoked token, missing tweet.write scope, or application reset. Re-authorize the global X account.', { hint: 'Re-run admin Connect flow and mark as Global.' });
            try {
              const db = await this.databaseService.getDatabase();
              await db.collection('x_auth').updateOne({ _id: authRecord?._id }, { $set: { error: 'unauthorized', lastErrorAt: new Date() } });
            } catch {}
          }
        } else if (code === 215 || (apiErr?.data?.errors || []).some(e => e?.code === 215)) {
          this.logger?.error?.('[XService][globalPost] Auth error (code 215: Bad Authentication data). Token invalid or malformed.', { hint: 'Delete x_auth record and re-authorize.' });
          try {
            const db = await this.databaseService.getDatabase();
            await db.collection('x_auth').updateOne({ _id: authRecord?._id }, { $set: { error: 'bad_auth_data', lastErrorAt: new Date() } });
          } catch {}
        } else {
          this.logger?.error?.('[XService][globalPost] tweet API call failed', apiErr?.message || apiErr);
        }
        if (!tweet) throw apiErr;
      }
      if (!tweet?.data?.id) throw new Error('tweet failed');
      const tweetId = tweet.data.id;
      if (!this.isValidTweetId(tweetId)) {
        throw new Error('X returned invalid tweet ID');
      }
      if (process.env.DEBUG_GLOBAL_X === '1') {
        this.logger?.info?.('[XService][globalPost][diag] tweetSuccess', { tweetId });
      }

      this._globalRate.count++;
      this._globalRate.lastPostedAt = Date.now();
      this._globalRate.consecutiveFailures = 0; // Reset on success
      
      // Save successful state
      this._saveRateLimitState('global', this._globalRate).catch(() => {});
      
      // Track successful post metrics
      this.metricsService?.increment('xService', 'posts_successful');
      this.metricsService?.gauge('xService', 'last_successful_post', Date.now());

      // store basic record
      try {
        const db = await this.databaseService.getDatabase();
        
        // Build metadata for deduplication and tracking
        const metadata = {
          source: opts.source || 'media.generation',
          type: opts.source === 'avatar.create' ? 'introduction' : 'general'
        };
        
        // Include avatar info if available for deduplication
        if (opts.avatarId) {
          metadata.avatarId = String(opts.avatarId);
          metadata.avatarName = opts.avatarName || null;
          metadata.avatarEmoji = opts.avatarEmoji || null;
        }
        
        if (opts.guildId) {
          metadata.guildId = opts.guildId;
        }

        if (opts.metadata && typeof opts.metadata === 'object') {
          Object.assign(metadata, opts.metadata);
        }
        
        await db.collection('social_posts').insertOne({
          global: true,
          mediaUrl,
          mediaType: isVideo ? 'video' : 'image',
          tweetId,
          content: tweetText,
          altText: altText || null,
          shadow: false,
          metadata,
          createdAt: new Date(),
        });
      } catch (e) { this.logger?.warn?.('[XService][globalPost] db insert failed ' + e.message); }

      // Attempt to derive username from token (extra call). Cache once.
      if (!this._globalUser) {
        try { 
          if (!v2Active) {
            v2Active = new TwitterApi({ accessToken: accessToken.trim() }).v2;
          }
          const me = await v2Active.me(); 
          const username = me?.data?.username;
          this._globalUser = this._isValidTwitterHandle(username) ? username : null; 
        } catch { this._globalUser = null; }
      }
      const tweetUrl = this.buildTweetUrl(tweetId, this._globalUser);
      this._lastGlobalPostAttempt = { at: Date.now(), skipped: false, reason: 'posted', tweetId, tweetUrl, mediaUrl };
      this.logger?.info?.('[XService][globalPost] posted media', { tweetUrl });
      _bump('posted', { tweetId, tweetUrl, mediaUrl });
      
      // NEW: Emit event for cross-posting to other platforms (e.g., Telegram)
      try {
        eventBus.emit('X.POST.CREATED', {
          tweetId,
          tweetUrl,
          content: tweetText,
          imageUrl: isVideo ? null : mediaUrl,
          videoUrl: isVideo ? mediaUrl : null,
          avatarId: opts.avatarId || null,
          avatarName: opts.avatarName || null,
          avatarEmoji: opts.avatarEmoji || null,
          source: opts.source || 'media.generation',
          global: true,
          createdAt: new Date()
        });
        this.logger?.debug?.('[XService][globalPost] emitted X.POST.CREATED event');
      } catch (eventErr) {
        this.logger?.warn?.('[XService][globalPost] failed to emit X.POST.CREATED event:', eventErr?.message);
      }
      
      return { tweetId, tweetUrl };
    } catch (err) {
      // Track failed post
      this.metricsService?.increment('xService', 'posts_failed');
      
      // If we got here due to diagnostics already logged, avoid duplicate generic noise
      if (!(err?.code === 401 || err?.code === 215 || (err?.data?.errors||[]).some(e=>e.code===215))) {
        this.logger?.error?.('[XService][globalPost] failed:', err?.message || err);
      }
      if (process.env.DEBUG_GLOBAL_X === '1') {
        this.logger?.error?.('[XService][globalPost][diag] exception', { message: err?.message, stack: err?.stack });
      }
      this._lastGlobalPostAttempt = { at: Date.now(), skipped: true, reason: 'error', error: err?.message || String(err), mediaUrl: opts.mediaUrl };
      try { this._globalPostMetrics && this._globalPostMetrics.reasons && this._globalPostMetrics.reasons.error !== undefined && (this._globalPostMetrics.reasons.error++); } catch {}
      return { error: true, reason: err?.message || 'Unknown X posting error' };
    }
  }

  /**
   * Process video using ffmpeg to meet X (Twitter) requirements
   * @param {Buffer} buffer - Input video buffer
   * @returns {Promise<Buffer>} - Processed video buffer
   */
  async _processVideoForX(buffer) {
    const tempDir = os.tmpdir();
    const inputPath = path.join(tempDir, `input_${Date.now()}.mp4`);
    const outputPath = path.join(tempDir, `output_${Date.now()}.mp4`);

    try {
      await fs.promises.writeFile(inputPath, buffer);

      // FFmpeg command to convert video to X compatible format
      // -c:v libx264: Use H.264 video codec
      // -profile:v high: Use High Profile
      // -pix_fmt yuv420p: Use YUV 4:2:0 pixel format
      // -c:a aac: Use AAC audio codec
      // -b:a 128k: Audio bitrate 128k
      // -ar 44100: Audio sample rate 44.1kHz
      // -movflags +faststart: Move metadata to beginning of file (good for streaming)
      // -vf "scale='min(1280,iw)':-2": Scale down if larger than 1280 width, keeping aspect ratio, ensure even dimensions
      // -r 30: Frame rate 30 fps (safe bet)
      const command = `ffmpeg -i "${inputPath}" -c:v libx264 -profile:v high -pix_fmt yuv420p -c:a aac -b:a 128k -ar 44100 -movflags +faststart -vf "scale='min(1280,iw)':-2" -r 30 "${outputPath}"`;
      
      this.logger?.info?.(`[XService] Processing video with ffmpeg: ${command}`);
      await execAsync(command);

      const processedBuffer = await fs.promises.readFile(outputPath);
      return processedBuffer;
    } catch (error) {
      this.logger?.error?.('[XService] Video processing failed:', error);
      throw error;
    } finally {
      // Cleanup
      try {
        if (fs.existsSync(inputPath)) await fs.promises.unlink(inputPath);
        if (fs.existsSync(outputPath)) await fs.promises.unlink(outputPath);
      } catch (cleanupError) {
        this.logger?.warn?.('[XService] Failed to cleanup temp files:', cleanupError);
      }
    }
  }

  /** Get OAuth 1.0a credentials from secrets service */
  async _getOAuth1Credentials() {
    try {
      this.logger?.debug?.('[XService] Attempting to load OAuth 1.0a credentials from secretsService');
      
      if (!this.secretsService) {
        this.logger?.error?.('[XService] secretsService is not available!');
        return null;
      }
      
      const creds = await this.secretsService.getAsync('x_oauth1_creds');
      this.logger?.debug?.('[XService] Retrieved credentials:', { 
        hasCreds: !!creds,
        credsType: typeof creds,
        credsKeys: creds ? Object.keys(creds) : [],
        hasApiKey: !!creds?.apiKey,
        hasApiSecret: !!creds?.apiSecret,
        hasAccessToken: !!creds?.accessToken,
        hasAccessTokenSecret: !!creds?.accessTokenSecret,
        apiKeyLength: creds?.apiKey?.length,
        apiSecretLength: creds?.apiSecret?.length,
        accessTokenLength: creds?.accessToken?.length,
        accessTokenSecretLength: creds?.accessTokenSecret?.length
      });
      
      if (!creds || !creds.apiKey || !creds.apiSecret || !creds.accessToken || !creds.accessTokenSecret) {
        this.logger?.warn?.('[XService] OAuth 1.0a credentials incomplete or missing');
        return null;
      }
      return {
        apiKey: creds.apiKey,
        apiSecret: creds.apiSecret,
        accessToken: creds.accessToken,
        accessTokenSecret: creds.accessTokenSecret
      };
    } catch (e) {
      this.logger?.warn?.('[XService] Failed to load OAuth 1.0a credentials: ' + e.message);
      return null;
    }
  }

  /** Test OAuth 1.0a credentials by attempting a simple API call */
  async testOAuth1Upload() {
    const creds = await this._getOAuth1Credentials();
    if (!creds) {
      throw new Error('No OAuth 1.0a credentials configured. Please add them in the admin panel.');
    }

    try {
      const client = new TwitterApi({
        appKey: creds.apiKey,
        appSecret: creds.apiSecret,
        accessToken: creds.accessToken,
        accessSecret: creds.accessTokenSecret
      });

      // Test by verifying credentials
      const me = await client.v1.verifyCredentials();
      return {
        success: true,
        message: `OAuth 1.0a credentials verified for @${me.screen_name}`
      };
    } catch (e) {
      throw new Error(`OAuth 1.0a test failed: ${e.message}`);
    }
  }

  /** Load (and cache briefly) the global posting config document */
  async _loadGlobalPostingConfig(force = false) {
    try {
      const ttlMs = 30_000; // 30s cache
      const now = Date.now();
      if (!force && this._globalPostCfg && (now - this._globalPostCfg._fetchedAt < ttlMs)) {
        return this._globalPostCfg.data;
      }
      const db = await this.databaseService.getDatabase();
      const doc = await db.collection('x_post_config').findOne({ _id: 'global' });
      const normalized = doc || null;
      this._globalPostCfg = { _fetchedAt: now, data: normalized };
      return normalized;
    } catch (e) {
      this.logger?.warn?.('[XService] load global posting config failed: ' + e.message);
      return null;
    }
  }

  async getGlobalPostingMode() {
    try {
      const config = await this._loadGlobalPostingConfig();
      return (config?.mode || 'auto').toLowerCase();
    } catch (error) {
      this.logger?.debug?.('[XService] getGlobalPostingMode fallback due to error:', error?.message);
      return 'auto';
    }
  }

  async updateGlobalPostingConfig(patch) {
    if (!patch || typeof patch !== 'object') throw new Error('patch object required');
    const db = await this.databaseService.getDatabase();
    await db.collection('x_post_config').updateOne({ _id: 'global' }, { $set: { ...patch, updatedAt: new Date() } }, { upsert: true });
    // Invalidate cache
    this._globalPostCfg = null;
    return this._loadGlobalPostingConfig(true);
  }

  /** Attempt to refresh an OAuth2 token for a record that may be marked global or generic */
  async _maybeRefreshAuth(auth, { forceRefresh = false } = {}) {
    if (!auth) return null;
    try {
      const expired = auth.expiresAt && (new Date() >= new Date(auth.expiresAt));
      if ((forceRefresh || expired) && auth.refreshToken) {
        this.logger?.debug?.('[XService] refreshing OAuth2 token', {
          authId: auth?._id,
          avatarId: auth?.avatarId,
          global: auth?.global,
          forceRefresh,
          expired,
        });
        const { accessToken } = await this.refreshAccessToken(auth);
        return accessToken;
      }
      return safeDecrypt(auth.accessToken || '');
    } catch (e) {
      this.logger?.warn?.('[XService][globalPost] token refresh failed: ' + e.message);
      return null;
    }
  }

  /** Return a shallow snapshot of in-memory global posting metrics */
  getGlobalPostingMetrics() {
    const m = this._globalPostMetrics || null;
    if (!m) return { initialized: false };
    return {
      initialized: true,
      attempts: m.attempts,
      posted: m.posted,
      reasons: { ...m.reasons },
      last: m.last ? { ...m.last } : null
    };
  }

  /**
   * Fetch (and cache) the profile for the implicit global X auth record.
   * Caching policy: refresh if missing or cache older than 6h unless force=true.
   * Returns the cached profile object or null if unavailable / auth missing.
   */
  async fetchAndCacheGlobalProfile(force = false) {
    try {
      const db = await this.databaseService.getDatabase();
      const auth = await this._resolveGlobalAuthRecord();
      if (!auth || !auth.accessToken) return null;
      
      const existing = auth.profile || null;
      const now = Date.now();
      const staleMs = 6 * 60 * 60 * 1000; // 6 hours
      if (!force && existing && existing.cachedAt) {
        const age = now - new Date(existing.cachedAt).getTime();
        if (age < staleMs) return existing; // fresh enough
      }
      
      // Use centralized global client factory
      const clientResult = await this._getAuthenticatedClientForGlobal({ throwOnError: false });
      if (!clientResult) return existing; // fallback to existing if client creation failed
      
      try {
        const { v2: clientV2 } = clientResult;
        const me = await clientV2.me({ 'user.fields': 'name,username,profile_image_url' });
        const data = me?.data;
        if (!data) return existing;
        const profile = {
          id: data.id,
          name: data.name,
          username: data.username,
          profile_image_url: data.profile_image_url,
          cachedAt: new Date()
        };
        await db.collection('x_auth').updateOne({ _id: auth._id }, { $set: { profile } });
        return profile;
      } catch (e) {
        this.logger?.warn?.('[XService] fetch global profile failed: ' + e.message);
        return existing;
      }
    } catch (err) {
      this.logger?.warn?.('[XService] fetchAndCacheGlobalProfile error: ' + (err?.message || err));
      return null;
    }
  }

  _getMonthKey(date = new Date()) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  _getDayKey(date = new Date()) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // ISO week key (UTC-based): YYYY-Www
  _getWeekKey(date = new Date()) {
    const tmp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    // Thursday in current week decides the year
    tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
    const week = String(weekNo).padStart(2, '0');
    return `${tmp.getUTCFullYear()}-W${week}`;
  }

  async _resolveGlobalAuthRecord() {
    const db = await this.databaseService.getDatabase();
    let auth = await db.collection('x_auth').findOne({ global: true }, { sort: { updatedAt: -1 } });
    if (!auth) {
      auth = await db.collection('x_auth').findOne(
        { accessToken: { $exists: true, $ne: null } },
        { sort: { updatedAt: -1 } }
      );
    }
    return auth || null;
  }

  async _loadGlobalMentionState(db) {
    const col = db.collection('x_mentions_state');
    const state = await col.findOne({ _id: 'global' });
    return state || {
      _id: 'global',
      monthKey: this._getMonthKey(),
      weekKey: this._getWeekKey(),
      dayKey: this._getDayKey(),
      readsUsedMonth: 0,
      readsUsedWeek: 0,
      readsUsedDay: 0,
      lastMentionId: null,
      lastRunAt: null,
      updatedAt: new Date(),
    };
  }

  async _saveGlobalMentionState(db, patch) {
    const col = db.collection('x_mentions_state');
    await col.updateOne(
      { _id: 'global' },
      { $set: { ...(patch || {}), updatedAt: new Date() } },
      { upsert: true }
    );
  }

  _maxTweetId(ids = []) {
    let max = null;
    for (const id of ids) {
      if (!this._isValidTweetId(id)) continue;
      try {
        const bi = BigInt(String(id));
        if (max === null || bi > max) max = bi;
      } catch {}
    }
    return max === null ? null : String(max);
  }

  async _alreadyRepliedToMention(db, mentionId) {
    if (!this._isValidTweetId(mentionId)) return false;
    const existing = await db.collection('social_posts').findOne({
      global: true,
      type: 'mention_reply',
      inReplyToTweetId: String(mentionId)
    });
    return !!existing;
  }

  /**
   * Fetch conversation context for a mention to provide better reply context.
   * Retrieves the parent tweet if it's a reply, and optionally recent conversation tweets.
   * @param {Object} options - Context fetch options
   * @param {TwitterApi} options.v2 - Authenticated Twitter v2 client
   * @param {Object} options.mention - The mention object
   * @param {number} [options.maxContextTweets=3] - Max number of context tweets to fetch
   * @returns {Promise<{parentTweet?: Object, authorProfile?: Object, conversationTweets?: Array}>}
   */
  async _fetchMentionContext({ v2, mention, maxContextTweets = 3 } = {}) {
    const context = {
      parentTweet: null,
      authorProfile: null,
      conversationTweets: [],
    };

    if (!v2 || !mention) return context;

    try {
      // If the mention is a reply to another tweet, fetch the parent
      if (mention.in_reply_to_user_id || mention.referenced_tweets?.length > 0) {
        const replyToTweetRef = mention.referenced_tweets?.find(r => r.type === 'replied_to');
        if (replyToTweetRef?.id) {
          try {
            const parentResp = await v2.singleTweet(replyToTweetRef.id, {
              'tweet.fields': 'text,author_id,created_at,public_metrics',
              'user.fields': 'username,name,description',
              expansions: 'author_id'
            });
            if (parentResp?.data) {
              context.parentTweet = {
                id: parentResp.data.id,
                text: parentResp.data.text,
                authorId: parentResp.data.author_id,
                createdAt: parentResp.data.created_at,
                metrics: parentResp.data.public_metrics,
              };
              // Extract author info from includes
              const authorUser = parentResp.includes?.users?.find(u => u.id === parentResp.data.author_id);
              if (authorUser) {
                context.parentTweet.authorUsername = authorUser.username;
                context.parentTweet.authorName = authorUser.name;
              }
            }
          } catch (parentErr) {
            this.logger?.debug?.('[XService][context] Failed to fetch parent tweet:', parentErr?.message);
          }
        }
      }

      // Fetch author profile for the mention
      if (mention.author_id) {
        try {
          const authorResp = await v2.user(mention.author_id, {
            'user.fields': 'description,public_metrics,created_at'
          });
          if (authorResp?.data) {
            context.authorProfile = {
              id: authorResp.data.id,
              username: authorResp.data.username,
              name: authorResp.data.name,
              bio: authorResp.data.description,
              followers: authorResp.data.public_metrics?.followers_count,
              joined: authorResp.data.created_at,
            };
          }
        } catch (authorErr) {
          this.logger?.debug?.('[XService][context] Failed to fetch author profile:', authorErr?.message);
        }
      }

      // Optionally fetch recent tweets in the conversation (if conversation_id available)
      if (mention.conversation_id && maxContextTweets > 0) {
        try {
          // Search for tweets in this conversation
          const searchResp = await v2.search(`conversation_id:${mention.conversation_id}`, {
            max_results: Math.min(maxContextTweets + 1, 10),
            'tweet.fields': 'author_id,created_at',
            expansions: 'author_id',
            'user.fields': 'username'
          });
          if (searchResp?.data?.data) {
            const tweets = searchResp.data.data
              .filter(t => t.id !== mention.id) // Exclude the mention itself
              .slice(0, maxContextTweets);
            context.conversationTweets = tweets.map(t => ({
              id: t.id,
              text: t.text,
              authorId: t.author_id,
              authorUsername: searchResp.data.includes?.users?.find(u => u.id === t.author_id)?.username,
            }));
          }
        } catch (convErr) {
          this.logger?.debug?.('[XService][context] Failed to fetch conversation:', convErr?.message);
        }
      }
    } catch (err) {
      this.logger?.debug?.('[XService][context] Context fetch error:', err?.message);
    }

    return context;
  }

  /**
   * Generate a contextually-aware reply to a mention.
   * Uses conversation context to provide more relevant responses.
   * @param {Object} options - Reply generation options
   * @returns {Promise<string|null>} Generated reply text
   */
  async _generateGlobalMentionReplyWithContext({ mentionText, mentionContext, globalBotService, aiService }) {
    const baseStyle = globalBotService?.bot?.globalBotConfig?.xPostStyle
      || "Warm, engaging narrator voice. No links. No hashtags. Be concise.";

    if (typeof aiService?.chat !== 'function') {
      const fallback = `Thanks for reaching out — welcome to CosyWorld. What are you exploring today?`;
      return this._sanitizeTweetText(fallback, { maxLength: 240 });
    }

    const universeName = globalBotService?.bot?.globalBotConfig?.universeName || process.env.UNIVERSE_NAME || 'CosyWorld';
    const botName = globalBotService?.bot?.name || universeName;
    const personality = globalBotService?.bot?.personality || '';
    const dynamicPrompt = globalBotService?.bot?.dynamicPrompt || '';

    // Build context string from mention context
    const contextParts = [];
    if (mentionContext?.parentTweet) {
      const parent = mentionContext.parentTweet;
      contextParts.push(`Original tweet (by @${parent.authorUsername || 'someone'}): "${parent.text?.slice(0, 200)}"`);
    }
    if (mentionContext?.authorProfile) {
      const author = mentionContext.authorProfile;
      const bioSnippet = author.bio ? ` Bio: "${author.bio.slice(0, 80)}"` : '';
      contextParts.push(`Mentioner: @${author.username} (${author.followers || 0} followers)${bioSnippet}`);
    }
    if (mentionContext?.conversationTweets?.length > 0) {
      const convText = mentionContext.conversationTweets
        .map(t => `- @${t.authorUsername || 'user'}: "${t.text?.slice(0, 100)}"`)
        .join('\n');
      contextParts.push(`Recent conversation:\n${convText}`);
    }

    const contextSection = contextParts.length > 0
      ? `\n\nConversation context:\n${contextParts.join('\n\n')}\n`
      : '';

    const prompt = [
      `You are ${botName}, the narrator of ${universeName}.`,
      personality ? `Personality: ${personality}` : null,
      dynamicPrompt ? `Current perspective: ${dynamicPrompt}` : null,
      `Style guide: ${baseStyle}`,
      contextSection,
      `Reply to this mention in 1-2 sentences. Consider the conversation context if provided.`,
      `Hard rules: no links, no hashtags, no cashtags, no @mentions, under 240 characters.`,
      `Mention: ${mentionText}`
    ].filter(Boolean).join('\n\n');

    const response = await aiService.chat(
      [{ role: 'user', content: prompt }],
      {
        model: globalBotService?.bot?.model || process.env.GLOBAL_BOT_MODEL,
        temperature: 0.7,
      }
    );

    const cleaned = String(response || '').trim().replace(/^"|"$/g, '');
    return this._sanitizeTweetText(cleaned, { maxLength: 240 });
  }

  async _generateGlobalMentionReply({ mentionText, globalBotService, aiService }) {
    const baseStyle = globalBotService?.bot?.globalBotConfig?.xPostStyle
      || "Warm, engaging narrator voice. No links. No hashtags. Be concise.";

    if (typeof aiService?.chat !== 'function') {
      const fallback = `Thanks for reaching out — welcome to CosyWorld. What are you exploring today?`;
      return this._sanitizeTweetText(fallback, { maxLength: 240 });
    }

    const universeName = globalBotService?.bot?.globalBotConfig?.universeName || process.env.UNIVERSE_NAME || 'CosyWorld';
    const botName = globalBotService?.bot?.name || universeName;
    const personality = globalBotService?.bot?.personality || '';
    const dynamicPrompt = globalBotService?.bot?.dynamicPrompt || '';

    const prompt = [
      `You are ${botName}, the narrator of ${universeName}.`,
      personality ? `Personality: ${personality}` : null,
      dynamicPrompt ? `Current perspective: ${dynamicPrompt}` : null,
      `Style guide: ${baseStyle}`,
      `Reply to this mention in 1-2 sentences.`,
      `Hard rules: no links, no hashtags, no cashtags, no @mentions, under 240 characters.`,
      `Mention: ${mentionText}`
    ].filter(Boolean).join('\n\n');

    const response = await aiService.chat(
      [{ role: 'user', content: prompt }],
      {
        model: globalBotService?.bot?.model || process.env.GLOBAL_BOT_MODEL,
        temperature: 0.7,
      }
    );

    const cleaned = String(response || '').trim().replace(/^"|"$/g, '');
    return this._sanitizeTweetText(cleaned, { maxLength: 240 });
  }

  /**
   * Poll the GLOBAL account's mentions and (optionally) reply.
   * This is designed for the Free tier by using:
   * - persisted since_id
   * - low max_results
   * - monthly read budget cap
   */
  async processGlobalMentionsAndReply({ aiService, globalBotService } = {}) {
    const enabledFlag = String(process.env.X_MENTION_REPLY_ENABLED || '').trim().toLowerCase();
    const disabled = enabledFlag === '0' || enabledFlag === 'false' || enabledFlag === 'off' || enabledFlag === 'no';
    if (disabled) return { skipped: true, reason: 'disabled' };

    // Check if we're still in a rate limit window
    const db = await this.databaseService.getDatabase();
    const existingState = await this._loadGlobalMentionState(db);
    if (existingState?.rateLimitedUntil && new Date(existingState.rateLimitedUntil) > new Date()) {
      const remainingSec = Math.ceil((new Date(existingState.rateLimitedUntil) - new Date()) / 1000);
      this.logger?.debug?.('[XService][mentions] Still rate limited, skipping', { 
        rateLimitedUntil: existingState.rateLimitedUntil,
        remainingSec 
      });
      return { 
        skipped: true, 
        reason: 'rate_limited', 
        waitSec: remainingSec,
        message: `Still rate limited. Try again in ${Math.ceil(remainingSec / 60)} minutes.`
      };
    }

    // Global reply cooldown - don't reply more than once every 10 minutes
    const replyCooldownMs = Number(process.env.X_REPLY_COOLDOWN_MS) || (10 * 60 * 1000); // 10 minutes default
    if (existingState?.lastReplyAt) {
      const timeSinceLastReply = Date.now() - new Date(existingState.lastReplyAt).getTime();
      if (timeSinceLastReply < replyCooldownMs) {
        const remainingSec = Math.ceil((replyCooldownMs - timeSinceLastReply) / 1000);
        this.logger?.debug?.('[XService][mentions] Reply cooldown active, skipping', { 
          lastReplyAt: existingState.lastReplyAt,
          remainingSec 
        });
        return { 
          skipped: true, 
          reason: 'reply_cooldown', 
          waitSec: remainingSec,
          message: `Reply cooldown active. Try again in ${Math.ceil(remainingSec / 60)} minutes.`
        };
      }
    }

    // Max age for mentions we'll reply to (default 30 minutes)
    const mentionMaxAgeMs = Number(process.env.X_MENTION_MAX_AGE_MS) || (30 * 60 * 1000);

    const weeklyReadCap = (() => {
      const raw = Number(process.env.X_MENTION_WEEKLY_READ_CAP);
      if (!Number.isNaN(raw) && raw >= 0) return raw;
      return 25;
    })();

    const dailyReadCap = (() => {
      const raw = Number(process.env.X_MENTION_DAILY_READ_CAP);
      if (!Number.isNaN(raw) && raw >= 0) return raw;
      // If not set, default to no explicit daily cap (use weekly/monthly only)
      return 0;
    })();

    const monthlyReadCap = (() => {
      const raw = Number(process.env.X_MENTION_MONTHLY_READ_CAP);
      if (!Number.isNaN(raw) && raw > 0) return raw;
      return 80;
    })();

    const maxPerRun = (() => {
      const raw = Number(process.env.X_MENTION_MAX_RESULTS);
      if (!Number.isNaN(raw) && raw > 0) return Math.min(raw, 10);
      return 5;
    })();

    // Try OAuth 1.0a credentials first (same as posting) since they work reliably
    const oauth1Creds = await this._getOAuth1Credentials();
    let useOAuth1 = false;
    let oauth1Client = null;
    let oauth1UserId = null;
    
    if (oauth1Creds) {
      try {
        oauth1Client = new TwitterApi({
          appKey: oauth1Creds.apiKey,
          appSecret: oauth1Creds.apiSecret,
          accessToken: oauth1Creds.accessToken,
          accessSecret: oauth1Creds.accessTokenSecret,
        });
        // Verify credentials and get user ID
        const me = await oauth1Client.v2.me({ 'user.fields': 'id,username,name' });
        if (me?.data?.id) {
          oauth1UserId = me.data.id;
          useOAuth1 = true;
          this.logger?.debug?.('[XService][mentions] using OAuth 1.0a credentials', { userId: oauth1UserId });
        }
      } catch (oauth1Err) {
        const errCode = oauth1Err?.code || oauth1Err?.status || oauth1Err?.statusCode;
        // If rate limited (429), don't fallback - just skip this tick entirely
        if (Number(errCode) === 429 || /429/.test(oauth1Err?.message || '')) {
          const resetTime = oauth1Err?.rateLimit?.reset;
          const waitSec = resetTime ? Math.ceil((resetTime * 1000 - Date.now()) / 1000) : 900; // Default 15 min
          this.logger?.warn?.('[XService][mentions] OAuth 1.0a rate limited (429), skipping mention poll', { 
            waitSec,
            resetTime: resetTime ? new Date(resetTime * 1000).toISOString() : 'unknown'
          });
          await this._saveGlobalMentionState(db, { 
            lastRunAt: new Date(), 
            lastError: `rate_limited:${waitSec}s`,
            rateLimitedUntil: new Date(Date.now() + waitSec * 1000)
          });
          return { 
            skipped: true, 
            reason: 'rate_limited', 
            waitSec,
            message: `X API rate limited. Try again in ${Math.ceil(waitSec / 60)} minutes.`
          };
        }
        // For other errors, log and fall back to OAuth 2.0
        this.logger?.warn?.('[XService][mentions] OAuth 1.0a verification failed, falling back to OAuth 2.0', { 
          error: oauth1Err?.message || String(oauth1Err),
          code: errCode
        });
      }
    }
    
    // Fall back to OAuth 2.0 if OAuth 1.0a not available or failed
    const auth = await this._resolveGlobalAuthRecord();
    let accessToken = null;
    
    if (!useOAuth1) {
      if (!auth?.accessToken) {
        await this._saveGlobalMentionState(db, { lastRunAt: new Date(), lastError: 'no_auth' });
        return { skipped: true, reason: 'no_auth' };
      }

      accessToken = await this._maybeRefreshAuth(auth);
      if (!accessToken) {
        await this._saveGlobalMentionState(db, { lastRunAt: new Date(), lastError: 'no_token' });
        return { skipped: true, reason: 'no_token' };
      }
      accessToken = String(accessToken).trim();
      if (!accessToken) {
        await this._saveGlobalMentionState(db, { lastRunAt: new Date(), lastError: 'empty_token' });
        return { skipped: true, reason: 'empty_token' };
      }
    }

    const monthKey = this._getMonthKey();
    const weekKey = this._getWeekKey();
    const dayKey = this._getDayKey();
    const state = await this._loadGlobalMentionState(db);
    const readsUsedMonth = (state.monthKey === monthKey) ? Number(state.readsUsedMonth ?? state.readsUsed ?? 0) : 0;
    const readsUsedWeek = (state.weekKey === weekKey) ? Number(state.readsUsedWeek || 0) : 0;
    const readsUsedDay = (state.dayKey === dayKey) ? Number(state.readsUsedDay || 0) : 0;

    const remainingMonth = monthlyReadCap - readsUsedMonth;
    const remainingWeek = weeklyReadCap > 0 ? (weeklyReadCap - readsUsedWeek) : remainingMonth;
    const remainingDay = dailyReadCap > 0 ? (dailyReadCap - readsUsedDay) : remainingMonth;
    const remaining = Math.min(remainingMonth, remainingWeek, remainingDay);

    if (remaining <= 0) {
      await this._saveGlobalMentionState(db, {
        monthKey,
        weekKey,
        dayKey,
        readsUsedMonth,
        readsUsedWeek,
        readsUsedDay,
        lastRunAt: new Date(),
        lastError: null
      });
      const reason = remainingMonth <= 0
        ? 'budget_exhausted_month'
        : (remainingWeek <= 0 ? 'budget_exhausted_week' : 'budget_exhausted_day');
      this.logger?.info?.('[XService][mentions] Read budget exhausted', {
        reason,
        monthKey,
        weekKey,
        dayKey,
        monthlyReadCap,
        weeklyReadCap,
        dailyReadCap
      });
      return {
        skipped: true,
        reason,
        monthKey,
        weekKey,
        dayKey,
        monthlyReadCap,
        weeklyReadCap,
        dailyReadCap
      };
    }

    // Use OAuth 1.0a client if available, otherwise OAuth 2.0
    let client;
    let v2;
    if (useOAuth1 && oauth1Client) {
      client = oauth1Client;
      v2 = oauth1Client.v2;
    } else {
      client = new TwitterApi({ accessToken });
      v2 = client.v2;
    }

    // Resolve userId (cached on x_auth.profile or from OAuth 1.0a)
    let userId = useOAuth1 ? oauth1UserId : (auth?.profile?.id || null);
    if (!userId) {
      try {
        const me = await v2.me({ 'user.fields': 'id,username,name' });
        userId = me?.data?.id || null;
        if (userId && auth?._id) {
          await db.collection('x_auth').updateOne(
            { _id: auth._id },
            { $set: { profile: { ...(auth.profile || {}), ...me.data, cachedAt: new Date() }, updatedAt: new Date() } }
          );
        }
      } catch (e) {
        await this._saveGlobalMentionState(db, { lastRunAt: new Date(), lastError: `me_failed:${e?.message || e}` });
        return { skipped: true, reason: 'me_failed' };
      }
    }
    if (!userId) {
      await this._saveGlobalMentionState(db, { lastRunAt: new Date(), lastError: 'no_user_id' });
      return { skipped: true, reason: 'no_user_id' };
    }

    const limit = Math.max(1, Math.min(maxPerRun, remaining));
    const sinceId = this._isValidTweetId(state.lastMentionId) ? String(state.lastMentionId) : undefined;

    let resp;
    try {
      resp = await v2.userMentionTimeline(userId, {
        max_results: limit,
        since_id: sinceId,
        'tweet.fields': 'author_id,created_at,conversation_id',
      });
    } catch (e) {
      const status = e?.code || e?.statusCode || e?.status || e?.response?.status;
      const apiTitle = e?.data?.title || e?.response?.data?.title;
      const apiDetail = e?.data?.detail || e?.response?.data?.detail;
      const apiType = e?.data?.type || e?.response?.data?.type;
      const apiErrors = Array.isArray(e?.data?.errors)
        ? e.data.errors
        : (Array.isArray(e?.response?.data?.errors) ? e.response.data.errors : null);
      const errorSummary = {
        message: e?.message || String(e),
        status,
        title: apiTitle,
        detail: apiDetail,
        type: apiType,
        errors: apiErrors,
      };

      // Handle rate limiting (429) - don't retry, just skip with backoff info
      if (Number(status) === 429 || /429/.test(e?.message || '')) {
        const resetTime = e?.rateLimit?.reset;
        const waitSec = resetTime ? Math.ceil((resetTime * 1000 - Date.now()) / 1000) : 900; // Default 15 min
        this.logger?.warn?.('[XService][mentions] Rate limited (429), skipping', { 
          waitSec,
          resetTime: resetTime ? new Date(resetTime * 1000).toISOString() : 'unknown',
          usingOAuth1: useOAuth1
        });
        await this._saveGlobalMentionState(db, { 
          lastRunAt: new Date(), 
          lastError: `rate_limited:${waitSec}s`,
          rateLimitedUntil: new Date(Date.now() + waitSec * 1000)
        });
        return { 
          skipped: true, 
          reason: 'rate_limited', 
          waitSec,
          message: `X API rate limited. Try again in ${Math.ceil(waitSec / 60)} minutes.`
        };
      }

      // If the bearer token was revoked/expired, attempt one refresh+retry (if possible).
      // Only applies to OAuth 2.0 flow - OAuth 1.0a doesn't have refresh tokens
      if (Number(status) === 401 && !useOAuth1 && auth?.refreshToken) {
        try {
          // Force refresh even if the token isn't "expired"; it may be revoked.
          const refreshed = await this._maybeRefreshAuth(auth, { forceRefresh: true });
          if (refreshed) {
            const retryClient = new TwitterApi({ accessToken: String(refreshed).trim() });
            const retryV2 = retryClient.v2;
            resp = await retryV2.userMentionTimeline(userId, {
              max_results: limit,
              since_id: sinceId,
              'tweet.fields': 'author_id,created_at,conversation_id',
            });
          }
        } catch (retryErr) {
          this.logger?.warn?.('[XService][mentions] refresh+retry failed', {
            message: retryErr?.message || String(retryErr),
            authId: auth?._id,
            avatarId: auth?.avatarId,
            global: auth?.global,
          });
        }

        if (resp) {
          // Successfully recovered; continue normal flow.
        } else {
          this.logger?.warn?.('[XService][mentions] userMentionTimeline failed', errorSummary);
          await this._saveGlobalMentionState(db, { lastRunAt: new Date(), lastError: `mentions_failed:${errorSummary.message}` });
          return { skipped: true, reason: 'mentions_failed', error: errorSummary };
        }
      } else {
        this.logger?.warn?.('[XService][mentions] userMentionTimeline failed', { ...errorSummary, usingOAuth1: useOAuth1 });
        await this._saveGlobalMentionState(db, { lastRunAt: new Date(), lastError: `mentions_failed:${errorSummary.message}` });
        return { skipped: true, reason: 'mentions_failed', error: errorSummary };
      }
    }

    const mentions = resp?.data?.data || [];
    const newReadsUsedMonth = readsUsedMonth + mentions.length;
    const newReadsUsedWeek = readsUsedWeek + mentions.length;
    const newReadsUsedDay = readsUsedDay + mentions.length;

    if (!mentions.length) {
      await this._saveGlobalMentionState(db, {
        monthKey,
        weekKey,
        dayKey,
        readsUsedMonth: newReadsUsedMonth,
        readsUsedWeek: newReadsUsedWeek,
        readsUsedDay: newReadsUsedDay,
        lastRunAt: new Date(),
        lastError: null,
      });
      return {
        ok: true,
        replied: 0,
        fetched: 0,
        monthKey,
        weekKey,
        dayKey,
        readsUsedMonth: newReadsUsedMonth,
        readsUsedWeek: newReadsUsedWeek,
        readsUsedDay: newReadsUsedDay
      };
    }

    // Oldest-first for stable processing
    const sorted = [...mentions].sort((a, b) => {
      try { return BigInt(a.id) < BigInt(b.id) ? -1 : 1; } catch { return 0; }
    });

    const newestId = this._maxTweetId(sorted.map(m => m?.id));
    let replied = 0;

    const contentFilters = globalBotService?.bot?.globalBotConfig?.contentFilters || {};
    const filterEnabled = contentFilters.enabled !== false;

    for (const mention of sorted) {
      const mentionId = mention?.id;
      const mentionText = String(mention?.text || '').trim();
      const authorId = mention?.author_id || null;
      const mentionCreatedAt = mention?.created_at ? new Date(mention.created_at) : null;

      if (!this._isValidTweetId(mentionId)) continue;
      if (!mentionText) continue;
      if (String(authorId || '') === String(userId)) continue;

      // Skip mentions that are too old (default: older than 30 minutes)
      if (mentionCreatedAt) {
        const mentionAge = Date.now() - mentionCreatedAt.getTime();
        if (mentionAge > mentionMaxAgeMs) {
          this.logger?.debug?.('[XService][mentions] Skipping old mention', { 
            mentionId, 
            ageMinutes: Math.round(mentionAge / 60000),
            maxAgeMinutes: Math.round(mentionMaxAgeMs / 60000)
          });
          continue;
        }
      }

      // Avoid replying to the same mention twice
      if (await this._alreadyRepliedToMention(db, mentionId)) continue;

      // Optional: avoid engaging with blocked-content mentions
      if (filterEnabled) {
        const cf = filterContent(mentionText, {
          logger: this.logger,
          blockCryptoAddresses: contentFilters.blockCryptoAddresses !== false,
          blockCashtags: contentFilters.blockCashtags !== false,
          allowedCashtags: contentFilters.allowedCashtags || [],
          allowedAddresses: contentFilters.allowedAddresses || []
        });
        if (cf.blocked) {
          this.logger?.info?.('[XService][mentions] Skipping blocked mention', { mentionId, reason: cf.reason });
          continue;
        }
      }

      // Optionally fetch conversation context for more informed replies
      // Controlled by X_MENTION_CONTEXT_ENABLED env var (default: false to conserve API calls)
      const contextEnabled = String(process.env.X_MENTION_CONTEXT_ENABLED || '').toLowerCase() === 'true';
      let mentionContext = null;
      let replyText;
      
      if (contextEnabled && v2) {
        try {
          mentionContext = await this._fetchMentionContext({ v2, mention, maxContextTweets: 2 });
          replyText = await this._generateGlobalMentionReplyWithContext({ 
            mentionText, 
            mentionContext, 
            globalBotService, 
            aiService 
          });
          this.logger?.debug?.('[XService][mentions] Using context-aware reply', { 
            hasParent: !!mentionContext.parentTweet,
            hasAuthorBio: !!mentionContext.authorProfile?.bio,
            conversationCount: mentionContext.conversationTweets?.length || 0
          });
        } catch (ctxErr) {
          this.logger?.debug?.('[XService][mentions] Context fetch failed, falling back:', ctxErr?.message);
          replyText = await this._generateGlobalMentionReply({ mentionText, globalBotService, aiService });
        }
      } else {
        replyText = await this._generateGlobalMentionReply({ mentionText, globalBotService, aiService });
      }
      
      if (!replyText) continue;

      // Re-apply filters to the outgoing reply
      if (filterEnabled) {
        const cfOut = filterContent(replyText, {
          logger: this.logger,
          blockCryptoAddresses: contentFilters.blockCryptoAddresses !== false,
          blockCashtags: contentFilters.blockCashtags !== false,
          allowedCashtags: contentFilters.allowedCashtags || [],
          allowedAddresses: contentFilters.allowedAddresses || []
        });
        if (cfOut.blocked) {
          this.logger?.info?.('[XService][mentions] Generated reply blocked by filters', { mentionId, reason: cfOut.reason });
          continue;
        }
      }

      try {
        const result = await v2.reply(replyText, String(mentionId));
        const replyTweetId = result?.data?.id || null;
        replied++;

        // Update lastReplyAt for cooldown tracking
        await this._saveGlobalMentionState(db, { lastReplyAt: new Date() });

        try {
          await db.collection('social_posts').insertOne({
            global: true,
            type: 'mention_reply',
            inReplyToTweetId: String(mentionId),
            tweetId: replyTweetId,
            content: replyText,
            metadata: {
              source: 'x.mentions',
              mentionAuthorId: authorId || null,
              mentionText: mentionText.slice(0, 500)
            },
            createdAt: new Date(),
          });
        } catch (dbErr) {
          this.logger?.warn?.('[XService][mentions] Failed to persist reply record:', dbErr?.message || dbErr);
        }

        // Only reply to one mention per run to avoid rapid-fire replies
        // The cooldown will prevent the next run from replying too soon
        this.logger?.info?.('[XService][mentions] Replied to mention, stopping for cooldown', { 
          mentionId, 
          replied,
          cooldownMinutes: Math.round(replyCooldownMs / 60000)
        });
        break;
      } catch (e) {
        this.logger?.warn?.('[XService][mentions] Reply failed:', e?.message || e);
      }
    }

    await this._saveGlobalMentionState(db, {
      monthKey,
      weekKey,
      dayKey,
      readsUsedMonth: newReadsUsedMonth,
      readsUsedWeek: newReadsUsedWeek,
      readsUsedDay: newReadsUsedDay,
      lastRunAt: new Date(),
      lastError: null,
      lastMentionId: newestId || state.lastMentionId || null,
    });

    return {
      ok: true,
      replied,
      fetched: mentions.length,
      monthKey,
      weekKey,
      dayKey,
      readsUsedMonth: newReadsUsedMonth,
      readsUsedWeek: newReadsUsedWeek,
      readsUsedDay: newReadsUsedDay
    };
  }

  /**
   * Get health status for X service
   * @returns {Object} Health status information
   */
  async healthCheck() {
    const metrics = this.metricsService?.getServiceMetrics('xService') || {};
    const isRateLimited = this._globalRate?.rateLimited && 
                          this._globalRate?.rateLimitResetAt && 
                          Date.now() < this._globalRate.rateLimitResetAt;
    
    const status = isRateLimited ? 'degraded' : 'healthy';
    const errorRate = metrics.posts_attempted > 0 
      ? (metrics.posts_failed || 0) / metrics.posts_attempted 
      : 0;
    
    return {
      service: 'xService',
      status,
      rateLimited: isRateLimited,
      resetAt: this._globalRate?.rateLimitResetAt || null,
      lastSuccess: metrics.last_successful_post || null,
      errorRate: Math.round(errorRate * 100) / 100,
      metrics: {
        posts_attempted: metrics.posts_attempted || 0,
        posts_successful: metrics.posts_successful || 0,
        posts_failed: metrics.posts_failed || 0,
        rate_limited_count: metrics.rate_limited_count || 0
      }
    };
  }

  // ========================================
  // RATE LIMIT PERSISTENCE
  // ========================================

  /**
   * Load rate limit state from database (survives server restarts).
   * @returns {Promise<Object>} Rate limit state
   */
  async _loadRateLimitState() {
    try {
      const db = await this.databaseService.getDatabase();
      const state = await db.collection('x_rate_limits').findOne({ _id: 'global_post' });
      if (state) {
        // Restore in-memory state
        this._globalRate = {
          windowStart: state.windowStart ? new Date(state.windowStart).getTime() : Date.now(),
          count: state.count || 0,
          rateLimited: state.rateLimited || false,
          rateLimitResetAt: state.rateLimitResetAt ? new Date(state.rateLimitResetAt).getTime() : null,
          lastPostedAt: state.lastPostedAt ? new Date(state.lastPostedAt).getTime() : null,
          backoffLevel: state.backoffLevel || 0
        };
        return this._globalRate;
      }
    } catch (e) {
      this.logger?.warn?.('[XService] Failed to load rate limit state:', e.message);
    }
    return null;
  }

  /**
   * Save rate limit state to database.
   * @param {Object} [updates] - Partial updates to merge
   */
  async _saveRateLimitState(updates = {}) {
    try {
      const db = await this.databaseService.getDatabase();
      const state = {
        ...this._globalRate,
        ...updates,
        updatedAt: new Date()
      };
      await db.collection('x_rate_limits').updateOne(
        { _id: 'global_post' },
        { 
          $set: {
            windowStart: state.windowStart ? new Date(state.windowStart) : null,
            count: state.count || 0,
            rateLimited: state.rateLimited || false,
            rateLimitResetAt: state.rateLimitResetAt ? new Date(state.rateLimitResetAt) : null,
            lastPostedAt: state.lastPostedAt ? new Date(state.lastPostedAt) : null,
            backoffLevel: state.backoffLevel || 0,
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );
    } catch (e) {
      this.logger?.warn?.('[XService] Failed to save rate limit state:', e.message);
    }
  }

  /**
   * Apply exponential backoff when rate limited.
   * @param {number} baseWaitSec - Base wait time from API
   * @returns {number} Adjusted wait time with backoff
   */
  _applyBackoff(baseWaitSec) {
    const level = this._globalRate?.backoffLevel || 0;
    // Exponential backoff: 1x, 2x, 4x, 8x (max)
    const multiplier = Math.min(Math.pow(2, level), 8);
    return Math.ceil(baseWaitSec * multiplier);
  }

  // ========================================
  // ENGAGEMENT METRICS SYNC
  // ========================================

  /**
   * Sync engagement metrics for recent posts.
   * Fetches public_metrics (impressions, likes, retweets, replies) from X API.
   * @param {Object} [options] - Options
   * @param {number} [options.lookbackDays=7] - How many days back to sync
   * @param {number} [options.limit=50] - Max posts to sync per run
   * @returns {Promise<{synced: number, errors: number}>}
   */
  async syncPostEngagement({ lookbackDays = 7, limit = 50 } = {}) {
    const db = await this.databaseService.getDatabase();
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    // Get posts without recent metrics sync
    const posts = await db.collection('social_posts').find({
      postedToX: true,
      tweetId: { $exists: true, $ne: null },
      createdAt: { $gte: since },
      $or: [
        { 'metrics.syncedAt': { $exists: false } },
        { 'metrics.syncedAt': { $lt: new Date(Date.now() - 6 * 60 * 60 * 1000) } } // Re-sync every 6 hours
      ]
    }).sort({ createdAt: -1 }).limit(limit).toArray();

    if (!posts.length) {
      this.logger?.debug?.('[XService][syncEngagement] No posts to sync');
      return { synced: 0, errors: 0 };
    }

    // Get a client (prefer OAuth 1.0a for reliability)
    const clientResult = await this._getAuthenticatedClientForGlobal({ preferOAuth1: true, throwOnError: false });
    if (!clientResult) {
      this.logger?.warn?.('[XService][syncEngagement] No auth available');
      return { synced: 0, errors: 0 };
    }
    const { v2: v2Client } = clientResult;

    let synced = 0;
    let errors = 0;

    // Batch tweets into groups of 100 (API limit)
    const tweetIds = posts.map(p => p.tweetId).filter(Boolean);
    const batches = [];
    for (let i = 0; i < tweetIds.length; i += 100) {
      batches.push(tweetIds.slice(i, i + 100));
    }

    for (const batch of batches) {
      try {
        const response = await v2Client.tweets(batch, {
          'tweet.fields': 'public_metrics,created_at'
        });

        const tweetsData = response?.data || [];
        for (const tweet of tweetsData) {
          const metrics = tweet.public_metrics || {};
          const engagementRate = metrics.impression_count > 0
            ? ((metrics.like_count + metrics.retweet_count + metrics.reply_count) / metrics.impression_count * 100)
            : 0;

          await db.collection('social_posts').updateOne(
            { tweetId: tweet.id },
            {
              $set: {
                'metrics.impressions': metrics.impression_count || 0,
                'metrics.likes': metrics.like_count || 0,
                'metrics.retweets': metrics.retweet_count || 0,
                'metrics.replies': metrics.reply_count || 0,
                'metrics.quotes': metrics.quote_count || 0,
                'metrics.engagementRate': Math.round(engagementRate * 100) / 100,
                'metrics.syncedAt': new Date()
              }
            }
          );
          synced++;
        }

        // Small delay between batches to avoid rate limiting
        if (batches.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (apiErr) {
        const code = apiErr?.code || apiErr?.status;
        this.logger?.warn?.('[XService][syncEngagement] Batch failed:', apiErr?.message);
        errors += batch.length;

        if (code === 429) {
          this.logger?.warn?.('[XService][syncEngagement] Rate limited, stopping sync');
          break;
        }
      }
    }

    this.logger?.info?.(`[XService][syncEngagement] Synced ${synced} posts, ${errors} errors`);
    return { synced, errors };
  }

  /**
   * Get engagement summary for an avatar's posts.
   * @param {string} avatarId - Avatar ID
   * @param {number} [days=30] - Lookback period
   * @returns {Promise<Object>} Engagement summary
   */
  async getAvatarEngagementSummary(avatarId, days = 30) {
    const db = await this.databaseService.getDatabase();
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const result = await db.collection('social_posts').aggregate([
      {
        $match: {
          avatarId: new ObjectId(avatarId),
          postedToX: true,
          createdAt: { $gte: since }
        }
      },
      {
        $group: {
          _id: null,
          totalPosts: { $sum: 1 },
          totalImpressions: { $sum: { $ifNull: ['$metrics.impressions', 0] } },
          totalLikes: { $sum: { $ifNull: ['$metrics.likes', 0] } },
          totalRetweets: { $sum: { $ifNull: ['$metrics.retweets', 0] } },
          totalReplies: { $sum: { $ifNull: ['$metrics.replies', 0] } },
          avgEngagementRate: { $avg: { $ifNull: ['$metrics.engagementRate', 0] } },
          postsWithMetrics: { 
            $sum: { $cond: [{ $ifNull: ['$metrics.syncedAt', false] }, 1, 0] } 
          }
        }
      }
    ]).toArray();

    const stats = result[0] || {
      totalPosts: 0,
      totalImpressions: 0,
      totalLikes: 0,
      totalRetweets: 0,
      totalReplies: 0,
      avgEngagementRate: 0,
      postsWithMetrics: 0
    };

    // Calculate best performing post
    const topPost = await db.collection('social_posts').findOne(
      {
        avatarId: new ObjectId(avatarId),
        postedToX: true,
        'metrics.engagementRate': { $exists: true }
      },
      { sort: { 'metrics.engagementRate': -1 } }
    );

    return {
      period: `${days} days`,
      ...stats,
      avgEngagementRate: Math.round((stats.avgEngagementRate || 0) * 100) / 100,
      topPost: topPost ? {
        tweetId: topPost.tweetId,
        content: topPost.content?.slice(0, 100),
        engagementRate: topPost.metrics?.engagementRate,
        impressions: topPost.metrics?.impressions
      } : null
    };
  }

  /**
   * Get global engagement summary across all posts.
   * @param {number} [days=30] - Lookback period
   * @returns {Promise<Object>} Global engagement summary
   */
  async getGlobalEngagementSummary(days = 30) {
    const db = await this.databaseService.getDatabase();
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const result = await db.collection('social_posts').aggregate([
      {
        $match: {
          postedToX: true,
          createdAt: { $gte: since }
        }
      },
      {
        $group: {
          _id: null,
          totalPosts: { $sum: 1 },
          totalImpressions: { $sum: { $ifNull: ['$metrics.impressions', 0] } },
          totalLikes: { $sum: { $ifNull: ['$metrics.likes', 0] } },
          totalRetweets: { $sum: { $ifNull: ['$metrics.retweets', 0] } },
          avgEngagementRate: { $avg: { $ifNull: ['$metrics.engagementRate', 0] } },
          threadCount: { $sum: { $cond: [{ $eq: ['$type', 'thread'] }, 1, 0] } },
          imageCount: { $sum: { $cond: [{ $eq: ['$mediaType', 'image'] }, 1, 0] } },
          videoCount: { $sum: { $cond: [{ $eq: ['$mediaType', 'video'] }, 1, 0] } }
        }
      }
    ]).toArray();

    // Get posting frequency by hour
    const hourlyDistribution = await db.collection('social_posts').aggregate([
      {
        $match: {
          postedToX: true,
          createdAt: { $gte: since }
        }
      },
      {
        $group: {
          _id: { $hour: '$createdAt' },
          count: { $sum: 1 },
          avgEngagement: { $avg: { $ifNull: ['$metrics.engagementRate', 0] } }
        }
      },
      { $sort: { avgEngagement: -1 } }
    ]).toArray();

    const bestHour = hourlyDistribution[0];

    return {
      period: `${days} days`,
      ...(result[0] || {}),
      avgEngagementRate: Math.round((result[0]?.avgEngagementRate || 0) * 100) / 100,
      bestPostingHourUTC: bestHour ? bestHour._id : null,
      bestHourEngagement: bestHour ? Math.round(bestHour.avgEngagement * 100) / 100 : null
    };
  }

  // ========================================
  // REPLY WITH MEDIA
  // ========================================

  /**
   * Reply to a tweet with text and optional media.
   * @param {Object} avatar - Avatar object
   * @param {string} tweetId - Tweet ID to reply to
   * @param {string} content - Reply text
   * @param {Object} [options] - Options
   * @param {string} [options.imageUrl] - Optional image URL
   * @param {string} [options.videoUrl] - Optional video URL
   * @returns {Promise<string>} Result message
   */
  async replyToXWithMedia(avatar, tweetId, content, { imageUrl, videoUrl } = {}) {
    // If no media, use standard reply
    if (!imageUrl && !videoUrl) {
      return await this.replyToX(avatar, tweetId, content);
    }

    // Route to appropriate media reply method
    if (videoUrl) {
      const replyId = await this.replyWithVideoToX(avatar, tweetId, videoUrl, content);
      const targetUrl = this.buildTweetUrl(replyId);
      return targetUrl 
        ? `↩️ [Replied with video](${targetUrl})`
        : '↩️ Replied with video on X';
    }

    if (imageUrl) {
      const replyId = await this.replyWithImageToX(avatar, tweetId, imageUrl, content);
      const targetUrl = this.buildTweetUrl(replyId);
      return targetUrl 
        ? `↩️ [Replied with image](${targetUrl})`
        : '↩️ Replied with image on X';
    }
  }
}

export { XService };
export default XService;