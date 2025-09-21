/**
 * AssignmentQueueService
 * - Durable queue for planner assignments
 * - Supports enqueue, claim, complete
 */

export default class AssignmentQueueService {
  constructor({ logger = console, databaseService }) {
    this.logger = logger;
    this.databaseService = databaseService;
    // Simple in-memory cache of recent pending keys to avoid extra lookups between rapid plan rounds
    this._recentPendingKeys = new Set();
    this._recentPendingExpiry = 0;
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

  /**
   * enqueueUnique(assignments)
   * - Prevents inserting duplicate (type, channelId, avatarId) assignments that are still pending/claimed.
   * - Performs a single $or query to discover existing active assignments, then filters.
   * - Falls back to normal insertion if query fails.
   * @param {Array<Object>} assignments
   * @returns {number} inserted count
   */
  async enqueueUnique(assignments = []) {
    if (!assignments || !assignments.length) return 0;
    const now = Date.now();

    // Periodically reset short-lived cache (every 10s) to prevent unbounded growth
    if (now > this._recentPendingExpiry) {
      this._recentPendingKeys.clear();
      this._recentPendingExpiry = now + 10_000;
    }

    // Build dedupe keys for incoming assignments
    const buildKey = (a) => `${a.type || 'respond'}::${a.channelId || ''}::${a.avatarId || ''}`;
    const docs = assignments.map(a => ({ ...a, type: a.type || 'respond' }));

    // First filter against in-memory recent set to skip obvious duplicates between very rapid rounds
    let candidates = docs.filter(a => {
      const k = buildKey(a);
      if (this._recentPendingKeys.has(k)) return false;
      return true;
    });
    if (!candidates.length) return 0;

    // Query DB for existing active assignments matching these keys
    try {
      const col = await this.col();
      const or = candidates.map(a => ({ type: a.type, channelId: a.channelId, avatarId: a.avatarId }));
      const existing = await col.find({ status: { $in: ['pending', 'claimed'] }, $or: or }).project({ type: 1, channelId: 1, avatarId: 1 }).toArray();
      const existingSet = new Set(existing.map(e => buildKey(e)));
      const filtered = candidates.filter(a => !existingSet.has(buildKey(a)));
      if (!filtered.length) return 0;
      const toInsert = filtered.map(a => ({ ...a, status: 'pending', createdAt: now, updatedAt: now }));
      const res = await col.insertMany(toInsert);
      // Update recent cache
      for (const a of filtered) this._recentPendingKeys.add(buildKey(a));
      return res.insertedCount || filtered.length;
    } catch (e) {
      this.logger.warn?.(`[Assignments] enqueueUnique fallback due to error: ${e.message}`);
      // Fallback to naive enqueue
      return this.enqueue(candidates);
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
