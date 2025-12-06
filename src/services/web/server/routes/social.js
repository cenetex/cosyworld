/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { Router } from 'express';
import { ObjectId } from 'mongodb';

export default function socialRoutes(db, services = {}) {
  const router = Router();
  const socialPlatformService = services.socialPlatformService;

  const assertSocialService = () => {
    if (!socialPlatformService) {
      throw new Error('socialPlatformService is required for social routes');
    }
  };

  const canManageAvatar = (req, avatarId) => {
    if (req?.user?.isAdmin) return true;
    return req?.user?.avatarId === avatarId;
  };

  router.get('/posts', async (req, res) => {
    try {
      const { sort = 'new', page = 1, limit = 20 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);



      const posts = await db.collection('social_posts').find().limit(parseInt(limit)).skip(skip).toArray();
      const totalPosts = await db.collection('social_posts').countDocuments();
      const totalPages = Math.ceil(totalPosts / parseInt(limit));
      const formattedPosts = posts.map(post => ({
        ...post
      }));

      // Get the avatar ids from the formatted posts
      const avatarIds = formattedPosts.map(post => post.avatarId);
      // Fetch avatar data from the database
      const avatars = await db.collection('avatars').find({ _id: { $in: avatarIds.map(id => new ObjectId(id)) } }).toArray();
      // attach avatar data to the posts
      formattedPosts.forEach(post => {
        const avatar = avatars.find(avatar => avatar._id.toString() === post.avatarId.toString());
        if (avatar) {
          post.avatar = {
            _id: avatar._id.toString(),
            name: avatar.name,
            thumbnailUrl: avatar.imageUrl
          };
        }
      });
      res.json({
        posts: formattedPosts,
        pagination: {
          totalPosts,
          totalPages,
          currentPage: parseInt(page),
          limit: parseInt(limit)
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/posts/:id/like', async (req, res) => {
    try {
      const { id } = req.params;
      const { walletAddress, avatarId } = req.body;

      if (!walletAddress || !avatarId) {
        return res.status(400).json({ error: 'Wallet address and avatar ID required' });
      }

      await db.collection('dungeon_log').updateOne(
        { _id: new ObjectId(id) },
        { 
          $inc: { likes: 1 },
          $addToSet: { 
            likedBy: walletAddress,
            likedByAvatars: avatarId
          }
        }
      );

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/posts/:id/repost', async (req, res) => {
    try {
      const { id } = req.params;
      const { walletAddress, avatarId } = req.body;

      if (!walletAddress || !avatarId) {
        return res.status(400).json({ error: 'Wallet address and avatar ID required' });
      }

      await db.collection('dungeon_log').updateOne(
        { _id: new ObjectId(id) },
        { 
          $inc: { reposts: 1 },
          $addToSet: { 
            repostedBy: walletAddress,
            repostedByAvatars: avatarId
          }
        }
      );

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/connections/:avatarId', async (req, res) => {
    try {
      assertSocialService();
      const { avatarId } = req.params;
      if (!canManageAvatar(req, avatarId)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const connections = await socialPlatformService.listConnectionsForAvatar(avatarId);
      res.json({ connections });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to load connections' });
    }
  });

  router.post('/connections/:avatarId/:platform/post', async (req, res) => {
    try {
      assertSocialService();
      const { avatarId, platform } = req.params;
      if (!canManageAvatar(req, avatarId)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const { content, options = {} } = req.body || {};
      if (!content) {
        return res.status(400).json({ error: 'content is required' });
      }

      const result = await socialPlatformService.post(platform, avatarId, content, options);
      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to post to platform' });
    }
  });

  router.post('/connect/:avatarId', async (req, res) => {
    try {
      assertSocialService();
      const { avatarId } = req.params;
      if (!canManageAvatar(req, avatarId)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const { platform, credentials } = req.body;
      if (!platform || !credentials) {
        return res.status(400).json({ error: 'Platform and credentials required' });
      }

      await socialPlatformService.connectPlatform(avatarId, platform, credentials);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to connect platform' });
    }
  });

  router.post('/disconnect/:avatarId', async (req, res) => {
    try {
      assertSocialService();
      const { avatarId } = req.params;
      if (!canManageAvatar(req, avatarId)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const { platform } = req.body;
      if (!platform) {
        return res.status(400).json({ error: 'Platform required' });
      }

      await socialPlatformService.disconnectPlatform(avatarId, platform);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to disconnect platform' });
    }
  });

  return router;
}