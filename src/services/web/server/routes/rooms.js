import express from 'express';
export default function roomRoutes(db) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const rooms = await db.collection('rooms').find().toArray();
    res.json({ data: rooms });
  });

  router.get('/location/:locationId', async (req, res) => {
    const locationId = req.params.locationId;
    const rooms = await db.collection('rooms').find({ locationId }).toArray();
    res.json({ data: rooms });
  });

  return router;
}
