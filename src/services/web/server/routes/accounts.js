import express from 'express';
import { ObjectId } from 'mongodb';

export default function accountRoutes(services) {
  const router = express.Router();
  const accountService = services.botAccountService;

  router.get('/:avatarId', async (req, res) => {
    const avatarId = req.params.avatarId;
    const accounts = await accountService.getAccounts(avatarId);
    res.json({ data: accounts });
  });

  router.post('/link', async (req, res) => {
    const { avatarId, platform, accountId, accessToken } = req.body;
    if (!avatarId || !platform) return res.status(400).json({ error: 'Missing parameters' });
    const account = await accountService.linkAccount(avatarId, platform, { accountId, accessToken });
    res.json({ data: account });
  });

  router.post('/unlink', async (req, res) => {
    const { avatarId, platform } = req.body;
    if (!avatarId || !platform) return res.status(400).json({ error: 'Missing parameters' });
    await accountService.unlinkAccount(avatarId, platform);
    res.json({ success: true });
  });

  return router;
}
