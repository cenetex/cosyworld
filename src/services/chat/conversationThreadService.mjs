import { randomUUID } from 'crypto';

const toBool = (value, fallback = false) => {
  if (value == null) return fallback;
  return String(value).toLowerCase() === 'true';
};

const DEFAULT_THREAD_MODE = 'mention';

export class ConversationThreadService {
  constructor({ logger } = {}) {
    this.logger = logger || console;
    this.threads = new Map(); // channelId -> Thread[]

    this.DEFAULT_TTL_MS = Number(process.env.CONVERSATION_THREAD_TTL || 180000);
    this.DEFAULT_MAX_TURNS = Number(process.env.CONVERSATION_THREAD_MAX_TURNS || 6);
    this.EXTEND_ON_ACTIVITY = toBool(process.env.CONVERSATION_THREAD_EXTEND_ON_ACTIVITY, true);
    this.CLEANUP_INTERVAL_MS = Number(process.env.CONVERSATION_THREAD_CLEANUP_INTERVAL || 60000);

    if (this.CLEANUP_INTERVAL_MS > 0) {
      this.cleanupHandle = setInterval(() => {
        try {
          this.pruneExpired();
        } catch (err) {
          this.logger?.debug?.(`[ConversationThreadService] prune failed: ${err.message}`);
        }
      }, this.CLEANUP_INTERVAL_MS);
      this.cleanupHandle.unref?.();
    }
  }

  _toParticipantId(participant) {
    if (!participant) return null;
    if (typeof participant === 'string') return participant;
    if (typeof participant === 'number') return String(participant);
    if (participant._id) return String(participant._id);
    if (participant.id) return String(participant.id);
    return null;
  }

  _isActive(thread, now = Date.now()) {
    if (!thread) return false;
    if (thread.maxTurns && thread.turnCount >= thread.maxTurns) return false;
    return !thread.expiresAt || now < thread.expiresAt;
  }

  _getChannelThreads(channelId, create = false) {
    if (!this.threads.has(channelId) && create) {
      this.threads.set(channelId, []);
    }
    return this.threads.get(channelId) || [];
  }

  getActiveThreads(channelId) {
    this.pruneExpired();
    const threads = this._getChannelThreads(channelId);
    return threads.filter(thread => this._isActive(thread));
  }

  getThread(channelId, threadId) {
    const threads = this._getChannelThreads(channelId);
    return threads.find(thread => thread.id === threadId) || null;
  }

  async startThread(channelId, participants = [], options = {}) {
    if (!channelId) throw new Error('channelId is required to start a thread');
    const ids = new Set();
    for (const participant of participants) {
      const id = this._toParticipantId(participant);
      if (id) ids.add(id);
    }

    if (ids.size === 0) {
      throw new Error('At least one participant is required to start a thread');
    }

    const now = Date.now();
    const mode = options.mode || DEFAULT_THREAD_MODE;
    const duration = Number(options.duration) || this.DEFAULT_TTL_MS;
    const maxTurns = Number(options.maxTurns) || this.DEFAULT_MAX_TURNS;

    const threads = this._getChannelThreads(channelId, true);

    // Reuse active thread with identical participants and mode unless forced to create a new one
    if (!options.forceNew) {
      const existing = threads.find(thread => {
        if (thread.mode !== mode) return false;
        if (!this._isActive(thread, now)) return false;
        if (thread.participants.size !== ids.size) return false;
        for (const id of ids) {
          if (!thread.participants.has(id)) return false;
        }
        return true;
      });

      if (existing) {
        existing.expiresAt = now + duration;
        existing.lastActivityAt = now;
        return existing;
      }
    }

    const thread = {
      id: options.threadId || randomUUID(),
      channelId,
      participants: new Set(ids),
      startedAt: now,
      lastActivityAt: now,
      expiresAt: now + duration,
      maxTurns,
      turnCount: 0,
      mode,
      proactive: Boolean(options.proactive),
      metadata: options.metadata || {},
      lastSpeakerId: options.lastSpeakerId ? String(options.lastSpeakerId) : null,
    };

    threads.push(thread);
    this.threads.set(channelId, threads);
    return thread;
  }

  isInActiveThread(channelId, avatarId) {
    const id = this._toParticipantId(avatarId);
    if (!id) return null;
    const threads = this.getActiveThreads(channelId);
    return threads.find(thread => thread.participants.has(id)) || null;
  }

  getActiveParticipants(channelId, threadId, excludeAvatarId) {
    const thread = this.getThread(channelId, threadId);
    if (!thread) return [];
    const exclude = this._toParticipantId(excludeAvatarId);
    return Array.from(thread.participants).filter(id => id !== exclude);
  }

  async recordTurn(channelId, avatarId, threadId) {
    const thread = this.getThread(channelId, threadId);
    if (!thread) return null;

    const now = Date.now();
    thread.turnCount += 1;
    thread.lastActivityAt = now;
    thread.lastSpeakerId = this._toParticipantId(avatarId);

    if (this.EXTEND_ON_ACTIVITY && thread.expiresAt) {
      const extension = Math.floor(this.DEFAULT_TTL_MS / 2);
      thread.expiresAt = now + (extension || this.DEFAULT_TTL_MS);
    }

    if (!this._isActive(thread)) {
      this.endThread(channelId, threadId, 'turn_limit_reached');
    }
    return thread;
  }

  endThread(channelId, threadId, reason = 'manual') {
    const threads = this._getChannelThreads(channelId);
    const idx = threads.findIndex(thread => thread.id === threadId);
    if (idx === -1) return false;
    const [removed] = threads.splice(idx, 1);
    removed.endedAt = Date.now();
    removed.endReason = reason;
    if (threads.length === 0) {
      this.threads.delete(channelId);
    } else {
      this.threads.set(channelId, threads);
    }
    return true;
  }

  pruneExpired(now = Date.now()) {
    for (const [channelId, threads] of this.threads.entries()) {
      const active = threads.filter(thread => this._isActive(thread, now));
      if (active.length === 0) {
        this.threads.delete(channelId);
      } else {
        this.threads.set(channelId, active);
      }
    }
  }
}

export default ConversationThreadService;
