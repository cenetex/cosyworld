import express from 'express';
import { ObjectId } from 'mongodb';
import { processImage } from '../../../../utils/processImage.mjs'; 
import { CrossmintService } from '../../../crossmint/crossmintService.mjs';

export default function tokenRoutes(db, crossmintOpts = {}) {
  const router = express.Router();
  const crossmint = new CrossmintService(crossmintOpts);

  /* ------------------------------------------------------ *
   * 1. Does this avatar already have a template / token ?  *
   * ------------------------------------------------------ */
  router.get('/check/:avatarId', async (req, res) => {
    try {
      const { avatarId } = req.params;
      const exists = await db.collection('avatar_tokens').findOne({
        avatarId: new ObjectId(avatarId)
      });
      res.json({ exists: !!exists });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /* ------------------------------------------------------ *
   * 2. Create (or update) an NFT template on Crossmint      *
   *    – returns the templateId + a Checkout URL            *
   * ------------------------------------------------------ */
  router.post('/template/:avatarId', async (req, res) => {
    try {
      const { avatarId } = req.params;
      const avatar = await db.collection('avatars').findOne({
        _id: new ObjectId(avatarId),
        claimed: true
      });
      if (!avatar) return res.status(404).json({ error: 'Avatar not found or not claimed' });

      // build icon / banner in memory
      const icon   = await processImage(avatar.imageUrl, 512, 512);
      const banner = await processImage(avatar.imageUrl, 512, 256);

      // upsert template on Crossmint
      const { templateId } = await crossmint.upsertTemplate({
        ...avatar,
        imageUrl: icon,
        banner
      });

      // pre‑generate a checkout link (user‑paid mint)
      const checkoutUrl = await crossmint.getCheckoutUrl(templateId);

      res.json({ success: true, templateId, checkoutUrl });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /* ------------------------------------------------------ *
   * 3. Airdrop (server‑side mint) to a wallet or e‑mail     *
   * ------------------------------------------------------ */
  router.post('/airdrop/:avatarId', async (req, res) => {
    try {
      const { avatarId } = req.params;
      const { recipient } = req.body;          // eth:0x…  or  email:user@example.com

      const tokenRow = await db.collection('avatar_tokens').findOne({
        avatarId: new ObjectId(avatarId)
      });
      if (!tokenRow?.templateId)
        return res.status(400).json({ error: 'Template not created yet' });

      const { mintId } = await crossmint.airdrop(tokenRow.templateId, recipient); // uses /nfts endpoint :contentReference[oaicite:4]{index=4}

      // persist mint
      await db.collection('avatar_tokens').updateOne(
        { avatarId: new ObjectId(avatarId) },
        { $set: { mintId, status: 'minting', updatedAt: new Date() }},
        { upsert: true }
      );

      res.json({ success: true, mintId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /* ------------------------------------------------------ *
   * 4. Poll Crossmint mint status                           *
   * ------------------------------------------------------ */
  router.get('/status/:mintId', async (req, res) => {
    try {
      const { mintId } = req.params;
      const { status, raw } = await crossmint.getMintStatus(mintId); // /nfts/{id} status :contentReference[oaicite:5]{index=5}
      res.json({ success: true, status, data: raw });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
