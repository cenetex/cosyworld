export class MemoryScheduler {
  constructor({ logger, databaseService, googleAIService = null, schedulingService, memoryService }) {
    this.logger = logger || console;
    this.databaseService = databaseService;
    this.googleAIService = googleAIService;
    this.schedulingService = schedulingService;
    this.memoryService = memoryService;
    this.decayRate = Number(process.env.MEMORY_DECAY_RATE || 0.95); // per week
    this.enabled = String(process.env.MEMORY_V2_ENABLED || 'true') === 'true';
  }

  start(intervalMs = 24 * 60 * 60 * 1000) {
    if (!this.enabled) return;
    if (!this.schedulingService) {
      this.logger?.warn?.('[MemoryScheduler] schedulingService not available');
      return;
    }
    this.schedulingService.addTask('memory-nightly', () => this.runOnce().catch(e => this.logger.error('[MemoryScheduler] runOnce error', e)), intervalMs);
    this.logger?.info?.('[MemoryScheduler] Nightly summarization scheduled');
  }

  async runOnce() {
    if (!this.enabled) return;
    const db = await this.databaseService.getDatabase();
    const col = db.collection('memories');
    const avatars = await col.distinct('avatarId');
    for (const avatarId of avatars) {
      try {
        await this.processAvatar(col, avatarId);
      } catch (e) {
        this.logger?.warn?.(`[MemoryScheduler] processAvatar(${avatarId}) failed: ${e.message}`);
      }
    }
  }

  async processAvatar(col, avatarId, batch = 25) {
    // 1) pick oldest low-weight memories (not summaries)
    const lows = await col
      .find({ avatarId, kind: { $ne: 'summary' } })
      .sort({ weight: 1, ts: 1 })
      .limit(batch)
      .project({ _id: 1, text: 1, ts: 1 })
      .toArray();
    if (!lows.length) return;

    // 2) summarize
    const text = lows.map(m => `- ${m.text}`).join('\n');
    let summary = null;
    try {
      const prompt = `Summarize the following avatar memories into 1-2 concise sentences, focusing on durable facts and themes.\n\n${text}`;
      if (this.googleAIService?.generateCompletion) {
  summary = await this.googleAIService.generateCompletion(prompt, { maxOutputTokens: 400, temperature: 0.2 });
      }
    } catch {}
    summary = (summary || '').trim() || `Summary of ${lows.length} memories.`;

    // 3) insert summary and delete originals
    await this.memoryService.write({ avatarId, kind: 'summary', text: summary, weight: 1.5 });
    await col.deleteMany({ _id: { $in: lows.map(l => l._id) } });

    // 4) decay weights
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const cursor = col.find({ avatarId }).project({ _id: 1, ts: 1, weight: 1 });
    const ops = [];
    // Manual bulk since initializeUnorderedBulkOp not in all drivers
    while (await cursor.hasNext()) {
      const d = await cursor.next();
      const ageWeeks = Math.max(0, (now - new Date(d.ts || now).getTime()) / weekMs);
      const newWeight = Number((d.weight || 1) * Math.pow(this.decayRate, ageWeeks));
      ops.push({ updateOne: { filter: { _id: d._id }, update: { $set: { weight: Number(newWeight.toFixed(4)) } } } });
      if (ops.length >= 500) {
        await col.bulkWrite(ops); ops.length = 0;
      }
    }
    if (ops.length) await col.bulkWrite(ops);
  }
}

export default MemoryScheduler;
