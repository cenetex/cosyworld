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
  const rt = decrypt(auth.refreshToken || '');
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
    const twitterClient = new TwitterApi({ accessToken: decrypt(auth.accessToken) });
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

    const twitterClient = new TwitterApi({ accessToken: decrypt(auth.accessToken) });
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

    const twitterClient = new TwitterApi(decrypt(auth.accessToken));
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
    const twitterClient = new TwitterApi(decrypt(auth.accessToken));
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
    const twitterClient = new TwitterApi(decrypt(auth.accessToken));
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
}

export { XService };
export default XService;