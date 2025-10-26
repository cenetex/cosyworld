/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file src/services/marketplace/services/socialPosting.mjs
 * @description Social media posting service for marketplace
 */

/**
 * Social Posting Service
 * Post content to social media platforms
 */
export class SocialPostingService {
  constructor(container) {
    this.logger = container.logger || console;
    this.xService = container.xService;
    this.telegramService = container.telegramService;
    this.discordService = container.discordService;
    this.databaseService = container.databaseService;
  }

  getMetadata() {
    return {
      serviceId: 'social-posting',
      providerId: 'system',
      name: 'Social Media Post',
      description: 'Post content to X (Twitter), Discord, or Telegram',
      category: 'social',
      pricing: {
        model: 'per_request',
        amount: 0.5 * 1e6, // 0.5 USDC per post
        currency: 'USDC',
        decimals: 6,
      },
      endpoint: '/api/marketplace/services/social-posting/execute',
      network: 'base-sepolia',
      metadata: {
        estimatedTime: '1-2 seconds',
        platforms: ['X', 'Discord', 'Telegram'],
        features: ['media-attachments', 'thread-support', 'scheduled-posting'],
      },
    };
  }

  async execute(params, agentId) {
    const { platform, content, mediaUrl, threadId, channelId } = params;

    if (!platform || !content) {
      throw new Error('Platform and content are required');
    }

    this.logger.info(`[SocialPosting] Agent ${agentId} posting to ${platform}`);

    try {
      const db = await this.databaseService.getDatabase();
      let postResult = {};

      switch (platform.toLowerCase()) {
        case 'x':
        case 'twitter':
          if (this.xService) {
            postResult = await this.xService.postTweet({
              agentId,
              text: content,
              mediaUrl,
            });
          }
          break;

        case 'discord':
          if (this.discordService) {
            postResult = await this.discordService.sendMessage({
              channelId: channelId || process.env.DEFAULT_DISCORD_CHANNEL,
              content,
              attachments: mediaUrl ? [mediaUrl] : [],
            });
          }
          break;

        case 'telegram':
          if (this.telegramService) {
            postResult = await this.telegramService.sendMessage({
              chatId: channelId || process.env.DEFAULT_TELEGRAM_CHAT,
              text: content,
              photo: mediaUrl,
            });
          }
          break;

        default:
          throw new Error(`Platform ${platform} not supported`);
      }

      // Log post
      await db.collection('social_posts').insertOne({
        agentId,
        platform,
        content,
        mediaUrl,
        threadId,
        channelId,
        postId: postResult.id || postResult.message_id,
        createdAt: new Date(),
        paidAmount: this.getMetadata().pricing.amount,
      });

      return {
        success: true,
        platform,
        postId: postResult.id || postResult.message_id,
        url: postResult.url,
        message: `Successfully posted to ${platform}`,
      };
    } catch (error) {
      this.logger.error('[SocialPosting] Failed:', error);
      throw new Error(`Social posting failed: ${error.message}`);
    }
  }
}
