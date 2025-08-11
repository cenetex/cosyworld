import { Router } from 'express';

export default function memoryRoutes(db) {
  const router = Router();

  // GET /api/memory/:avatarId
  router.get('/:avatarId', async (req, res) => {
    try {
      const { avatarId } = req.params;
      const { page = 1, limit = 50, minWeight = 0 } = req.query;
      const skip = (Number(page) - 1) * Number(limit);
      const q = { avatarId, weight: { $gte: Number(minWeight) } };
      const total = await db.collection('memories').countDocuments(q);
      const items = await db.collection('memories')
        .find(q)
        .sort({ ts: -1, timestamp: -1 })
        .skip(skip)
        .limit(Number(limit))
        .project({ text: 1, kind: 1, ts: 1, timestamp: 1, weight: 1 })
        .toArray();
      res.json({ total, page: Number(page), limit: Number(limit), items });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
