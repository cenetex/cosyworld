/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { Router } from 'express';

export default function inviteRoutes(db, services) {
  const router = Router();
  const invites = db.collection('admin_invites');
  const users = db.collection('users');

  // Validate token
  router.get('/:token', async (req, res) => {
    try {
      const { token } = req.params;
      const invite = await invites.findOne({ token, used: false });

      if (!invite) {
        return res.status(404).json({ valid: false, error: 'Invalid or used invite' });
      }

      if (new Date() > invite.expiresAt) {
        return res.status(400).json({ valid: false, error: 'Invite expired' });
      }

      res.json({ valid: true, expiresAt: invite.expiresAt });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Accept invite
  router.post('/accept', async (req, res) => {
    try {
      const { token, walletAddress, signature } = req.body;
      
      if (!token || !walletAddress) {
        return res.status(400).json({ error: 'Token and wallet address required' });
      }

      // 1. Validate Invite
      const invite = await invites.findOne({ token, used: false });
      if (!invite) return res.status(404).json({ error: 'Invalid or used invite' });
      if (new Date() > invite.expiresAt) return res.status(400).json({ error: 'Invite expired' });

      // 2. Verify Wallet Signature (Proof of Ownership)
      // We reuse the xService signature verification or similar logic
      // For now, we'll assume the client has already authenticated via the standard auth flow
      // and we are trusting the session if it exists.
      // BUT, the user might be new.
      // Ideally, we should require a signature of the token itself.
      
      // Let's verify the signature of the token string signed by the wallet
      // Using the same verification logic as auth.js or xService
      // For simplicity, let's use the xService helper if available, or reimplement basic verification
      
      let verified = false;
      if (services.xService && services.xService.verifyWalletSignature) {
         // verifyWalletSignature(message, signature, walletAddress)
         // We expect the message to be the token
         verified = services.xService.verifyWalletSignature(token, signature, walletAddress);
      } else {
         // Fallback or error if we can't verify
         // We can try to import the verify logic from auth.js but it's not exported
         // Let's assume xService is available as it's core
         return res.status(500).json({ error: 'Signature verification service unavailable' });
      }

      if (!verified) {
        return res.status(401).json({ error: 'Invalid wallet signature' });
      }

      // 3. Grant Admin Access
      const now = new Date();
      await users.updateOne(
        { walletAddress: { $regex: new RegExp(`^${walletAddress}$`, 'i') } },
        { 
          $set: { 
            isAdmin: true, 
            updatedAt: now,
            invitedBy: invite.createdBy,
            inviteToken: token
          },
          $setOnInsert: { createdAt: now }
        },
        { upsert: true }
      );

      // 4. Mark Invite Used
      await invites.updateOne(
        { _id: invite._id },
        { $set: { used: true, usedBy: walletAddress, usedAt: now } }
      );

      res.json({ success: true });

    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
