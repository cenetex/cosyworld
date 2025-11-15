/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */


import express from 'express';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export default function(db, client, configService) {
  // Get all guild configurations
  router.get('/', asyncHandler(async (req, res) => {
    const guildConfigs = await configService.getAllGuildConfigs(db);
    res.json(guildConfigs);
  }));

  // Get detected but not authorized guilds
  router.get('/detected', asyncHandler(async (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: 'Database not connected' });
      }

      // Get all guilds from detected_guilds collection
      const detectedGuildsFromDB = await db.collection('detected_guilds')
        .find({})
        .sort({ updatedAt: -1 })
        .toArray();
      
      // Get guilds from Discord client if available
      const discordGuilds = [];
      if (client && client.guilds) {
        try {
          // Convert client's guild cache to array
          client.guilds.cache.forEach(guild => {
            discordGuilds.push({
              id: guild.id,
              name: guild.name,
              memberCount: guild.memberCount,
              icon: guild.icon,
              detectedAt: new Date(),
              updatedAt: new Date(),
              fromDiscordClient: true
            });
          });
          
          // If we have Discord guilds, update the detected_guilds collection
          if (discordGuilds.length > 0) {
            const bulkOps = discordGuilds.map(guild => ({
              updateOne: {
                filter: { id: guild.id },
                update: { $set: guild },
                upsert: true,
              },
            }));
            
            await db.collection('detected_guilds').bulkWrite(bulkOps);
          }
        } catch (discordError) {
          console.error('Error accessing Discord client guilds:', discordError);
        }
      }
      
      // Also check logs for non-authorized guild attempts
      const logsCollection = db.collection('logs');
      const guildAccessLogs = await logsCollection
        .find({ type: 'guild_access' })
        .sort({ timestamp: -1 })
        .limit(100)
        .toArray();
      
      // Also check application_logs for guild access attempts
      const appLogsCollection = db.collection('application_logs');
      const appGuildAccessLogs = await appLogsCollection
        .find({ type: 'guild_access' })
        .sort({ timestamp: -1 })
        .limit(100)
        .toArray();
      
      // Combine both log collections
      const allAccessLogs = [...guildAccessLogs, ...appGuildAccessLogs];
      
      // Extract guild info from logs
      const logGuilds = new Map();
      allAccessLogs.forEach(log => {
        if (log.guildId && log.guildName) {
          if (!logGuilds.has(log.guildId)) {
            logGuilds.set(log.guildId, {
              id: log.guildId,
              name: log.guildName,
              fromLogs: true,
              detectedAt: log.timestamp || new Date(),
              updatedAt: new Date()
            });
          }
        }
      });
      
      // Combine sources, preferring data from Discord client
      const allDetectedGuilds = new Map();
      
      // First add DB guilds
      detectedGuildsFromDB.forEach(guild => {
        allDetectedGuilds.set(guild.id, guild);
      });
      
      // Then add log guilds (if not already in DB)
      logGuilds.forEach((guild, id) => {
        if (!allDetectedGuilds.has(id)) {
          allDetectedGuilds.set(id, guild);
        }
      });
      
      // Finally add Discord client guilds (override existing)
      discordGuilds.forEach(guild => {
        allDetectedGuilds.set(guild.id, guild);
      });
      
      // Check which guilds are already configured/authorized
      const configuredGuilds = await db.collection('guild_configs')
        .find({})
        .toArray();
      
      const authorizedGuildIds = new Set(
        configuredGuilds
          .filter(g => g.authorized === true || g.whitelisted === true)
          .map(g => g.guildId)
      );
      
      // Prepare final response
      const result = Array.from(allDetectedGuilds.values()).map(guild => {
        return {
          ...guild,
          authorized: authorizedGuildIds.has(guild.id),
          whitelisted: authorizedGuildIds.has(guild.id) // For backward compatibility
        };
      });
      
      res.json(result);
    } catch (error) {
      console.error('Error fetching detected guilds:', error);
      res.status(500).json({ error: error.message });
    }
  }));

  // Create a new guild configuration
  router.post('/', asyncHandler(async (req, res) => {
    const guildData = req.body;

    if (!guildData || !guildData.guildId) {
      return res.status(400).json({ error: 'Guild ID is required' });
    }

    try {
      // Check if guild config already exists
      const existingConfig = await configService.getGuildConfig(guildData.guildId);

      // If it exists, update it
      if (existingConfig) {
        await configService.updateGuildConfig(guildData.guildId, guildData);
        const updatedConfig = await configService.getGuildConfig(guildData.guildId);
        return res.json(updatedConfig);
      }

  // Otherwise create a new config based on a template

      // First, check if we have any existing guild configs to use as a template
      const templateGuild = await db.collection('guild_configs').findOne(
        {},
        { sort: { createdAt: 1 } } // Sort by creation date to get the first one
      );

      let newGuildConfig = {
        ...guildData,
        updatedAt: new Date(),
        createdAt: new Date()
      };

      // If we found a template guild, copy its settings
      if (templateGuild) {
        console.log(`Using guild ${templateGuild.guildId} as a template for new guild ${guildData.guildId}`);

        // Copy template settings but keep the new guild's ID and name
        newGuildConfig = {
          ...templateGuild,
          guildId: guildData.guildId,
          guildName: guildData.guildName || guildData.name || `New Guild ${guildData.guildId}`,
          _id: undefined, // Remove MongoDB ID so it creates a new one
          updatedAt: new Date(),
          createdAt: new Date()
        };
        
        // Ensure all prompts and settings are properly copied
        if (templateGuild.prompts) {
          newGuildConfig.prompts = { ...templateGuild.prompts };
        }
        
        if (templateGuild.features) {
          newGuildConfig.features = { ...templateGuild.features };
        }
        
        if (templateGuild.rateLimit) {
          newGuildConfig.rateLimit = { ...templateGuild.rateLimit };
        }
        
        if (templateGuild.toolEmojis) {
          newGuildConfig.toolEmojis = { ...templateGuild.toolEmojis };
        }
        
        // Also copy admin roles and other settings
        if (templateGuild.adminRoles) {
          newGuildConfig.adminRoles = [...templateGuild.adminRoles];
        }
        
        // Copy summon emoji
        newGuildConfig.summonEmoji = templateGuild.summonEmoji;
        
        // By default, new guilds are not authorized, but honor client intent if provided
        if (typeof guildData.authorized === 'boolean') newGuildConfig.authorized = guildData.authorized; else newGuildConfig.authorized = false;
        if (typeof guildData.whitelisted === 'boolean') newGuildConfig.whitelisted = guildData.whitelisted; else newGuildConfig.whitelisted = false; // Back-compat
      } else {
        // No template: still honor provided authorized/whitelisted flags (default to false)
        if (typeof guildData.authorized !== 'boolean') newGuildConfig.authorized = false;
        if (typeof guildData.whitelisted !== 'boolean') newGuildConfig.whitelisted = false;
      }

      const result = await db.collection('guild_configs').insertOne(newGuildConfig);

      const createdConfig = await configService.getGuildConfig(guildData.guildId);
      res.status(201).json(createdConfig);
    } catch (error) {
      console.error('Error creating guild configuration:', error);
      res.status(500).json({ error: error.message });
    }
  }));

  // Get a specific guild configuration
  router.get('/:guildId', asyncHandler(async (req, res) => {
    const { guildId } = req.params;
    const guildConfig = await configService.getGuildConfig(guildId);

    if (!guildConfig) {
      return res.status(404).json({ error: 'Guild configuration not found' });
    }

    res.json(guildConfig);
  }));

  // Create or update a guild configuration
  router.post('/:guildId', asyncHandler(async (req, res) => {
    const { guildId } = req.params;
    const updates = req.body;

    try {
      // Extract signature data if present
      const signatureData = updates._signature;
      
      // Verify signature if provided
      if (signatureData) {
        const { walletAddress, message, signature, timestamp } = signatureData;
        
        // Validate signature components
        if (!walletAddress || !message || !signature || !timestamp) {
          return res.status(400).json({ error: 'Invalid signature data' });
        }
        
        // Check timestamp to prevent replay attacks (allow 5 minutes)
        const now = Date.now();
        if (Math.abs(now - Number(timestamp)) > 5 * 60 * 1000) {
          return res.status(400).json({ error: 'Signature expired' });
        }
        
        // Verify the signature matches the expected message
        const expectedMessage = `Save settings for guild ${guildId} at ${timestamp}`;
        if (message !== expectedMessage) {
          return res.status(400).json({ error: 'Signature message mismatch' });
        }
        
        // Verify signature cryptographically
        try {
          const pubKey = bs58.decode(walletAddress);
          const messageBytes = new TextEncoder().encode(message);
          const sigBytes = bs58.decode(signature);
          
          const valid = nacl.sign.detached.verify(messageBytes, sigBytes, pubKey);
          if (!valid) {
            return res.status(401).json({ error: 'Invalid signature' });
          }
        } catch (verifyError) {
          console.error('Signature verification error:', verifyError);
          return res.status(400).json({ error: 'Signature verification failed' });
        }
        
        // Verify the signing wallet matches the authenticated admin
        if (req.user?.walletAddress && req.user.walletAddress !== walletAddress) {
          return res.status(403).json({ error: 'Signature wallet does not match authenticated admin' });
        }
        
        // Remove signature data from updates before persisting
        delete updates._signature;
      }
      
      await configService.updateGuildConfig(guildId, updates);
      const updatedConfig = await configService.getGuildConfig(guildId);
      res.json(updatedConfig);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }));

  // Update specific guild settings
  router.patch('/:guildId', asyncHandler(async (req, res) => {
    const { guildId } = req.params;
    const updates = req.body;

    try {
      await configService.updateGuildConfig(guildId, updates);
      const updatedConfig = await configService.getGuildConfig(guildId);
      res.json(updatedConfig);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }));

  // Delete a guild configuration
  router.delete('/:guildId', asyncHandler(async (req, res) => {
    const { guildId } = req.params;

    try {
      const result = await db.collection('guild_configs').deleteOne({ guildId });

      if (result.deletedCount === 0) {
        return res.status(404).json({ error: 'Guild configuration not found' });
      }

      res.json({ message: 'Guild configuration deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }));

  // Get connected Discord servers (guilds)
  router.get('/connected/list', asyncHandler(async (req, res) => {
    try {
      // We'll need to query the Discord API or get this from our database
      const connectedGuilds = await db.collection('connected_guilds').find({}).toArray();

      res.json(connectedGuilds);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }));

  // Added route to handle guild config retrieval with database check
  router.get('/config/:guildId', asyncHandler(async (req, res) => {
    try {
      // Check if database is initialized
      if (!db) {
        console.error('Database connection not available');
        return res.status(503).json({ error: 'Database connection not available' });
      }

      const guildId = req.params.guildId;
      const config = await db.collection('guild_configs').findOne({ guildId });
      res.json(config || { guildId, whitelisted: false });
    } catch (error) {
      console.error('Error fetching guild config:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }));

  // Add endpoint to clear guild config cache and in-memory Discord authorization cache
  router.post('/:guildId/clear-cache', asyncHandler(async (req, res) => {
    try {
      const { guildId } = req.params;
      // Clear config cache entry
      if (typeof configService.clearCache === 'function') {
        await configService.clearCache(guildId);
      }
      // Also clear Discord client's authorized guilds cache if present
      try {
        if (client && client.authorizedGuilds instanceof Map) {
          client.authorizedGuilds.delete(guildId);
        }
      } catch {}
      res.json({ success: true, message: 'Guild caches cleared' });
    } catch (error) {
      console.error('Error clearing guild caches:', error);
      res.status(500).json({ error: 'Failed to clear caches' });
    }
  }));

  // Authorize a guild (sets authorized and whitelisted true) then clears caches
  router.post('/:guildId/authorize', asyncHandler(async (req, res) => {
    try {
      const { guildId } = req.params;
      
      // Try to get guild info from various sources
      let guildName = null;
      let guildIcon = null;
      let guildIconUrl = null;
      
      // 1. Try detected_guilds collection
      try {
        const detected = await db.collection('detected_guilds').findOne({ id: guildId });
        if (detected) {
          if (detected.name) guildName = detected.name;
          if (detected.icon) guildIcon = detected.icon;
          if (detected.iconUrl) guildIconUrl = detected.iconUrl;
        }
      } catch {}
      
      // 2. Try Discord client
      if (!guildName && client && client.guilds) {
        try {
          const guild = client.guilds.cache.get(guildId);
          if (guild) {
            if (guild.name) guildName = guild.name;
            if (guild.icon) guildIcon = guild.icon;
            if (guild.icon) guildIconUrl = `https://cdn.discordapp.com/icons/${guildId}/${guild.icon}.png`;
          }
        } catch {}
      }
      
      // 3. Try existing guild config
      if (!guildName) {
        try {
          const existing = await configService.getGuildConfig(guildId);
          if (existing) {
            if (existing.guildName) guildName = existing.guildName;
            if (!guildName && existing.name) guildName = existing.name;
            if (!guildIcon && existing.icon) guildIcon = existing.icon;
            if (!guildIconUrl && existing.iconUrl) guildIconUrl = existing.iconUrl;
          }
        } catch {}
      }
      
      // Build update object with name and icon if found
      const updateData = { 
        authorized: true, 
        whitelisted: true, 
        updatedAt: new Date() 
      };
      
      if (guildName) {
        updateData.guildName = guildName;
        updateData.name = guildName; // Also set name for backward compatibility
      }
      
      if (guildIcon) {
        updateData.icon = guildIcon;
      }
      
      if (guildIconUrl) {
        updateData.iconUrl = guildIconUrl;
      }
      
      await configService.updateGuildConfig(guildId, updateData);
      
      // Clear caches so change takes effect immediately
      try { if (typeof configService.clearCache === 'function') await configService.clearCache(guildId); } catch {}
      try { if (client && client.authorizedGuilds instanceof Map) client.authorizedGuilds.delete(guildId); } catch {}
      
      const updated = await configService.getGuildConfig(guildId, true);
      res.json({ success: true, message: 'Guild authorized', config: updated });
    } catch (error) {
      console.error('Error authorizing guild:', error);
      res.status(500).json({ error: 'Failed to authorize guild' });
    }
  }));

  // === Per-Guild X Account Overrides ===
  // Lightweight listing of X accounts for selection (id, avatar name, flags)
  router.get('/:guildId/x-accounts/options', asyncHandler(async (req, res) => {
    try {
      const xAuths = await db.collection('x_auth').find({ accessToken: { $exists: true, $ne: null } }).project({ accessToken: 0, refreshToken: 0 }).toArray();
      const results = [];
      for (const rec of xAuths) {
        let avatar = null;
        if (rec.avatarId) {
          try { avatar = await db.collection('avatars').findOne({ _id: rec.avatarId }); } catch {}
        }
        results.push({
          id: String(rec._id),
          avatarName: avatar?.name || rec.avatarId || 'unknown',
          global: !!rec.global,
          hasVideoCreds: !!rec.accessSecret, // heuristic: OAuth1 presence
          updatedAt: rec.updatedAt || rec.createdAt || null
        });
      }
      res.json({ xAccounts: results });
    } catch (e) {
      console.error('x-accounts options error:', e);
      res.status(500).json({ error: 'Failed to list X accounts' });
    }
  }));

  // Get current per-guild X account overrides
  router.get('/:guildId/x-accounts', asyncHandler(async (req, res) => {
    const { guildId } = req.params;
    try {
      const cfg = await db.collection('guild_configs').findOne({ guildId });
      res.json({ guildId, xAccounts: cfg?.xAccounts || { imageAuthId: null, videoAuthId: null } });
    } catch (e) {
      res.status(500).json({ error: 'Failed to load xAccounts' });
    }
  }));

  // Update per-guild X account overrides
  router.put('/:guildId/x-accounts', asyncHandler(async (req, res) => {
    const { guildId } = req.params;
    const body = req.body || {};
    try {
      const patch = { xAccounts: {} };
      if (body.imageAuthId !== undefined) patch.xAccounts.imageAuthId = body.imageAuthId || null;
      if (body.videoAuthId !== undefined) patch.xAccounts.videoAuthId = body.videoAuthId || null;
      await configService.updateGuildConfig(guildId, patch);
      const updated = await configService.getGuildConfig(guildId, true);
      res.json({ guildId, xAccounts: updated.xAccounts || { imageAuthId: null, videoAuthId: null } });
    } catch (e) {
      res.status(500).json({ error: 'Failed to save xAccounts' });
    }
  }));

  return router;
}
