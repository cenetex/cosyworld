/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * routes/nft.js
 * 
 * NFT-related endpoints for avatar deployment to Arweave
 * Generates Base (ERC-721) and Solana metadata manifests
 */

import express from 'express';
import { ObjectId } from 'mongodb';

const router = express.Router();

/**
 * Generate NFT metadata manifests for an avatar
 * GET /api/nft/avatar/:avatarId/metadata
 * Returns Base (ERC-721) and Solana metadata
 */
router.get('/avatar/:avatarId/metadata', async (req, res) => {
  try {
    const { avatarId } = req.params;
    const { services } = req.app.locals;
    const { databaseService, nftMetadataService, logger } = services;

    // Validate avatar ID
    if (!ObjectId.isValid(avatarId)) {
      return res.status(400).json({ error: 'Invalid avatar ID' });
    }

    // Get avatar from database
    const avatar = await databaseService.db.collection('avatars').findOne({
      _id: new ObjectId(avatarId)
    });

    if (!avatar) {
      return res.status(404).json({ error: 'Avatar not found' });
    }

    // Check if avatar has an image
    const imageUrl = avatar.avatarImageUrl || avatar.generatedImageUrl;
    if (!imageUrl) {
      return res.status(400).json({ error: 'Avatar has no image' });
    }

    // Generate deployment manifest
    const manifest = nftMetadataService.generateDeploymentManifest(avatar, {
      imageUrl,
      sellerFeeBasisPoints: 500, // 5% royalty
      creators: [] // Can be customized based on avatar creator
    });

    logger?.info?.(`[NFT API] Generated metadata for avatar: ${avatar.name} (${avatarId})`);

    res.json(manifest);
  } catch (error) {
    const { logger } = req.app.locals.services;
    logger?.error?.('[NFT API] Error generating metadata:', error);
    res.status(500).json({ error: 'Failed to generate metadata', message: error.message });
  }
});

/**
 * Deploy avatar NFT to Arweave
 * POST /api/nft/avatar/:avatarId/deploy
 * Uploads image and metadata to Arweave
 */
router.post('/avatar/:avatarId/deploy', async (req, res) => {
  try {
    const { avatarId } = req.params;
    const { walletConnected } = req.body;
    const { services } = req.app.locals;
    const { databaseService, nftMetadataService, arweaveService, logger } = services;

    // Validate avatar ID
    if (!ObjectId.isValid(avatarId)) {
      return res.status(400).json({ error: 'Invalid avatar ID' });
    }

    // Get avatar from database
    const avatar = await databaseService.db.collection('avatars').findOne({
      _id: new ObjectId(avatarId)
    });

    if (!avatar) {
      return res.status(404).json({ error: 'Avatar not found' });
    }

    // Check if avatar has an image
    const imageUrl = avatar.avatarImageUrl || avatar.generatedImageUrl;
    if (!imageUrl) {
      return res.status(400).json({ error: 'Avatar has no image' });
    }

    // Check if Arweave is configured
    if (!arweaveService || !arweaveService.arweave) {
      logger?.warn?.('[NFT API] Arweave not configured, simulating deployment');
      
      // Simulate deployment for testing
      const manifest = nftMetadataService.generateDeploymentManifest(avatar, { imageUrl });
      const mockResult = {
        avatar: {
          id: avatar._id.toString(),
          name: avatar.name
        },
        image: {
          txId: 'MOCK_IMAGE_TX_' + Date.now(),
          url: `https://arweave.net/MOCK_IMAGE_TX_${Date.now()}`,
          status: 200,
          statusText: 'OK (Simulated)',
          contentType: 'image/png',
          type: 'image'
        },
        base: {
          txId: 'MOCK_BASE_TX_' + Date.now(),
          url: `https://arweave.net/MOCK_BASE_TX_${Date.now()}`,
          status: 200,
          statusText: 'OK (Simulated)',
          chain: 'base',
          type: 'metadata'
        },
        solana: {
          txId: 'MOCK_SOLANA_TX_' + Date.now(),
          url: `https://arweave.net/MOCK_SOLANA_TX_${Date.now()}`,
          status: 200,
          statusText: 'OK (Simulated)',
          chain: 'solana',
          type: 'metadata'
        },
        deployed: new Date().toISOString(),
        simulated: true
      };

      // Update avatar with simulated deployment info
      await databaseService.db.collection('avatars').updateOne(
        { _id: new ObjectId(avatarId) },
        {
          $set: {
            nftDeployment: mockResult,
            nftDeployedAt: new Date()
          }
        }
      );

      return res.json(mockResult);
    }

    // Generate metadata
    const manifest = nftMetadataService.generateDeploymentManifest(avatar, {
      imageUrl,
      sellerFeeBasisPoints: 500,
      creators: []
    });

    logger?.info?.(`[NFT API] Deploying avatar to Arweave: ${avatar.name} (${avatarId})`);

    // Deploy to Arweave
    const deployment = await arweaveService.uploadNftDeployment(avatar, manifest);

    // Update avatar with deployment info
    await databaseService.db.collection('avatars').updateOne(
      { _id: new ObjectId(avatarId) },
      {
        $set: {
          nftDeployment: deployment,
          nftDeployedAt: new Date()
        }
      }
    );

    logger?.info?.(`[NFT API] Successfully deployed avatar: ${avatar.name} to Arweave`);
    logger?.info?.(`[NFT API] Image TX: ${deployment.image.txId}`);
    logger?.info?.(`[NFT API] Base TX: ${deployment.base.txId}`);
    logger?.info?.(`[NFT API] Solana TX: ${deployment.solana.txId}`);

    res.json(deployment);
  } catch (error) {
    const { logger } = req.app.locals.services;
    logger?.error?.('[NFT API] Error deploying to Arweave:', error);
    res.status(500).json({ error: 'Failed to deploy to Arweave', message: error.message });
  }
});

/**
 * Get NFT deployment status for an avatar
 * GET /api/nft/avatar/:avatarId/status
 * Returns deployment information if exists
 */
router.get('/avatar/:avatarId/status', async (req, res) => {
  try {
    const { avatarId } = req.params;
    const { services } = req.app.locals;
    const { databaseService, logger } = services;

    // Validate avatar ID
    if (!ObjectId.isValid(avatarId)) {
      return res.status(400).json({ error: 'Invalid avatar ID' });
    }

    // Get avatar from database
    const avatar = await databaseService.db.collection('avatars').findOne(
      { _id: new ObjectId(avatarId) },
      { projection: { nftDeployment: 1, nftDeployedAt: 1, name: 1 } }
    );

    if (!avatar) {
      return res.status(404).json({ error: 'Avatar not found' });
    }

    if (!avatar.nftDeployment) {
      return res.json({
        deployed: false,
        message: 'Avatar has not been deployed to Arweave'
      });
    }

    logger?.info?.(`[NFT API] Fetched deployment status for avatar: ${avatar.name} (${avatarId})`);

    res.json({
      deployed: true,
      deployment: avatar.nftDeployment,
      deployedAt: avatar.nftDeployedAt
    });
  } catch (error) {
    const { logger } = req.app.locals.services;
    logger?.error?.('[NFT API] Error fetching deployment status:', error);
    res.status(500).json({ error: 'Failed to fetch deployment status', message: error.message });
  }
});

/**
 * List all deployed NFTs
 * GET /api/nft/deployed
 * Returns all avatars that have been deployed to Arweave
 */
router.get('/deployed', async (req, res) => {
  try {
    const { services } = req.app.locals;
    const { databaseService, logger } = services;

    const limit = parseInt(req.query.limit) || 50;
    const skip = parseInt(req.query.skip) || 0;

    const avatars = await databaseService.db.collection('avatars')
      .find({ nftDeployment: { $exists: true } })
      .sort({ nftDeployedAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    const total = await databaseService.db.collection('avatars')
      .countDocuments({ nftDeployment: { $exists: true } });

    logger?.info?.(`[NFT API] Listed ${avatars.length} deployed NFTs`);

    res.json({
      avatars: avatars.map(a => ({
        id: a._id.toString(),
        name: a.name,
        imageUrl: a.avatarImageUrl || a.generatedImageUrl,
        deployment: a.nftDeployment,
        deployedAt: a.nftDeployedAt
      })),
      total,
      limit,
      skip
    });
  } catch (error) {
    const { logger } = req.app.locals.services;
    logger?.error?.('[NFT API] Error listing deployed NFTs:', error);
    res.status(500).json({ error: 'Failed to list deployed NFTs', message: error.message });
  }
});

export default router;
