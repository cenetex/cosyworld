export class MatrixService {
  constructor({ logger, databaseService }) {
    this.logger = logger ?? console;
    this.databaseService = databaseService;
    this.db = null;
  }

  async ensureDb() {
    if (!this.db) this.db = await this.databaseService.getDatabase();
    return this.db.collection('matrix_auth');
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

  // Placeholder for sending a message
  async send(avatar, room, content) {
    this.logger.info(`Sending to Matrix room ${room} as ${avatar.name}: ${content}`);
    return { success: true };
  }
}
