import express from 'express';

export default function createVideoJobsRouter(db) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const limit = Math.min(200, Number(req.query.limit || 50));
      const status = req.query.status;
      const q = status ? { status } : {};
      const docs = await db.collection('video_jobs')
        .find(q)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
      res.json({ jobs: docs });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
