/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import express from 'express';
import { ObjectId } from 'mongodb';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const router = express.Router();

export default function(db) {
  // Ownership checks
  async function holdsAnyFromCollection({ walletAddress, collectionKey, chain, provider, apiKey }) {
    try {
      chain = (chain || '').toLowerCase();
      provider = (provider || '').toLowerCase();
      apiKey = apiKey || process.env.NFT_API_KEY || process.env.ALCHEMY_API_KEY || process.env.HELIUS_API_KEY || process.env.RESERVOIR_API_KEY || process.env.OPENSEA_API_KEY;
      if (!apiKey) return false;
      // Solana via Helius
      if (chain === 'solana' || provider === 'helius') {
        try {
          const endpoint = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
          const body = JSON.stringify({ jsonrpc:'2.0', id:'1', method:'getAssetsByOwner', params:{ ownerAddress: walletAddress, page:1, limit:1000 } });
          const res = await fetch(endpoint, { method:'POST', headers:{ 'Content-Type':'application/json' }, body });
          if (!res.ok) return false;
          const json = await res.json();
          const items = json?.result?.items || [];
          return items.some(it => it?.grouping?.some(g => g.group_key === 'collection' && g.group_value === collectionKey) || it?.creators?.some(c => c.address === collectionKey));
        } catch { return false; }
      }
      // EVM via Alchemy: requires contract address as collectionKey
      if (/^0x[a-fA-F0-9]{40}$/.test(collectionKey)) {
        const host = chain.includes('base') ? 'base-mainnet.g.alchemy.com' : chain.includes('polygon') ? 'polygon-mainnet.g.alchemy.com' : 'eth-mainnet.g.alchemy.com';
        const url = new URL(`https://${host}/nft/v3/${apiKey}/getNFTs`);
        url.searchParams.set('owner', walletAddress);
        url.searchParams.set('contractAddresses[]', collectionKey);
        const res = await fetch(url);
        if (!res.ok) return false;
        const json = await res.json();
        const owned = json?.ownedNfts || json?.ownedNftsV2 || json?.ownedNftsList || [];
        return (owned.length || 0) > 0;
      }
      // Reservoir/OS fallback not implemented for wallet check
      return false;
    } catch { return false; }
  }

  async function holdsSpecificToken({ walletAddress, collectionKey, tokenId, chain, apiKey }) {
    try {
      chain = (chain || '').toLowerCase();
      apiKey = apiKey || process.env.ALCHEMY_API_KEY || process.env.NFT_API_KEY;
      if (!apiKey) return false;
      // EVM specific token via Alchemy Ownership
      if (/^0x[a-fA-F0-9]{40}$/.test(collectionKey)) {
        const host = chain.includes('base') ? 'base-mainnet.g.alchemy.com' : chain.includes('polygon') ? 'polygon-mainnet.g.alchemy.com' : 'eth-mainnet.g.alchemy.com';
        const url = new URL(`https://${host}/nft/v3/${apiKey}/isOwnerOfContract`);
        url.searchParams.set('owner', walletAddress);
        url.searchParams.set('contractAddress', collectionKey);
        // Alchemy v3 has isOwnerOfNft endpoint in some SDKs; fallback: list NFTs with page filtering
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          if (json?.isOwnerOfContract === false) return false;
        }
        // Fetch NFTs and check tokenId
        const listUrl = new URL(`https://${host}/nft/v3/${apiKey}/getNFTs`);
        listUrl.searchParams.set('owner', walletAddress);
        listUrl.searchParams.set('contractAddresses[]', collectionKey);
        const lr = await fetch(listUrl);
        if (!lr.ok) return false;
        const lj = await lr.json();
        const owned = lj?.ownedNfts || [];
        return owned.some(n => (n.tokenId || n.id?.tokenId || '').replace(/^0x/,'').toLowerCase() === String(tokenId).replace(/^0x/,'').toLowerCase());
      }
      // Solana specific token via Helius owner lookup
      if (chain === 'solana') {
        const endpoint = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
        const body = JSON.stringify({ jsonrpc:'2.0', id:'1', method:'getAsset', params:{ id: tokenId } });
        const res = await fetch(endpoint, { method:'POST', headers:{ 'Content-Type':'application/json' }, body });
        if (!res.ok) return false;
        const json = await res.json();
        const owner = json?.result?.ownership?.owner || json?.result?.ownership?.ownerAddress;
        return owner && owner === walletAddress;
      }
      return false;
    } catch { return false; }
  }
  if (!db) {
    console.error('Database connection not provided to claims route');
    throw new Error('Database not connected');
  }

  // **Utility Functions**

  /**
   * Verifies a signature for a claim using Solana's verification method
   * @param {string} message - The message that was signed
   * @param {string} signatureHex - The signature in hex format
   * @param {string} walletAddress - The Solana wallet address (base58 encoded)
   * @returns {Promise<boolean>} - Whether the signature is valid
   */
  const verifySignature = async (message, signatureHex, walletAddress) => {
    try {
      console.log('Verifying signature with:', { message, signatureHex, walletAddress });
      const signatureBytes = Buffer.from(signatureHex, 'hex');
      const messageBytes = new TextEncoder().encode(message);
      const publicKey = bs58.decode(walletAddress);
      return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey);
    } catch (error) {
      console.error('Signature verification error:', error);
      return false;
    }
  };

  /**
   * Checks claim allowance for a wallet
   * @param {string} walletAddress - The wallet address to check
   * @returns {Promise<{allowed: boolean, remaining: number, current: number}>} - Claim allowance details
   */
  const checkClaimAllowance = async (walletAddress) => {
    const existingClaims = await db.collection('avatar_claims').countDocuments({
      walletAddress: walletAddress
    });
    const MAX_CLAIMS_PER_WALLET = parseInt(process.env.MAX_CLAIMS_PER_WALLET || '3');
    return {
      allowed: existingClaims < MAX_CLAIMS_PER_WALLET,
      remaining: Math.max(0, MAX_CLAIMS_PER_WALLET - existingClaims),
      current: existingClaims
    };
  };

  // **Routes**

  // Check claim status for an avatar
  router.get('/status/:avatarId', async (req, res) => {
    try {
      const { avatarId } = req.params;
      let objectId;
      try {
        objectId = new ObjectId(avatarId);
      } catch {
        return res.status(400).json({ error: 'Invalid avatar ID format' });
      }

      const avatar = await db.collection('avatars').findOne({ _id: objectId });
      if (!avatar) {
        return res.status(404).json({ error: 'Avatar not found' });
      }

      const claim = await db.collection('avatar_claims').findOne({ avatarId: objectId });
      if (claim) {
        return res.json({
          claimed: claim.status === 'pending' || claim.status === 'claimed' ||  claim.status === 'minted',
          claimedBy: claim.walletAddress,
          claimedAt: claim.updatedAt,
          minted: claim.status === 'minted'
        });
      }
      return res.json({ claimed: false });
    } catch (error) {
      console.error('Claim status check error:', error);
      res.status(500).json({
        error: 'Failed to check claim status',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // Get all claims for a user
  router.get('/user/:walletAddress', async (req, res) => {
    try {
      const { walletAddress } = req.params;
      const claims = await db.collection('avatar_claims')
        .find({ walletAddress: walletAddress })
        .toArray();

      const avatarIds = claims.map(claim => new ObjectId(claim.avatarId));
      const avatars = avatarIds.length > 0
        ? await db.collection('avatars').find({ _id: { $in: avatarIds } }).toArray()
        : [];

      const claimedAvatars = claims.map(claim => ({
        claim,
        avatar: avatars.find(a => a._id.toString() === claim.avatarId.toString()) || null
      }));

      const allowance = await checkClaimAllowance(walletAddress);
      res.json({ claims: claimedAvatars, allowance });
    } catch (error) {
      console.error('User claims fetch error:', error);
      res.status(500).json({
        error: 'Failed to fetch user claims',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // Claim an avatar (enforces collection-config policies)
  router.post('/claim', async (req, res) => {
    try {
      const { avatarId, walletAddress, signature, message } = req.body;
      if (!avatarId || !walletAddress || !signature || !message) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const normalizedWalletAddress = walletAddress;

      let objectId;
      try {
        objectId = new ObjectId(avatarId);
      } catch {
        return res.status(400).json({ error: 'Invalid avatar ID format' });
      }

  const avatar = await db.collection('avatars').findOne({ _id: objectId });
      if (!avatar) {
        return res.status(404).json({ error: 'Avatar not found' });
      }

      const existingClaim = await db.collection('avatar_claims').findOne({ avatarId: objectId });
      if (existingClaim) {
        console.log('Avatar already claimed:', existingClaim.walletAddress);
        return res.status(409).json({
          error: 'Avatar already claimed',
          claimedBy: existingClaim.walletAddress
        });
      }

  const isValidSignature = await verifySignature(message, signature, normalizedWalletAddress);
      if (!isValidSignature) {
        console.log('Invalid signature for wallet:', normalizedWalletAddress);
        return res.status(401).json({ error: 'Invalid signature' });
      }

      // Determine collection policy
  const collKey = avatar?.nft?.collection || null;
      let policy = collKey ? 'strictTokenOwner' : 'free', chain = 'ethereum', provider = '', gateTarget = '';
      if (collKey) {
        const cfg = await db.collection('collection_configs').findOne({ key: collKey });
        if (cfg) {
          policy = cfg.claimPolicy || policy;
          chain = (cfg.chain || chain).toLowerCase();
          provider = cfg.provider || '';
          gateTarget = cfg.gateTarget || '';
        }
      }

      console.log('Claim policy for avatar', avatarId, ':', policy, 'collection:', collKey, 'chain:', chain);

      // Enforce ownership per policy
      if (policy === 'strictTokenOwner') {
        const ok = await holdsSpecificToken({ walletAddress: normalizedWalletAddress, collectionKey: collKey, tokenId: avatar?.nft?.tokenId, chain });
        console.log('Ownership check result:', ok, 'tokenId:', avatar?.nft?.tokenId);
        if (!ok) return res.status(403).json({ error: 'Ownership required: not the NFT owner' });
      } else if (policy === 'anyTokenHolder') {
        const ok = await holdsAnyFromCollection({ walletAddress: normalizedWalletAddress, collectionKey: collKey, chain, provider });
        if (!ok) return res.status(403).json({ error: 'Ownership required: hold any token in collection' });
      } else if (policy === 'orbGate') {
        if (!gateTarget) return res.status(400).json({ error: 'Orb gate misconfigured: missing gateTarget' });
        const gateCfg = await db.collection('collection_configs').findOne({ key: gateTarget });
        const gateChain = (gateCfg?.chain || 'ethereum').toLowerCase();
        const gateProv = gateCfg?.provider || '';
        const ok = await holdsAnyFromCollection({ walletAddress: normalizedWalletAddress, collectionKey: gateTarget, chain: gateChain, provider: gateProv });
        if (!ok) return res.status(403).json({ error: 'Orb required: hold an orb to claim' });
      } else if (policy === 'free') {
        // No ownership check required
        console.log('Free claim allowed');
      }

      const allowance = await checkClaimAllowance(normalizedWalletAddress);
      if (!allowance.allowed) {
        console.log('Claim limit reached for wallet:', normalizedWalletAddress, allowance);
        return res.status(403).json({ error: 'Claim limit reached', allowance });
      }

      const now = new Date();
      const claim = {
        avatarId: objectId,
        walletAddress: normalizedWalletAddress, // Store as-is
        signature,
        message,
        createdAt: now,
        updatedAt: now,
        status: 'pending'
      };

      // Insert claim with unique constraint handling
      try {
        await db.collection('avatar_claims').insertOne(claim);
        console.log('Claim inserted successfully for avatar', avatarId);
      } catch (error) {
        if (error.code === 11000) { // Duplicate key error
          return res.status(409).json({ error: 'Avatar already claimed by another wallet' });
        }
        throw error;
      }

      await db.collection('avatars').updateOne(
        { _id: objectId },
        {
          $set: {
            claimed: true,
            claimedBy: normalizedWalletAddress, // Store as-is
            claimedAt: now
          }
        }
      );

      const updatedAllowance = await checkClaimAllowance(normalizedWalletAddress);
      console.log('Claim completed successfully');
      res.status(201).json({
        success: true,
        claim: {
          avatarId,
          walletAddress: normalizedWalletAddress,
          status: 'pending',
          createdAt: now
        },
        allowance: updatedAllowance
      });
    } catch (error) {
      console.error('Claim creation error:', error);
      res.status(500).json({
        error: 'Failed to process claim',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // Mint a claimed avatar (admin only)
  router.post('/mint/:claimId', async (req, res) => {
    try {
      const { claimId } = req.params;
      const { adminKey } = req.body;

      if (adminKey !== process.env.ADMIN_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      let objectId;
      try {
        objectId = new ObjectId(claimId);
      } catch {
        return res.status(400).json({ error: 'Invalid claim ID format' });
      }

      const claim = await db.collection('avatar_claims').findOne({ _id: objectId });
      if (!claim) {
        return res.status(404).json({ error: 'Claim not found' });
      }

      const avatar = await db.collection('avatars').findOne({ _id: claim.avatarId });
      if (!avatar) {
        return res.status(404).json({ error: 'Avatar not found' });
      }

      // Simulate minting (replace with actual minting logic in production)
      await db.collection('avatar_claims').updateOne(
        { _id: objectId },
        {
          $set: {
            status: 'minted',
            mintedAt: new Date(),
            mintTxId: `simulated-tx-${Date.now()}`
          }
        }
      );

      res.json({
        success: true,
        status: 'minted',
        avatar: { id: avatar._id, name: avatar.name }
      });
    } catch (error) {
      console.error('Minting error:', error);
      res.status(500).json({
        error: 'Failed to process minting',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  return router;
}