/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * X (Twitter) Authentication Service
 * Provides utilities for managing X platform integration
 */

import { TwitterApi } from 'twitter-api-v2';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { decrypt, encrypt } from '../../utils/encryption.mjs';

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
  }) {
    this.logger = logger;
    this.databaseService = databaseService;
    this.configService = configService;
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
      await db.collection('x_auth').updateOne(
        { avatarId: auth.avatarId },
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
      this.logger?.error?.('Token refresh failed:', error.message, { avatarId: auth.avatarId });
      if (error.code === 401 || error.message?.includes('invalid_grant')) {
        await db.collection('x_auth').deleteOne({ avatarId: auth.avatarId });
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
    const db = await this.databaseService.getDatabase();
    const avatarId = avatar._id.toString();
    if (!await this.isXAuthorized(avatarId)) {
      return '-# [ ❌ Error: X authorization required. Please connect your account. ]';
    }
    const auth = await db.collection('x_auth').findOne({ avatarId });

    // Initialize a v2 client with OAuth2 bearer token
  const twitterClient = new TwitterApi({ accessToken: safeDecrypt(auth.accessToken) });
    const clientV2 = twitterClient.v2;

    try {
      // 1. Download the image
      const res = await fetch(imageUrl);
      if (!res.ok) throw new Error(`Image fetch failed: ${res.status} ${res.statusText}`);
      const buffer = Buffer.from(await res.arrayBuffer());

      // 2. Determine MIME type or fallback
      let mimeType = res.headers.get('content-type')?.split(';')[0];  // may be null :contentReference[oaicite:8]{index=8}
      if (!mimeType) {
        mimeType = 'image/png';                                       // default fallback :contentReference[oaicite:9]{index=9}
      }

      const mediaId = await clientV2.uploadMedia(buffer, {
        media_category: 'tweet_image',
        media_type: mimeType,
      });

      // 3. Post the tweet with the attached media
      const tweetContent = content.trim().slice(0, 280);
      const tweet = await clientV2.tweet({
        text: tweetContent,
        media: { media_ids: [mediaId] }
      });

      if (!tweet || !tweet.data?.id) {
        return '-# [ ❌ Failed to post image to X. ]';
      }

      // 4. Record it in your database
      const tweetId = tweet.data.id;
      const tweetUrl = `https://x.com/${avatar.username}/status/${tweetId}`;
      await db.collection('social_posts').insertOne({
        avatarId: avatar._id,
        content: tweetContent,
        imageUrl,
        timestamp: new Date(),
        postedToX: true,
        tweetId
      });

      return `-# ✨ [ [Posted image to X](${tweetUrl}) ]`;
    } catch (err) {
      this.logger?.error('Error posting image to X (v2):', err);
      throw new Error('Failed to post image to X');
    }
  }

  /**
   * Post an image tweet and return structured details for chaining.
   * Returns { tweetId, tweetUrl, content } on success.
   */
  async postImageToXDetailed(avatar, imageUrl, content) {
    const db = await this.databaseService.getDatabase();
    const avatarId = avatar._id.toString();
    if (!await this.isXAuthorized(avatarId)) {
      throw new Error('X authorization required. Please connect your account.');
    }
    const auth = await db.collection('x_auth').findOne({ avatarId });

  const twitterClient = new TwitterApi({ accessToken: safeDecrypt(auth.accessToken) });
    const clientV2 = twitterClient.v2;

    // 1. Download image
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`Image fetch failed: ${res.status} ${res.statusText}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    let mimeType = res.headers.get('content-type')?.split(';')[0] || 'image/png';

    // 2. Upload media and post
    const mediaId = await clientV2.uploadMedia(buffer, {
      media_category: 'tweet_image',
      media_type: mimeType,
    });
    const tweetContent = String(content || '').trim().slice(0, 280);
    const tweet = await clientV2.tweet({
      text: tweetContent,
      media: { media_ids: [mediaId] }
    });
    if (!tweet?.data?.id) throw new Error('Failed to post image to X');
    const tweetId = tweet.data.id;
    const tweetUrl = `https://x.com/${avatar.username || 'user'}/status/${tweetId}`;

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
    const db = await this.databaseService.getDatabase();
    const avatarId = avatar._id.toString();
    if (!await this.isXAuthorized(avatarId)) throw new Error('X authorization required. Please connect your account.');
    const auth = await db.collection('x_auth').findOne({ avatarId });
    const twitterClient = new TwitterApi({ accessToken: decrypt(auth.accessToken) });
    const clientV2 = twitterClient.v2;

    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`Image fetch failed: ${res.status} ${res.statusText}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    let mimeType = res.headers.get('content-type')?.split(';')[0] || 'image/png';
    const mediaId = await clientV2.uploadMedia(buffer, { media_category: 'tweet_image', media_type: mimeType });

    const replyContent = String(content || '').trim().slice(0, 280);
    const result = await clientV2.tweet({
      text: replyContent,
      media: { media_ids: [mediaId] },
      reply: { in_reply_to_tweet_id: parentTweetId }
    });
    if (!result?.data?.id) throw new Error('Failed to post image reply to X');
    await db.collection('social_posts').insertOne({ avatarId: avatar._id, content: replyContent, tweetId: parentTweetId, timestamp: new Date(), postedToX: true, type: 'reply', mediaType: 'image' });
    return result.data.id;
  }

  /**
   * Reply with a video to a given tweetId.
   */
  async replyWithVideoToX(avatar, parentTweetId, videoUrl, content) {
    const db = await this.databaseService.getDatabase();
    const avatarId = avatar._id.toString();
    if (!await this.isXAuthorized(avatarId)) throw new Error('X authorization required. Please connect your account.');
    const auth = await db.collection('x_auth').findOne({ avatarId });

  const twitterClient = new TwitterApi(safeDecrypt(auth.accessToken));
    const v1Client = twitterClient.v1;
    const v2Client = twitterClient.v2;

    const res = await fetch(videoUrl);
    if (!res.ok) throw new Error(`Video fetch failed: ${res.status} ${res.statusText}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeHeader = res.headers.get('content-type') || '';
    const mimeType = (mimeHeader.split(';')[0] || '').trim() || 'video/mp4';
    const mediaId = await v1Client.uploadMedia(buffer, { mimeType });

    const replyContent = String(content || '').trim().slice(0, 280);
    const result = await v2Client.tweet({
      text: replyContent,
      media: { media_ids: [mediaId] },
      reply: { in_reply_to_tweet_id: parentTweetId }
    });
    if (!result?.data?.id) throw new Error('Failed to post video reply to X');
    await db.collection('social_posts').insertOne({ avatarId: avatar._id, content: replyContent, tweetId: parentTweetId, timestamp: new Date(), postedToX: true, type: 'reply', mediaType: 'video' });
    return result.data.id;
  }

  async postVideoToX(avatar, videoUrl, content) {
    const db = await this.databaseService.getDatabase();
    const avatarId = avatar._id.toString();
    if (!await this.isXAuthorized(avatarId)) {
      return '-# [ ❌ Error: X authorization required. Please connect your account. ]';
    }
    const auth = await db.collection('x_auth').findOne({ avatarId });

    // Initialize clients
  const twitterClient = new TwitterApi(safeDecrypt(auth.accessToken));
    const v1Client = twitterClient.v1;
    const v2Client = twitterClient.v2;

    try {
      // Download the video
      const res = await fetch(videoUrl);
      if (!res.ok) throw new Error(`Video fetch failed: ${res.status} ${res.statusText}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const mimeHeader = res.headers.get('content-type') || '';
      const mimeType = (mimeHeader.split(';')[0] || '').trim() || 'video/mp4';

      // Upload media (chunked for video)
      const mediaId = await v1Client.uploadMedia(buffer, { mimeType });

      // Post tweet with video
      const tweetContent = String(content || '').trim().slice(0, 280);
      const tweet = await v2Client.tweet({ text: tweetContent, media: { media_ids: [mediaId] } });
      if (!tweet?.data?.id) return '-# [ ❌ Failed to post video to X. ]';
      const tweetId = tweet.data.id;
      const tweetUrl = `https://x.com/${avatar.username || 'user'}/status/${tweetId}`;
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
      throw new Error('Failed to post video to X');
    }
  }

  async getXTimelineAndNotifications(avatar) {
    const db = await this.databaseService.getDatabase();
    const avatarId = avatar._id.toString();
    const auth = await db.collection('x_auth').findOne({ avatarId });
    if (!auth || !await this.isXAuthorized(avatarId)) return { timeline: [], notifications: [], userId: null };
  const twitterClient = new TwitterApi(safeDecrypt(auth.accessToken));
    const v2Client = twitterClient.v2;
    const userData = await v2Client.me();
    const userId = userData.data.id;
    const timelineResp = await v2Client.homeTimeline({ max_results: 30 });
    const notificationsResp = await v2Client.userMentionTimeline(userId, { max_results: 10 });
    const timeline = timelineResp?.data?.data?.map(t => ({ id: t.id, text: t.text, user: t.author_id, isOwn: t.author_id === userId })) || [];
    const notifications = notificationsResp?.data?.data?.map(n => ({ id: n.id, text: n.text, user: n.author_id, isOwn: n.author_id === userId })) || [];
    // Save all tweets to DB
    const allTweets = [...timeline, ...notifications];
    for (const tweet of allTweets) {
      if (!tweet?.id) continue;
      await db.collection('social_posts').updateOne(
        { tweetId: tweet.id },
        { $set: { tweetId: tweet.id, content: tweet.text, userId: tweet.user, isOwn: tweet.isOwn, avatarId: avatar._id, timestamp: new Date(), postedToX: tweet.isOwn } },
        { upsert: true }
      );
    }
    return { timeline, notifications, userId };
  }

  // --- X Social Actions ---
  async postToX(avatar, content) {
    const db = await this.databaseService.getDatabase();
    const avatarId = avatar._id.toString();
    if (!await this.isXAuthorized(avatarId)) return '-# [ ❌ Error: X authorization required. Please connect your account. ]';
    const auth = await db.collection('x_auth').findOne({ avatarId });
    const twitterClient = new TwitterApi(decrypt(auth.accessToken));
    const v2Client = twitterClient.v2;
    const tweetContent = content.trim().slice(0, 280);
    const result = await v2Client.tweet(tweetContent);
    if (!result) return '-# [ ❌ Failed to post to X. ]';
    const tweetId = result.data.id;
    const tweetUrl = `https://x.com/ratimics/status/${tweetId}`;
    await db.collection('social_posts').insertOne({ avatarId: avatar._id, content: tweetContent, timestamp: new Date(), postedToX: true, tweetId });
    return `-# ✨ [ [Posted to X](${tweetUrl}) ]`;
  }

  async replyToX(avatar, tweetId, content) {
    const db = await this.databaseService.getDatabase();
    const avatarId = avatar._id.toString();
    if (!await this.isXAuthorized(avatarId)) return '-# [ ❌ Error: X authorization required. Please connect your account. ]';
    const auth = await db.collection('x_auth').findOne({ avatarId });
    const twitterClient = new TwitterApi(decrypt(auth.accessToken));
    const v2Client = twitterClient.v2;
    const replyContent = content.trim().slice(0, 280);
    const result = await v2Client.reply(replyContent, tweetId);
    if (!result) return '-# [ ❌ Failed to reply on X. ]';
    await db.collection('social_posts').insertOne({ avatarId: avatar._id, content: replyContent, tweetId, timestamp: new Date(), postedToX: true, type: 'reply' });
    return `↩️ [Replied to post](https://x.com/ratimics/status/${tweetId}): "${replyContent}"`;
  }

  async quoteToX(avatar, tweetId, content) {
    const db = await this.databaseService.getDatabase();
    const avatarId = avatar._id.toString();
    if (!await this.isXAuthorized(avatarId)) return '-# [ ❌ Error: X authorization required. Please connect your account. ]';
    const auth = await db.collection('x_auth').findOne({ avatarId });
    const twitterClient = new TwitterApi(decrypt(auth.accessToken));
    const v2Client = twitterClient.v2;
    const quoteContent = content.trim().slice(0, 280);
    const result = await v2Client.tweet({ text: quoteContent, quote_tweet_id: tweetId });
    if (!result) return '-# [ ❌ Failed to quote on X. ]';
    await db.collection('social_posts').insertOne({ avatarId: avatar._id, content: quoteContent, tweetId, timestamp: new Date(), postedToX: true, type: 'quote' });
    return `📜 [Quoted post](https://x.com/ratimics/status/${tweetId}): "${quoteContent}"`;
  }

  async followOnX(avatar, userId) {
    const db = await this.databaseService.getDatabase();
    const avatarId = avatar._id.toString();
    if (!await this.isXAuthorized(avatarId)) return '-# [ ❌ Error: X authorization required. Please connect your account. ]';
    const auth = await db.collection('x_auth').findOne({ avatarId });
    const twitterClient = new TwitterApi(decrypt(auth.accessToken));
    const v2Client = twitterClient.v2;
    const me = await v2Client.me();
    await v2Client.follow(me.data.id, userId);
    return `➕ Followed user ${userId}`;
  }

  async likeOnX(avatar, tweetId) {
    const db = await this.databaseService.getDatabase();
    const avatarId = avatar._id.toString();
    if (!await this.isXAuthorized(avatarId)) return '-# [ ❌ Error: X authorization required. Please connect your account. ]';
    const auth = await db.collection('x_auth').findOne({ avatarId });
    const twitterClient = new TwitterApi(decrypt(auth.accessToken));
    const v2Client = twitterClient.v2;
    const me = await v2Client.me();
    await v2Client.like(me.data.id, tweetId);
    return `❤️ Liked post https://x.com/ratimics/status/${tweetId}`;
  }

  async repostOnX(avatar, tweetId) {
    const db = await this.databaseService.getDatabase();
    const avatarId = avatar._id.toString();
    if (!await this.isXAuthorized(avatarId)) return '-# [ ❌ Error: X authorization required. Please connect your account. ]';
    const auth = await db.collection('x_auth').findOne({ avatarId });
    const twitterClient = new TwitterApi(decrypt(auth.accessToken));
    const v2Client = twitterClient.v2;
    const me = await v2Client.me();
    await v2Client.retweet(me.data.id, tweetId);
    return `🔁 Reposted https://x.com/ratimics/status/${tweetId}`;
  }

  async blockOnX(avatar, userId) {
    const db = await this.databaseService.getDatabase();
    const avatarId = avatar._id.toString();
    if (!await this.isXAuthorized(avatarId)) return '-# [ ❌ Error: X authorization required. Please connect your account. ]';
    const auth = await db.collection('x_auth').findOne({ avatarId });
    const twitterClient = new TwitterApi(decrypt(auth.accessToken));
    const v2Client = twitterClient.v2;
    const me = await v2Client.me();
    await v2Client.block(me.data.id, userId);
    return `🚫 Blocked user ${userId}`;
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
      this.logger?.debug?.('[XService][globalPost] invoked', {
        mediaUrl: opts.mediaUrl,
        type: opts.type || 'image',
        textLen: opts.text ? String(opts.text).length : 0
      });
      // Early trace of environment + minimal opts for support diagnostics
      if (process.env.DEBUG_GLOBAL_X === '1') {
        this.logger?.info?.('[XService][globalPost][diag] envFlags', {
          X_GLOBAL_POST_ENABLED: process.env.X_GLOBAL_POST_ENABLED,
          X_GLOBAL_POST_HOURLY_CAP: process.env.X_GLOBAL_POST_HOURLY_CAP,
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
            error: 0
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
        this.logger?.info?.('[XService][globalPost][diag] loadedConfig', { enabled, configKeys: Object.keys(config || {}) });
      }
      if (!enabled) {
        this._lastGlobalPostAttempt = { at: Date.now(), skipped: true, reason: 'disabled', mediaUrl: opts.mediaUrl };
        _bump('disabled', { mediaUrl: opts.mediaUrl });
        return null;
      }

      // Global account selection: prefer record explicitly marked { global: true }, otherwise most recent valid auth.
      // ADMIN_AVATAR_ID & globalAvatarId are deprecated – automatic inference reduces configuration burden.
      let accessToken = null;
      try {
        const db = await this.databaseService.getDatabase();
        // 1. Prefer an auth marked global
        let auth = await db.collection('x_auth').findOne({ global: true }, { sort: { updatedAt: -1 } });
        // 2. Fallback to most recently updated auth record with a token
        if (!auth) {
          auth = await db.collection('x_auth').findOne({ accessToken: { $exists: true, $ne: null } }, { sort: { updatedAt: -1 } });
        }
        if (auth?.accessToken) {
          accessToken = safeDecrypt(auth.accessToken);
          this.logger?.debug?.('[XService][globalPost] resolved global access token', { avatarId: auth.avatarId || null, global: !!auth.global });
          if (process.env.DEBUG_GLOBAL_X === '1') {
            this.logger?.info?.('[XService][globalPost][diag] authRecord', { hasRefresh: !!auth.refreshToken, expiresAt: auth.expiresAt, profileCached: !!auth.profile });
          }
        } else {
          this.logger?.warn?.('[XService][globalPost] No global X auth record found (add one via admin panel).');
        }
      } catch (e) {
        this.logger?.warn?.('[XService][globalPost] global auth resolution failed: ' + e.message);
      }
      if (!accessToken) {
        this._lastGlobalPostAttempt = { at: Date.now(), skipped: true, reason: 'no_access_token', mediaUrl: opts.mediaUrl };
        this.logger?.warn?.('[XService][globalPost] No X access token available. Authorize at least one X account.');
        _bump('no_access_token', { mediaUrl: opts.mediaUrl });
        return null;
      }
      const { mediaUrl, text, altText: rawAlt, type = 'image' } = opts;
      if (!mediaUrl || !/^https?:\/\//i.test(mediaUrl)) {
        this._lastGlobalPostAttempt = { at: Date.now(), skipped: true, reason: 'invalid_media_url', mediaUrl };
        this.logger?.warn?.('[XService][globalPost] Invalid mediaUrl');
        _bump('invalid_media_url', { mediaUrl });
        return null;
      }

      // Simple hour bucket limiter (in-memory). Good enough for MVP; restart resets window.
      const now = Date.now();
      if (!this._globalRate) this._globalRate = { windowStart: now, count: 0 };
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
      if (this._globalRate.count >= hourlyCap) {
        this._lastGlobalPostAttempt = { at: Date.now(), skipped: true, reason: 'hourly_cap', mediaUrl };
        this.logger?.warn?.(`[XService][globalPost] Hourly cap reached (${hourlyCap}) – skipping.`);
        _bump('hourly_cap', { mediaUrl, hourlyCap });
        return null;
      }
      if (process.env.DEBUG_GLOBAL_X === '1') {
        this.logger?.info?.('[XService][globalPost][diag] proceeding', { mediaUrl, isVideo: type === 'video', hourlyCount: this._globalRate.count });
      }
      this.logger?.debug?.('[XService][globalPost] proceeding to fetch media');

      const twitterClient = new TwitterApi({ accessToken: accessToken.trim() });
      const v2 = twitterClient.v2;
      const isVideo = type === 'video';

      // Fetch media
      const res = await fetch(mediaUrl);
      if (!res.ok) throw new Error(`media fetch failed ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      let mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || (isVideo ? 'video/mp4' : 'image/png');

      let mediaId;
      if (isVideo) {
        // Must use v1 for chunked upload
        const v1 = twitterClient.v1;
        mediaId = await v1.uploadMedia(buffer, { mimeType });
      } else {
        mediaId = await v2.uploadMedia(buffer, { media_category: 'tweet_image', media_type: mimeType });
      }
      if (!mediaId) throw new Error('upload failed');

      // Alt text (images only)
      let altText = rawAlt;
      if (!altText && !isVideo && services.aiService?.analyzeImage) {
        try {
          altText = await services.aiService.analyzeImage(mediaUrl, mimeType, 'Provide concise accessible alt text (<=240 chars).');
          if (altText) altText = String(altText).slice(0, 1000);
        } catch (e) { this.logger?.warn?.(`[XService][globalPost] alt generation failed: ${e.message}`); }
      }
      if (altText && !isVideo) {
        try { await v2.createMediaMetadata(mediaId, { alt_text: altText.slice(0, 1000) }); } catch (e) { this.logger?.warn?.(`[XService][globalPost] set alt text failed: ${e.message}`); }
      }

      // Caption generation: if no text provided, attempt AI caption (image/video aware)
      let baseText = String(text || '').trim();
      if (!baseText && services.aiService?.analyzeImage && !isVideo) {
        try {
          const caption = await services.aiService.analyzeImage(
            mediaUrl,
            mimeType,
            'Write a short, engaging, brand-safe caption (<=160 chars) describing this image. Avoid hashtags except CosyWorld. No quotes.'
          );
          if (caption) baseText = String(caption).replace(/[#\n\r]+/g, ' ').trim();
        } catch (e) { this.logger?.debug?.('[XService][globalPost] caption generation failed: ' + e.message); }
      }
      if (!baseText) baseText = '';
      // Ensure single hashtag #CosyWorld appended (unless already present case-insensitively)
      if (!/#cosyworld/i.test(baseText)) {
        baseText = (baseText + ' #CosyWorld').trim();
      }
      // Truncate to 280 chars final
      const tweetText = baseText.slice(0, 280) || ' #CosyWorld';
      const payload = isVideo ? { text: tweetText, media: { media_ids: [mediaId] } } : { text: tweetText, media: { media_ids: [mediaId] } };
      let tweet;
      try {
        tweet = await v2.tweet(payload);
      } catch (apiErr) {
        // Capture common auth failures distinctly for operator visibility
        const code = apiErr?.code || apiErr?.data?.errors?.[0]?.code;
        if (code === 401 || apiErr?.status === 401) {
          this.logger?.error?.('[XService][globalPost] 401 Unauthorized when posting. Most likely causes: revoked token, missing tweet.write scope, or application reset. Re-authorize the global X account.', { hint: 'Re-run admin Connect flow and mark as Global.' });
        } else if (code === 215 || (apiErr?.data?.errors || []).some(e => e?.code === 215)) {
          this.logger?.error?.('[XService][globalPost] Auth error (code 215: Bad Authentication data). Token invalid or malformed.', { hint: 'Delete x_auth record and re-authorize.' });
        } else {
          this.logger?.error?.('[XService][globalPost] tweet API call failed', apiErr?.message || apiErr);
        }
        throw apiErr;
      }
      if (!tweet?.data?.id) throw new Error('tweet failed');
      if (process.env.DEBUG_GLOBAL_X === '1') {
        this.logger?.info?.('[XService][globalPost][diag] tweetSuccess', { tweetId: tweet.data.id });
      }

      this._globalRate.count++;

      // store basic record
      try {
        const db = await this.databaseService.getDatabase();
        await db.collection('social_posts').insertOne({
          global: true,
          mediaUrl,
          mediaType: isVideo ? 'video' : 'image',
          tweetId: tweet?.data?.id || null,
          content: tweetText,
          altText: altText || null,
          shadow: false,
          createdAt: new Date(),
        });
      } catch (e) { this.logger?.warn?.('[XService][globalPost] db insert failed ' + e.message); }

      // Attempt to derive username from token (extra call). Cache once.
      if (!this._globalUser) {
        try { const me = await v2.me(); this._globalUser = me?.data?.username || 'user'; } catch { this._globalUser = 'user'; }
      }
      const tweetUrl = `https://x.com/${this._globalUser}/status/${tweet.data.id}`;
      this._lastGlobalPostAttempt = { at: Date.now(), skipped: false, reason: 'posted', tweetId: tweet.data.id, tweetUrl, mediaUrl };
      this.logger?.info?.('[XService][globalPost] posted media', { tweetUrl });
      _bump('posted', { tweetId: tweet.data.id, tweetUrl, mediaUrl });
      return { tweetId: tweet.data.id, tweetUrl };
    } catch (err) {
      // If we got here due to diagnostics already logged, avoid duplicate generic noise
      if (!(err?.code === 401 || err?.code === 215 || (err?.data?.errors||[]).some(e=>e.code===215))) {
        this.logger?.error?.('[XService][globalPost] failed:', err?.message || err);
      }
      if (process.env.DEBUG_GLOBAL_X === '1') {
        this.logger?.error?.('[XService][globalPost][diag] exception', { message: err?.message, stack: err?.stack });
      }
      this._lastGlobalPostAttempt = { at: Date.now(), skipped: true, reason: 'error', error: err?.message || String(err), mediaUrl: opts.mediaUrl };
      try { this._globalPostMetrics && this._globalPostMetrics.reasons && this._globalPostMetrics.reasons.error !== undefined && (this._globalPostMetrics.reasons.error++); } catch {}
      return null;
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

  async updateGlobalPostingConfig(patch) {
    if (!patch || typeof patch !== 'object') throw new Error('patch object required');
    const db = await this.databaseService.getDatabase();
    await db.collection('x_post_config').updateOne({ _id: 'global' }, { $set: { ...patch, updatedAt: new Date() } }, { upsert: true });
    // Invalidate cache
    this._globalPostCfg = null;
    return this._loadGlobalPostingConfig(true);
  }

  /** Attempt to refresh an OAuth2 token for a record that may be marked global or generic */
  async _maybeRefreshAuth(auth) {
    if (!auth) return null;
    try {
      const expired = auth.expiresAt && (new Date() >= new Date(auth.expiresAt));
      if (expired && auth.refreshToken) {
        // Reuse refreshAccessToken logic requires avatarId; if absent (pure global), skip.
        if (auth.avatarId) {
          const { accessToken } = await this.refreshAccessToken(auth);
          return accessToken;
        }
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
      // Resolve the candidate global auth in the same way postGlobalMediaUpdate does.
      let auth = await db.collection('x_auth').findOne({ global: true }, { sort: { updatedAt: -1 } });
      if (!auth) {
        auth = await db.collection('x_auth').findOne({ accessToken: { $exists: true, $ne: null } }, { sort: { updatedAt: -1 } });
      }
      if (!auth || !auth.accessToken) return null;
      const existing = auth.profile || null;
      const now = Date.now();
      const staleMs = 6 * 60 * 60 * 1000; // 6 hours
      if (!force && existing && existing.cachedAt) {
        const age = now - new Date(existing.cachedAt).getTime();
        if (age < staleMs) return existing; // fresh enough
      }
      // Build client with decrypted token
      const token = safeDecrypt(auth.accessToken);
      if (!token) return existing; // fallback to existing if decrypt failed
      try {
        const client = new TwitterApi({ accessToken: token.trim() });
        const me = await client.v2.me({ 'user.fields': 'name,username,profile_image_url' });
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
}

export { XService };
export default XService;