/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import express from 'express';
import crypto from 'crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { issueAuthCookie } from '../middleware/authCookie.js';

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export default function createAuthRouter(db) {
  const router = express.Router();
  const nonces = db.collection('wallet_nonces');
  const users = db.collection('users');

  // Issue a short-lived nonce for a wallet address
  router.post('/nonce', asyncHandler(async (req, res) => {
    const { address } = req.body || {};
    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'address is required' });
    }

    const nonce = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    await nonces.updateOne(
      { address },
      { $set: { address, nonce, expiresAt, updatedAt: new Date() } },
      { upsert: true }
    );

    res.json({ nonce, expiresAt });
  }));

  // Verify a signed nonce and upsert the user
  router.post('/verify', asyncHandler(async (req, res) => {
    const { address, nonce, signature } = req.body || {};
    if (!address || !nonce || !signature) {
      return res.status(400).json({ error: 'address, nonce, signature are required' });
    }

    const nonceDoc = await nonces.findOne({ address });
    if (!nonceDoc || nonceDoc.nonce !== nonce) {
      return res.status(400).json({ error: 'Invalid nonce' });
    }
    if (nonceDoc.expiresAt && new Date(nonceDoc.expiresAt).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Nonce expired' });
    }

    // Prepare data for verification
    const message = new TextEncoder().encode(nonce);
    let sigBytes;
    if (Array.isArray(signature)) {
      sigBytes = new Uint8Array(signature);
    } else if (typeof signature === 'string') {
      // try base58
      try { sigBytes = bs58.decode(signature); } catch { return res.status(400).json({ error: 'Invalid signature format' }); }
    } else {
      return res.status(400).json({ error: 'Unsupported signature format' });
    }

    let pubKeyBytes;
    try {
      pubKeyBytes = bs58.decode(address);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid address format' });
    }

    const ok = nacl.sign.detached.verify(message, sigBytes, pubKeyBytes);
    if (!ok) {
      return res.status(401).json({ error: 'Signature verification failed' });
    }

    // Clear nonce after successful verify
    await nonces.deleteOne({ address });

    // Admin bootstrapping: first user becomes admin
    const existingAdmin = await users.findOne({ isAdmin: true });
    const now = new Date();

    const update = {
      $setOnInsert: { createdAt: now },
      $set: { walletAddress: address, updatedAt: now },
    };

    const upsertRes = await users.findOneAndUpdate(
      { walletAddress: address },
      update,
      { upsert: true, returnDocument: 'after' }
    );

    // Some drivers may return null value on upsert; fetch explicitly
    let user = upsertRes?.value || await users.findOne({ walletAddress: address });
    if (!existingAdmin && !user.isAdmin) {
      await users.updateOne({ _id: user._id }, { $set: { isAdmin: true, updatedAt: new Date() } });
      user = await users.findOne({ _id: user._id });
    } else if (!user.isAdmin) {
      // Ensure others start with no rights
      await users.updateOne({ _id: user._id }, { $set: { isAdmin: false } });
      user = await users.findOne({ _id: user._id });
    }

  // Issue httpOnly auth cookie
  issueAuthCookie(res, { addr: user.walletAddress, isAdmin: !!user.isAdmin });

  res.json({ ok: true, user: { walletAddress: user.walletAddress, isAdmin: !!user.isAdmin } });
  }));

  // Return current session user
  router.get('/me', (req, res) => {
    const u = req.user ? { walletAddress: req.user.walletAddress, isAdmin: !!req.user.isAdmin } : null;
    res.json({ user: u });
  });

  // Logout: clear cookie
  router.post('/logout', (req, res) => {
    res.clearCookie('authToken', { path: '/' });
    res.json({ ok: true });
  });

  return router;
}
