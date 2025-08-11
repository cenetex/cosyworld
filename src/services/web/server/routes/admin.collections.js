/**
 * Admin Collections API: manage collection configs and trigger syncs.
 */
import express from 'express';
import { syncAvatarsForCollection } from '../../../collections/collectionSyncService.mjs';

export default function(db) {
  if (!db) throw new Error('Database not connected');
  const router = express.Router();
  const configs = db.collection('collection_configs');

  // Ensure indexes
  configs.createIndex({ key: 1 }, { unique: true }).catch(()=>{});

  // List configs
  router.get('/configs', async (req, res) => {
    const list = await configs.find().sort({ updatedAt: -1 }).limit(200).toArray();
    res.json({ data: list });
  });

  // Upsert config
  router.post('/configs', async (req, res) => {
    const body = req.body || {};
    if (!body.key) return res.status(400).json({ error: 'key is required' });
    const now = new Date();
    body.updatedAt = now;
    if (!body.createdAt) body.createdAt = now;
    await configs.updateOne({ key: body.key }, { $set: body }, { upsert: true });
    const saved = await configs.findOne({ key: body.key });
    res.json({ success: true, config: saved });
  });

  // Trigger sync now
  router.post('/:key/sync', async (req, res) => {
    const { key } = req.params;
    const cfg = await configs.findOne({ key });
    if (!cfg) return res.status(404).json({ error: 'Config not found' });
    const provider = cfg.provider || process.env.NFT_API_PROVIDER || '';
    const apiKey = req.body?.apiKey || process.env.NFT_API_KEY || process.env.RESERVOIR_API_KEY || process.env.OPENSEA_API_KEY || process.env.ALCHEMY_API_KEY || process.env.HELIUS_API_KEY;
    const chain = (cfg.chain || process.env.NFT_CHAIN || 'ethereum').toLowerCase();
    const fileSource = (cfg.sync?.source?.includes('file') && cfg.sync?.fileSource) ? cfg.sync.fileSource : undefined;
    const force = !!req.body?.force;
    try {
      const progressCol = db.collection('collection_sync_progress');
  const startDoc = { key, startedAt: new Date(), total: 0, processed: 0, success: 0, failures: 0, recent: [], done: false };
      await progressCol.updateOne({ key }, { $set: startDoc }, { upsert: true });

    const reporter = async ({ total, processed, success, failures, nft, error, startedAt }) => {
        const name = nft?.name || nft?.tokenId || 'unknown';
        const recent = { name, ok: !error, error: error || null, at: new Date() };
        // Keep only the last 15 items
        await progressCol.updateOne(
          { key },
          [
            { $set: {
        ...(total !== undefined ? { total } : {}),
        ...(startedAt ? { startedAt } : {}),
              processed: processed,
              success: success,
              failures: failures,
              updatedAt: new Date(),
              recent: { $slice: [ { $concatArrays: [ { $ifNull: [ "$recent", [] ] }, [ recent ] ] }, -15 ] }
            } }
          ]
        ).catch(async () => {
          // Fallback without pipeline if unsupported
          const doc = await progressCol.findOne({ key });
          const list = Array.isArray(doc?.recent) ? doc.recent.slice(-14) : [];
          list.push(recent);
      const patch = { processed, success, failures, updatedAt: new Date(), recent: list };
      if (total !== undefined) patch.total = total;
      if (startedAt) patch.startedAt = startedAt;
      await progressCol.updateOne({ key }, { $set: patch });
        });
      };

      const result = await syncAvatarsForCollection({ collectionId: key, provider, apiKey, chain, fileSource, force }, reporter);
      // mark done and store result
      await progressCol.updateOne({ key }, { $set: { done: true, completedAt: new Date(), result } });
      await configs.updateOne({ key }, { $set: { lastSyncAt: new Date(), lastSyncResult: result } });
      res.json({ success: true, result });
    } catch (e) {
      // mark failure
      try { await db.collection('collection_sync_progress').updateOne({ key }, { $set: { done: true, error: e.message, completedAt: new Date() } }, { upsert: true }); } catch {}
      res.status(500).json({ error: e.message });
    }
  });

  // Poll sync progress
  router.get('/:key/sync/progress', async (req, res) => {
    const { key } = req.params;
    const doc = await db.collection('collection_sync_progress').findOne({ key });
    if (!doc) return res.json({ key, done: false, processed: 0, success: 0, failures: 0, recent: [] });
    res.json({ key, ...doc });
  });

  // List all progress (for rendering bars inline on the collection cards)
  router.get('/progress/all', async (_req, res) => {
    const list = await db.collection('collection_sync_progress')
      .find({}, { projection: { _id: 0 } })
      .toArray();
    res.json({ data: list });
  });

  // Status
  router.get('/:key/status', async (req, res) => {
    const { key } = req.params;
    const cfg = await configs.findOne({ key });
    if (!cfg) return res.status(404).json({ error: 'Config not found' });
    const count = await db.collection('avatars').countDocuments({ $or: [{ 'nft.collection': key }, { collection: key }] });
    res.json({ key, lastSyncAt: cfg.lastSyncAt || null, count });
  });

  return router;
}
