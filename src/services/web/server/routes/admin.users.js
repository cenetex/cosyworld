/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { Router } from 'express';
import crypto from 'crypto';
import { ObjectId } from 'mongodb';

export default function adminUsersRoutes(db, services) {
  const router = Router();
  const users = db.collection('users');
  const invites = db.collection('admin_invites');

  // List all admins
  router.get('/', async (req, res) => {
    try {
      // Get DB admins
      const dbAdmins = await users.find({ isAdmin: true }).toArray();
      
      // Get Env admins
      const envAdminRaw = (process.env.ADMIN_WALLETS || process.env.ADMIN_WALLET || '').trim();
      const envAdmins = envAdminRaw
        ? envAdminRaw.split(/[,\s]+/).filter(Boolean).map(a => a.toLowerCase())
        : [];

      // Merge lists
      const adminMap = new Map();
      
      // Add DB admins
      dbAdmins.forEach(u => {
        adminMap.set(u.walletAddress.toLowerCase(), {
          walletAddress: u.walletAddress,
          source: 'database',
          createdAt: u.createdAt,
          lastLogin: u.updatedAt
        });
      });

      // Add Env admins
      envAdmins.forEach(addr => {
        const existing = adminMap.get(addr);
        if (existing) {
          existing.source = 'env+database';
          existing.isEnv = true;
        } else {
          adminMap.set(addr, {
            walletAddress: addr,
            source: 'environment',
            isEnv: true
          });
        }
      });

      res.json({ admins: Array.from(adminMap.values()) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Generate an invite link
  router.post('/invite', async (req, res) => {
    try {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      await invites.insertOne({
        token,
        createdBy: req.user.walletAddress,
        createdAt: new Date(),
        expiresAt,
        used: false
      });

      const baseUrl = services.configService?.get('server.publicUrl') || process.env.PUBLIC_URL || 'http://localhost:3000';
      const inviteUrl = `${baseUrl}/invite.html?token=${token}`;

      res.json({ token, inviteUrl, expiresAt });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Remove an admin
  router.post('/remove', async (req, res) => {
    try {
      const { walletAddress } = req.body;
      if (!walletAddress) return res.status(400).json({ error: 'Wallet address required' });

      // Prevent removing self
      if (walletAddress.toLowerCase() === req.user.walletAddress.toLowerCase()) {
        return res.status(400).json({ error: 'Cannot remove yourself' });
      }

      // Check if env admin
      const envAdminRaw = (process.env.ADMIN_WALLETS || process.env.ADMIN_WALLET || '').trim();
      const envAdmins = envAdminRaw
        ? envAdminRaw.split(/[,\s]+/).filter(Boolean).map(a => a.toLowerCase())
        : [];
      
      if (envAdmins.includes(walletAddress.toLowerCase())) {
        return res.status(400).json({ error: 'Cannot remove an environment-configured admin via API' });
      }

      await users.updateOne(
        { walletAddress: { $regex: new RegExp(`^${walletAddress}$`, 'i') } },
        { $set: { isAdmin: false, updatedAt: new Date() } }
      );

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
