export class BotAccountService {
  constructor({ logger, databaseService }) {
    this.logger = logger ?? console;
    this.databaseService = databaseService;
    this.db = null;
  }

  async #col() {
    if (!this.db) this.db = await this.databaseService.getDatabase();
    return this.db.collection('bot_accounts');
  }

  async linkAccount(avatarId, platform, account) {
    const col = await this.#col();
    const data = { avatarId, platform, ...account, updatedAt: new Date() };
    await col.updateOne({ avatarId, platform }, { $set: data }, { upsert: true });
    return data;
  }

  async unlinkAccount(avatarId, platform) {
    const col = await this.#col();
    await col.deleteOne({ avatarId, platform });
  }

  async getAccounts(avatarId) {
    const col = await this.#col();
    return await col.find({ avatarId }).toArray();
  }
}
