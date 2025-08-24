/**
 * AssignmentQueueService
 * - Durable queue for planner assignments
 * - Supports enqueue, claim, complete
 */

export default class AssignmentQueueService {
  constructor({ logger = console, databaseService }) {
    this.logger = logger;
    this.databaseService = databaseService;
  }

  async db() { return await this.databaseService.getDatabase(); }
  async col() { return (await this.db()).collection('planner_assignments'); }

  async enqueue(assignments = []) {
    if (!assignments || !assignments.length) return 0;
    const docs = assignments.map(a => ({ ...a, status: 'pending', createdAt: Date.now(), updatedAt: Date.now() }));
    try {
      const col = await this.col();
      const res = await col.insertMany(docs);
      return res.insertedCount || assignments.length;
    } catch (e) {
      this.logger.warn?.(`[Assignments] enqueue failed: ${e.message}`);
      return 0;
    }
  }

  async claimNext(workerId = 'planner', types = ['respond']) {
    try {
      const col = await this.col();
      const res = await col.findOneAndUpdate(
        { status: 'pending', type: { $in: types } },
        { $set: { status: 'claimed', workerId, updatedAt: Date.now() } },
        { returnDocument: 'after', sort: { priority: -1, createdAt: 1 } }
      );
      return (res && res.value) ? res.value : null;
    } catch (e) {
      this.logger.warn?.(`[Assignments] claimNext failed: ${e.message}`);
      return null;
    }
  }

  async complete(_id, result = {}) {
    const col = await this.col();
    await col.updateOne({ _id }, { $set: { status: 'done', result, updatedAt: Date.now() } });
  }

  async fail(_id, error) {
    const col = await this.col();
    await col.updateOne({ _id }, { $set: { status: 'failed', error: String(error), updatedAt: Date.now() } });
  }
}
