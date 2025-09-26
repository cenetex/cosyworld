export class ForecasterService {
  constructor({ logger, databaseService }) {
    this.logger = logger ?? console;
    this.databaseService = databaseService;
    this.db = null;
  }

  async ensureDb() {
    if (!this.db) this.db = await this.databaseService.getDatabase();
    return this.db.collection('forecaster_auth');
  }

  async isAuthorized(avatarId) {
    const col = await this.ensureDb();
    const auth = await col.findOne({ avatarId });
    return !!auth;
  }

  async saveAuth(avatarId, data) {
    const col = await this.ensureDb();
    await col.updateOne({ avatarId }, { $set: { ...data, updatedAt: new Date() } }, { upsert: true });
  }

  async revokeAuth(avatarId) {
    const col = await this.ensureDb();
    await col.deleteOne({ avatarId });
  }

  // Placeholder for posting a message
  async post(avatar, content) {
    this.logger.info(`Posting to Forecaster as ${avatar.name}: ${content}`);
    return { success: true };
  }
}
