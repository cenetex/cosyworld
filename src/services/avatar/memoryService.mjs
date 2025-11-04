/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { ObjectId } from 'mongodb';


export class MemoryService {
  constructor({
    logger,
    schemaService,
    databaseService,
    discordService,
    embeddingService
  }) {
    this.logger = logger || console;
    this.schemaService = schemaService;
    this.databaseService = databaseService;
    this.discordService = discordService;
    this.embeddingService = embeddingService || null;
    this.db = null;
    this.lastEntitySync = new Map();
    this.enabled = String(process.env.MEMORY_V2_ENABLED || 'true') === 'true';
    this.maxItems = Number(process.env.MEMORY_MAX_ITEMS || 500);
    this.topK = Number(process.env.MEMORY_TOPK || 12);
  }

  /** V2 write path: embed + insert + cap enforcement */
  async write({ avatarId, guildId = null, kind = 'chat', text, weight = 1.0 }) {
    const db = (this.db ||= await this.databaseService.getDatabase());
    const col = db.collection('memories');
    const ts = new Date();
    const embedding = this.embeddingService ? await this.embeddingService.embed(text) : null;
    const doc = { avatarId, guildId, ts, kind, text, embedding, weight };
    await col.insertOne(doc);
    // Enforce cap per avatar
    const count = await col.countDocuments({ avatarId });
    if (count > this.maxItems) {
      const dropCount = count - this.maxItems;
      // Delete lowest weight, oldest first
      const losers = await col
        .find({ avatarId })
        .project({ _id: 1 })
        .sort({ weight: 1, ts: 1 })
        .limit(dropCount)
        .toArray();
      const ids = losers.map((d) => d._id);
      if (ids.length) await col.deleteMany({ _id: { $in: ids } });
      this.logger?.info?.(`[Memory] Pruned ${ids.length} memories for avatar ${avatarId}`);
    }
    return doc;
  }

  // Back-compat entry used by ToolService etc.
  async addMemory(avatarId, memory) {
    if (!this.enabled) {
      // v1 fallback
      try {
        this.db = await this.databaseService.getDatabase();
        await this.db.collection('memories').insertOne({
          avatarId,
          memory,
          timestamp: Date.now()
        });
      } catch (error) {
        this.logger.error(`Error storing memory for avatar ${avatarId}: ${error.message}`);
        throw error;
      }
      return;
    }
    return this.write({ avatarId, text: String(memory), kind: 'event', weight: 1.0 });
  }

  // V2: semantic retrieval; v1: recency list
  async getMemories(avatarId, limit = 10, _skipEntitySync = false) {
    if (!this.enabled) {
      try {
        this.db = await this.databaseService.getDatabase();
        const memories = await this.db.collection('memories')
          .find({ $or: [ { avatarId }, { avatarId: avatarId.toString() }] })
          .sort({ timestamp: -1 })
          .limit(limit)
          .toArray();

        const narratives = await this.db.collection('narratives');
        const recentNarratives = await narratives.find({ avatarId }).sort({ timestamp: -1 }).limit(3).toArray();
        recentNarratives.forEach(narrative => { memories.push(narrative); });
        memories.sort((a, b) => b.timestamp - a.timestamp);
        return memories || [];
      } catch (error) {
        this.logger.error(`Error fetching memories for avatar ${avatarId}: ${error.message}`);
        throw error;
      }
    }
    // v2: return latest text blobs for compatibility (PromptService expects .memory)
    const top = await this.query({ avatarId, queryText: '', topK: limit });
    return top.map(m => ({ memory: m.text, timestamp: m.ts?.getTime?.() || Date.now() }));
  }

  // Semantic query for v2
  async query({ avatarId, queryText, topK = this.topK, minWeight = 0 }) {
    const db = (this.db ||= await this.databaseService.getDatabase());
    const col = db.collection('memories');
    let queryVec = null;
    try { queryVec = this.embeddingService ? await this.embeddingService.embed(queryText || ' ') : null; } catch {}

    // If no embeddings, fallback to recency with basic filter
    if (!queryVec) {
      return await col
        .find({ avatarId, weight: { $gte: minWeight } })
        .sort({ ts: -1 })
        .limit(topK)
        .project({ avatarId: 1, guildId: 1, ts: 1, kind: 1, text: 1, weight: 1 })
        .toArray();
    }

    // Manual cosine similarity since we may not have Atlas Vector Search available
    const candidates = await col
      .find({ avatarId, embedding: { $exists: true }, weight: { $gte: minWeight } })
      .project({ avatarId: 1, guildId: 1, ts: 1, kind: 1, text: 1, weight: 1, embedding: 1 })
      .toArray();

    const norm = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    const dv = queryVec;
    const dn = norm(dv);
    const scored = candidates.map((c) => {
      const cv = Array.isArray(c.embedding) ? c.embedding : [];
      const cn = norm(cv);
      const dot = Math.min(dv.length, cv.length) ? dv.slice(0, Math.min(dv.length, cv.length)).reduce((s, x, i) => s + x * cv[i], 0) : 0;
      const cosine = dot / (dn * cn || 1);
      // Recency bias: newer slightly favored
      const ageDays = c.ts ? (Date.now() - new Date(c.ts).getTime()) / (1000 * 60 * 60 * 24) : 0;
      const recency = 1 / (1 + ageDays / 7);
      const score = (cosine * 0.75) + (recency * 0.15) + (Math.min(2, c.weight || 1) * 0.10);
      return { ...c, _score: score };
    });
    scored.sort((a, b) => b._score - a._score);
  return scored.slice(0, topK).map(({ _score, embedding: _embedding, ...rest }) => rest);
  }

  /** Persistent recall: high-weight summaries/facts irrespective of current query */
  async persistent({ avatarId, topK = 6, minWeight = 1.2, kinds = ['summary','fact'] } = {}) {
    const db = (this.db ||= await this.databaseService.getDatabase());
    const col = db.collection('memories');
    const filter = { avatarId, weight: { $gte: minWeight } };
    if (Array.isArray(kinds) && kinds.length) {
      filter.kind = { $in: kinds };
    }
    const items = await col
      .find(filter)
      .sort({ weight: -1, ts: -1 })
      .limit(topK)
      .project({ avatarId: 1, guildId: 1, ts: 1, kind: 1, text: 1, weight: 1 })
      .toArray();
    return items;
  }

  async storeNarrative(avatarId, content) {
    try {
      this.db = await this.databaseService.getDatabase();
      await this.db.collection('narratives').insertOne({
        avatarId,
        content,
        timestamp: Date.now()
      });
    } catch (error) {
      this.logger.error(`Error storing narrative for avatar ${avatarId}: ${error.message}`);
    }
  }

  async getLastNarrative(avatarId) {
    try {
      this.db = await this.databaseService.getDatabase();
      return await this.db.collection('narratives').findOne(
        { $or: [{ avatarId }, { avatarId: avatarId.toString() }] },
        { sort: { timestamp: -1 } }
      );
    } catch (error) {
      this.logger.error(`Error fetching last narrative for avatar ${avatarId}: ${error.message}`);
      return null;
    }
  }

  async updateNarrativeHistory(avatar, content) {
    const guildName = process.env.GUILD_NAME || 'The Guild';
    const narrativeData = { timestamp: Date.now(), content, guildName };
    avatar.narrativeHistory = avatar.narrativeHistory || [];
    avatar.narrativeHistory.unshift(narrativeData);
    avatar.narrativeHistory = avatar.narrativeHistory.slice(0, 5);
    return avatar;
  }

  async getRecentMemoriesRaw(avatarId, limit = 20) {
    const db = (this.db ||= await this.databaseService.getDatabase());
    const col = db.collection('memories');

    const query = {
      $or: [
        { avatarId },
        { avatarId: avatarId?.toString?.() }
      ]
    };

    const docs = await col
      .find(query)
      .sort({ ts: -1, timestamp: -1 })
      .limit(limit)
      .project({ avatarId: 1, guildId: 1, ts: 1, kind: 1, text: 1, weight: 1, memory: 1, timestamp: 1 })
      .toArray();

    return docs.map((doc) => ({
      ...doc,
      memory: doc.memory || doc.text || '',
      timestamp: doc.ts || doc.timestamp || null
    }));
  }

  async countMemories(avatarId) {
    const db = (this.db ||= await this.databaseService.getDatabase());
    const col = db.collection('memories');
    const query = {
      $or: [
        { avatarId },
        { avatarId: avatarId?.toString?.() }
      ]
    };
    return col.countDocuments(query);
  }

  async deleteMemory(memoryId) {
    if (!memoryId) {
      throw new Error('Memory ID required');
    }

    let objectId;
    try {
      objectId = new ObjectId(memoryId);
    } catch {
      throw new Error('Invalid memory ID');
    }

    const db = (this.db ||= await this.databaseService.getDatabase());
    const col = db.collection('memories');
    const result = await col.deleteOne({ _id: objectId });

    if (!result.deletedCount) {
      throw new Error('Memory not found');
    }

    this.logger?.info?.(`[Memory] Deleted memory ${memoryId}`);
    return { deletedCount: result.deletedCount };
  }

  async deleteMemoriesByAvatar(avatarId, filter = {}) {
    if (!avatarId) {
      throw new Error('Avatar ID required');
    }

    const db = (this.db ||= await this.databaseService.getDatabase());
    const col = db.collection('memories');

    const query = {
      $or: [
        { avatarId },
        { avatarId: avatarId?.toString?.() }
      ]
    };

    if (filter.kind) {
      query.kind = Array.isArray(filter.kind) ? { $in: filter.kind } : filter.kind;
    }

    const result = await col.deleteMany(query);
    this.logger?.info?.(`[Memory] Deleted ${result.deletedCount} memories for avatar ${avatarId}`);
    return { deletedCount: result.deletedCount };
  }
}
