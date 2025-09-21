/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { ObjectId } from 'mongodb';
import { thumbnailService } from '../services/thumbnailService.js';

import multer from 'multer';

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 1 // Only allow 1 file per request
  },
  fileFilter: (req, file, cb) => {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

const configPath = path.join(process.cwd(), 'src/config');

// Helper function to handle async route handlers
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Config utility functions
async function loadConfig() {
  const fallback = {
    whitelistedGuilds: [],
    emojis: { summon: "🔮", breed: "🏹", attack: "⚔️", defend: "🛡️" },
    prompts: {
      introduction: "You have been summoned to this realm. This is your one chance to impress me, and save yourself from Elimination. Good luck, and DONT fuck it up.",
      summon: "Create a unique avatar with a special ability."
    },
    features: { breeding: true, combat: true, itemCreation: true },
    rateLimit: { messages: 5, interval: 10 },
    adminRoles: ["Admin", "Moderator"]
  };
  try {
    const defaultPath = path.join(configPath, 'default.config.json');
    const userPath = path.join(configPath, 'user.config.json');
    let defaultConfig = {};
    try {
      defaultConfig = JSON.parse(await fs.readFile(defaultPath));
    } catch {}
    let userConfig = {};
    try {
      userConfig = JSON.parse(await fs.readFile(userPath));
    } catch (e) {
      // lazily create user config from fallback + default
      await fs.mkdir(configPath, { recursive: true });
      const initial = { ...fallback, ...defaultConfig };
      await fs.writeFile(userPath, JSON.stringify(initial, null, 2));
      userConfig = initial;
    }
    return { ...fallback, ...defaultConfig, ...userConfig };
  } catch (error) {
    // Final fallback without logging noise
    return fallback;
  }
}

async function saveUserConfig(config) {
  try {
    await fs.mkdir(configPath, { recursive: true });
    await fs.writeFile(
      path.join(configPath, 'user.config.json'),
      JSON.stringify(config, null, 2)
    );
    return true;
  } catch (error) {
    console.error('Config save error:', error);
    throw error;
  }
}

function createRouter(db, services) {
  const router = express.Router();
  const avatarsCollection = db.collection('avatars');

  // ===== Avatar Routes =====

  router.post('/avatars', asyncHandler(async (req, res) => {
    const {
      name,
      description,
      personality,
      emoji,
      imageUrl,
      locationId,
      lives,
      status,
      model
    } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Create avatar object
    const avatar = {
      name,
      description: description || '',
      personality: personality || '',
      emoji: emoji || '✨',
      imageUrl: imageUrl || '',
      status: status || 'active',
      lives: lives || 3,
      locationId: locationId || null,
      model: model || 'gpt-4',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Insert into database
    const result = await avatarsCollection.insertOne(avatar);

    // Return created avatar with ID
    res.status(201).json({
      _id: result.insertedId,
      ...avatar
    });
  }));

  router.get('/avatars/:id', asyncHandler(async (req, res) => {
    let id;
    try {
      id = ObjectId.createFromHexString(req.params.id);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid ID format' });
    }

    const avatar = await db.collection('avatars').findOne({ _id: id });
    if (!avatar) {
      return res.status(404).json({ error: 'Avatar not found' });
    }

    res.json(avatar);
  }));

  router.put('/avatars/:id', asyncHandler(async (req, res) => {
    let id;
    try {
      id = new ObjectId(req.params.id);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid ID format' });
    }

    const {
      name,
      description,
      personality,
      emoji,
      imageUrl,
      locationId,
      lives,
      status,
      model
    } = req.body;

    // Create update object with only provided fields
    const updateObj = {};
    if (name !== undefined) updateObj.name = name;
    if (description !== undefined) updateObj.description = description;
    if (personality !== undefined) updateObj.personality = personality;
    if (emoji !== undefined) updateObj.emoji = emoji;
    if (imageUrl !== undefined) updateObj.imageUrl = imageUrl;
    if (locationId !== undefined) updateObj.locationId = locationId;
    if (lives !== undefined) updateObj.lives = lives;
    if (status !== undefined) updateObj.status = status;
    if (model !== undefined) updateObj.model = model;

    // Add updated timestamp
    updateObj.updatedAt = new Date();

    // Validate required fields
    if (updateObj.name === '') {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Update avatar
    const avatarsCollection = db.collection('avatars');
    const result = await avatarsCollection.updateOne(
      { _id: id },
      { $set: updateObj }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Avatar not found' });
    }

    // Return updated avatar
    const updatedAvatar = await avatarsCollection.findOne({ _id: id });
    res.json(updatedAvatar);
  }));

  router.delete('/avatars/:id', asyncHandler(async (req, res) => {
    let id;
    try {
      id = new ObjectId(req.params.id);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid ID format' });
    }

    // Delete avatar
    const result = await avatarsCollection.deleteOne({ _id: id });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Avatar not found' });
    }

    res.status(204).end();
  }));

  // ===== Item Routes =====
  router.get('/items', asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    const total = await db.collection('items').countDocuments();
    const raw = await db.collection('items')
      .find()
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    // Enrich with thumbnails when possible
    const data = await Promise.all((raw || []).map(async (it) => {
      if (!it.thumbnailUrl && it.imageUrl) {
        try { it.thumbnailUrl = await thumbnailService.generateThumbnail(it.imageUrl); } catch {}
      }
      return it;
    }));

    res.json({ data, total, limit, offset });
  }));

  // Item CRUD: get/update/delete
  router.get('/items/:id', asyncHandler(async (req, res) => {
    let id; try { id = new ObjectId(req.params.id); } catch { return res.status(400).json({ error: 'Invalid ID' }); }
    const item = await db.collection('items').findOne({ _id: id });
    if (!item) return res.status(404).json({ error: 'Not found' });
    if (!item.thumbnailUrl && item.imageUrl) {
      try { item.thumbnailUrl = await thumbnailService.generateThumbnail(item.imageUrl); } catch {}
    }
    res.json(item);
  }));

  router.put('/items/:id', asyncHandler(async (req, res) => {
    let id; try { id = new ObjectId(req.params.id); } catch { return res.status(400).json({ error: 'Invalid ID' }); }
  let { name, description, emoji, imageUrl, rarity, owner, locationId } = req.body || {};
  if (typeof name === 'string') name = name.trim();
  if (name && name.length > 120) return res.status(400).json({ error: 'Name must be at most 120 characters' });
    const update = { updatedAt: new Date() };
    if (name !== undefined) update.name = name;
    if (description !== undefined) update.description = description;
    if (emoji !== undefined) update.emoji = emoji;
    if (imageUrl !== undefined) update.imageUrl = imageUrl;
    if (rarity !== undefined) update.rarity = rarity;
    if (owner !== undefined) update.owner = owner;
    if (locationId !== undefined) update.locationId = locationId;
    const result = await db.collection('items').updateOne({ _id: id }, { $set: update });
    if (!result.matchedCount) return res.status(404).json({ error: 'Not found' });
    const item = await db.collection('items').findOne({ _id: id });
    res.json(item);
  }));

  router.delete('/items/:id', asyncHandler(async (req, res) => {
    let id; try { id = new ObjectId(req.params.id); } catch { return res.status(400).json({ error: 'Invalid ID' }); }
    const result = await db.collection('items').deleteOne({ _id: id });
    if (!result.deletedCount) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  }));

  router.post('/items', asyncHandler(async (req, res) => {
    let {
      name,
      description,
      emoji,
      imageUrl,
      rarity,
      owner,
      locationId
    } = req.body;

    if (typeof name === 'string') name = name.trim();
    if (name && name.length > 120) {
      return res.status(400).json({ error: 'Name must be at most 120 characters' });
    }

    // Validate required fields
  if (!name || !description) {
      return res.status(400).json({ error: 'Name and description are required' });
    }

    // Create item object
    const item = {
      name,
      description,
      emoji: emoji || '🔮',
      imageUrl: imageUrl || '',
      rarity: rarity || 'common',
      owner: owner || null,
      locationId: locationId || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Insert into database
    const result = await db.collection('items').insertOne(item);

    // Return created item with ID
    res.status(201).json({
      _id: result.insertedId,
      ...item
    });
  }));

  // ===== Location Routes =====
  router.get('/locations', asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    const total = await db.collection('locations').countDocuments();
    const raw = await db.collection('locations')
      .find()
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    const data = await Promise.all((raw || []).map(async (loc) => {
      if (!loc.thumbnailUrl && loc.imageUrl) {
        try { loc.thumbnailUrl = await thumbnailService.generateThumbnail(loc.imageUrl); } catch {}
      }
      return loc;
    }));

    res.json({ data, total, limit, offset });
  }));

  router.get('/locations/:id', asyncHandler(async (req, res) => {
    let id; try { id = new ObjectId(req.params.id); } catch { return res.status(400).json({ error: 'Invalid ID' }); }
    const location = await db.collection('locations').findOne({ _id: id });
    if (!location) return res.status(404).json({ error: 'Not found' });
    if (!location.thumbnailUrl && location.imageUrl) {
      try { location.thumbnailUrl = await thumbnailService.generateThumbnail(location.imageUrl); } catch {}
    }
    res.json(location);
  }));

  router.put('/locations/:id', asyncHandler(async (req, res) => {
    let id; try { id = new ObjectId(req.params.id); } catch { return res.status(400).json({ error: 'Invalid ID' }); }
    const { name, description, imageUrl, type } = req.body || {};
    const update = { updatedAt: new Date() };
    if (name !== undefined) update.name = name;
    if (description !== undefined) update.description = description;
    if (imageUrl !== undefined) update.imageUrl = imageUrl;
    if (type !== undefined) update.type = type;
    const result = await db.collection('locations').updateOne({ _id: id }, { $set: update });
    if (!result.matchedCount) return res.status(404).json({ error: 'Not found' });
    const location = await db.collection('locations').findOne({ _id: id });
    res.json(location);
  }));

  router.delete('/locations/:id', asyncHandler(async (req, res) => {
    let id; try { id = new ObjectId(req.params.id); } catch { return res.status(400).json({ error: 'Invalid ID' }); }
    const result = await db.collection('locations').deleteOne({ _id: id });
    if (!result.deletedCount) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  }));

  router.post('/locations', asyncHandler(async (req, res) => {
    const {
      name,
      description,
      imageUrl,
      type
    } = req.body;

    // Validate required fields
    if (!name || !description) {
      return res.status(400).json({ error: 'Name and description are required' });
    }

    // Create location object
    const location = {
      name,
      description,
      imageUrl: imageUrl || '',
      type: type || 'wilderness',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Insert into database
    const result = await db.collection('locations').insertOne(location);

    // Return created location with ID
    res.status(201).json({
      _id: result.insertedId,
      ...location
    });
  }));

  // ===== Configuration Routes =====
  router.get('/config', asyncHandler(async (req, res) => {
    try {
      const config = await loadConfig();
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }));

  router.post('/whitelist/guild', asyncHandler(async (req, res) => {
    try {
      const { guildId } = req.body;
      const config = await loadConfig();

      if (!config.whitelistedGuilds) {
        config.whitelistedGuilds = [];
      }

      if (!config.whitelistedGuilds.includes(guildId)) {
        config.whitelistedGuilds.push(guildId);
        await saveUserConfig(config);
      }

      res.json({ success: true, whitelistedGuilds: config.whitelistedGuilds });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }));

  router.delete('/whitelist/guild/:guildId', asyncHandler(async (req, res) => {
    try {
      const { guildId } = req.params;
      const config = await loadConfig();

      if (config.whitelistedGuilds) {
        config.whitelistedGuilds = config.whitelistedGuilds.filter(id => id !== guildId);
        await saveUserConfig(config);
      }

      res.json({ success: true, whitelistedGuilds: config.whitelistedGuilds || [] });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }));

  // ===== User Management Routes =====
  router.post('/ban', asyncHandler(async (req, res) => {
    try {
      const { userId } = req.body;
      await db.collection('user_spam_penalties').updateOne(
        { userId },
        {
          $set: {
            permanentlyBlacklisted: true,
            blacklistedAt: new Date(),
            penaltyExpires: new Date(8640000000000000) // Max date
          },
          $inc: { strikeCount: 1 }
        },
        { upsert: true }
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }));

  router.post('/unban', asyncHandler(async (req, res) => {
    try {
      const { userId } = req.body;
      await db.collection('user_spam_penalties').updateOne(
        { userId },
        {
          $set: {
            strikeCount: 0,
            permanentlyBlacklisted: false,
            penaltyExpires: new Date()
          }
        }
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }));

  // ===== Stats Routes =====
  router.get('/stats', asyncHandler(async (req, res) => {
    try {
      // Get counts
      const [avatarCount, itemCount, locationCount, memoryCount] = await Promise.all([
        avatarsCollection.countDocuments(),
        db.collection('items').countDocuments(),
        db.collection('locations').countDocuments(),
        db.collection('memories').countDocuments()
      ]);

      // Get recent activity (last 10 memories)
      const recentActivity = await db.collection('memories')
        .find()
        .sort({ timestamp: -1 })
        .limit(10)
        .toArray();

      // Get blacklisted users
      const config = await loadConfig();
      const blacklistedUsers = await db.collection('user_spam_penalties')
        .find({})
        .sort({ strikeCount: -1 })
        .project({
          userId: 1,
          strikeCount: 1,
          penaltyExpires: 1,
          permanentlyBlacklisted: 1,
          server: 1
        })
        .toArray();

      res.json({
        counts: {
          avatars: avatarCount,
          items: itemCount,
          locations: locationCount,
          memories: memoryCount
        },
        recentActivity,
        whitelistedGuilds: config.whitelistedGuilds || [],
        blacklistedUsers
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }));

  // ===== Admin Routes =====
  const adminRouter = express.Router();

  // Get admin dashboard data
  adminRouter.get('/config', asyncHandler(async (req, res) => {
    try {
      // Get various stats from the database
      const avatarCount = await avatarsCollection.countDocuments();
      const messageCount = db.messages ? await db.messages.countDocuments() : 0;
      const locationCount = await db.collection('locations').countDocuments();

      // Get connected servers (mock data in this example)
      const servers = [
        {
          id: 'server1',
          name: 'CosyWorld Main',
          status: 'online',
          users: 124,
          avatars: 45
        },
        {
          id: 'server2',
          name: 'AI Tavern',
          status: 'online',
          users: 87,
          avatars: 23
        }
      ];

      const config = await loadConfig();

      res.json({
        success: true,
        stats: {
          avatarCount,
          userCount: 250, // Mock data
          messageCount,
          locationCount
        },
        servers,
        config
      });
    } catch (error) {
      console.error("Error fetching admin config:", error);
      res.status(500).json({ error: error.message });
    }
  }));

  // Save admin settings
  adminRouter.post('/settings', asyncHandler(async (req, res) => {
    try {
      const { features, rateLimit, prompts, adminRoles } = req.body;

      const config = await loadConfig();

      if (features) config.features = features;
      if (rateLimit) config.rateLimit = rateLimit;
      if (prompts) config.prompts = prompts;
      if (adminRoles) config.adminRoles = adminRoles;

      await saveUserConfig(config);

      res.json({
        success: true,
        message: 'Settings saved successfully'
      });
    } catch (error) {
      console.error("Error saving admin settings:", error);
      res.status(500).json({ error: error.message });
    }
  }));

  // Update emoji configuration
  adminRouter.post('/emojis', asyncHandler(async (req, res) => {
    try {
      const { emojis } = req.body;
      if (!emojis) {
        return res.status(400).json({ error: 'Emoji configuration is required' });
      }

      const config = await loadConfig();
      config.emojis = emojis;
      await saveUserConfig(config);

      res.json({
        success: true,
        message: 'Emoji configuration updated'
      });
    } catch (error) {
      console.error("Error updating emoji configuration:", error);
      res.status(500).json({ error: error.message });
    }
  }));

  // Update server configuration
  adminRouter.post('/servers', asyncHandler(async (req, res) => {
    try {
      const { servers } = req.body;

      // In a real app, we would save these to a database
      console.log('Server configuration updated:', servers);

      res.json({
        success: true,
        message: 'Server configuration updated'
      });
    } catch (error) {
      console.error("Error updating server configuration:", error);
      res.status(500).json({ error: error.message });
    }
  }));


  // Upload endpoint handler
  router.post('/upload-image', upload.single('image'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file uploaded' });
      }

      // Use S3Service to upload the image
      const s3Service = req.app.locals.services?.s3Service;
      if (!s3Service) {
        return res.status(500).json({ error: 'S3Service not available' });
      }

      const tempFilePath = `/tmp/${Date.now()}-${req.file.originalname}`;
      await fs.writeFile(tempFilePath, req.file.buffer);
      try {
        const s3Url = await s3Service.uploadImage(tempFilePath);
        if (!s3Url) {
          return res.status(500).json({ error: 'Failed to upload image to S3' });
        }
        await fs.unlink(tempFilePath).catch(() => {});
        return res.json({ url: s3Url });
      } catch (e) {
        console.error('S3 upload failed:', e);
        await fs.unlink(tempFilePath).catch(() => {});
        return res.status(500).json({ error: 'Failed to upload image to S3' });
      }
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: 'Failed to upload image' });
    }
  });

  // Preview prompt endpoint
  router.get('/admin/avatars/:id/preview-prompt', asyncHandler(async (req, res) => {
    let id;
    try {
      id = new ObjectId(req.params.id);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid ID format' });
    }

    const avatar = await avatarsCollection.findOne({ _id: id });
    if (!avatar) {
      return res.status(404).json({ error: 'Avatar not found' });
    }

    try {
      const conversationManager = req.app.locals.services?.conversationManager;

      if (conversationManager) {
        const systemPrompt = await conversationManager.buildSystemPrompt(avatar).catch(() => "System prompt unavailable.");
        let dungeonPrompt = '';
        let channelSummary = '';

        if (avatar.channelId) {
          try {
            const channel = req.app.locals.client?.channels.cache.get(avatar.channelId);
            if (channel?.guild) {
              dungeonPrompt = await conversationManager.buildDungeonPrompt(avatar, channel.guild.id).catch(() => "Dungeon prompt unavailable.");
            }
          } catch (error) {
            console.error('Error getting guild context:', error);
          }

          if (conversationManager.getChannelSummary) {
            channelSummary = await conversationManager.getChannelSummary(avatar._id, avatar.channelId).catch(() => "Channel summary unavailable.");
          }
        }

        const previewPrompt = `
// System Prompt:
${systemPrompt}

// Channel Summary:
${channelSummary}

// Available Commands:
${dungeonPrompt}

// Example User Message:
Hello ${avatar.name}, what's on your mind today?
`;

        return res.json({ prompt: previewPrompt });
      } else {
        const examplePrompt = `
// System Prompt:
You are ${avatar.name}.
${avatar.personality || 'No personality defined'}
${avatar.description || 'No description defined'}

// Example Commands:
🔮 <any concept or thing> - Summon an avatar to your location.
⚔️ <target> - Attack another avatar.
🛡️ - Defend yourself against attacks.
🧠 <topic> - Access your memories on a topic.

// Example User Message:
Hello ${avatar.name}, what's on your mind today?
`;

        return res.json({ prompt: examplePrompt });
      }
    } catch (error) {
      console.error('Error generating preview prompt:', error);
      return res.status(500).json({ error: 'Failed to generate preview prompt' });
    }
  }));

  // Get all X accounts with avatar details
  router.get('/x-accounts', asyncHandler(async (req, res) => {
    try {
  const xAuths = await db.collection('x_auth').find({}).toArray();

      // Build a map of avatarId -> avatar
      const results = [];
      for (const record of xAuths) {
        const avatarIdStr = String(record.avatarId || '');
        let avatar = null;
        try {
          const oid = ObjectId.createFromHexString(avatarIdStr);
          avatar = await db.collection('avatars').findOne({ _id: oid });
        } catch {
          // ignore if avatarId isn't an ObjectId
        }
        if (!avatar) {
          // Skip records without a valid avatar
          continue;
        }

        const now = Date.now();
        const expTs = record.expiresAt ? new Date(record.expiresAt).getTime() : 0;
        const hasToken = !!record.accessToken || !!record.refreshToken;
        const isValid = hasToken && (!expTs || expTs > now);
        const xAuth = {
          authorized: isValid || !!record.profile,
          expiresAt: record.expiresAt || null,
          error: record.error || null,
        };

        // Optionally include a lightweight profile if it's cached on the record
        const xProfile = record.profile || null;

        results.push({ avatar, xAuth: { ...xAuth, global: !!record.global }, xProfile, xAuthId: String(record._id) });
      }

      res.json({ xAccounts: results });
    } catch (error) {
      console.error('Error in X accounts endpoint:', error);
      res.status(500).json({ error: 'Failed to fetch X accounts' });
    }
  }));

  // ------- Global X Posting Config Endpoints -------
  router.get('/x-posting/config', asyncHandler(async (req, res) => {
    try {
      const doc = await db.collection('x_post_config').findOne({ _id: 'global' }, { projection: { enabled: 1 } });
      res.json({ config: doc ? { enabled: !!doc.enabled } : { enabled: false } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  }));

  router.put('/x-posting/config', asyncHandler(async (req, res) => {
    try {
      const enabled = !!req.body?.enabled;
      // Debug logging (non-production) to trace signer & header receipt
      if (process.env.NODE_ENV !== 'production') {
        try {
          const signer = req.signer || null;
          console.log('[x-posting][PUT /config] incoming', {
            enabled,
            hasSigner: !!signer,
            signerAddr: signer?.walletAddress,
            signerOp: signer?.payload?.op,
            tsAgeMs: signer?.payload?.ts ? (Date.now() - signer.payload.ts) : null
          });
          if (!signer) {
            console.log('[x-posting][PUT /config] headers snapshot', {
              addr: req.get('x-wallet-address'),
              hasMsg: !!req.get('x-message'),
              hasSig: !!req.get('x-signature'),
              csrf: req.get('x-csrf-token') ? 'present' : 'missing'
            });
          }
        } catch (e) { console.warn('[x-posting][PUT /config] debug logging failed', e); }
      }
      await db.collection('x_post_config').updateOne({ _id: 'global' }, { $set: { enabled, updatedAt: new Date() } }, { upsert: true });
      try { if (services?.xService) services.xService._globalPostCfg = null; } catch {}
      res.json({ config: { enabled } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  }));

  // Diagnostics: last global post attempt (internal admin debug)
  router.get('/x-posting/diagnostics/last-attempt', asyncHandler(async (req, res) => {
    try {
      const info = services?.xService?._lastGlobalPostAttempt || null;
      res.json({ lastAttempt: info });
    } catch (e) { res.status(500).json({ error: e.message }); }
  }));

  // Manual test trigger for global X posting (admin only debug)
  router.post('/x-posting/test', asyncHandler(async (req, res) => {
    try {
      const { mediaUrl, text, type = 'image' } = req.body || {};
      if (!mediaUrl) return res.status(400).json({ error: 'mediaUrl required' });
      if (!['image','video'].includes(type)) return res.status(400).json({ error: 'type must be image|video' });
      if (!services?.xService) return res.status(500).json({ error: 'xService unavailable' });
      const result = await services.xService.postGlobalMediaUpdate({ mediaUrl, text: text || 'Test Post', type });
      res.json({ ok: true, result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }));


  // Add admin routes to main router (mounted at /api/admin in app.js)
  router.use('/', adminRouter);

  const checkWhitelistStatus = async (guildId) => {
    try {
      // Check if database is initialized
      if (!db) {
        console.error('Error checking whitelist status: Database connection not available');
        return false;
      }

      const config = await db.collection('guild_configs').findOne({ guildId });
      return config?.whitelisted || false;
    } catch (error) {
      console.error('Error checking whitelist status:', error);
      return false;
    }
  };


  return router;
}

export default createRouter;