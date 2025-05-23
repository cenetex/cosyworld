// avatarGateway.js  (tiny utility file)
import { ObjectId } from 'mongodb';

/**
 * @param {Object} deps
 * @param {import('../services/databaseService.js').Database} deps.databaseService
 */
export function createAvatarGateway({ databaseService }) {
  async function getAvatarById(id) {
    const db = await databaseService.getDatabase();
    return db.collection('avatars').findOne({
      _id: typeof id === 'string' ? new ObjectId(id) : id
    });
  }

  async function getAvatarsByIds(ids = []) {
    const db = await databaseService.getDatabase();
    return db.collection('avatars')
             .find({ _id: { $in: ids.map(i => typeof i === 'string' ? new ObjectId(i) : i) } })
             .toArray();
  }

  async function updateChannelId(id, channelId, session = null) {
    const db = await databaseService.getDatabase();
    await db.collection('avatars')
            .updateOne({ _id: id }, { $set: { channelId } }, { session });
  }

  return { getAvatarById, getAvatarsByIds, updateChannelId };
}
