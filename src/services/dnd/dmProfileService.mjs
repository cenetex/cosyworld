/**
 * DM Profile Service
 *
 * Persists and resolves a per-channel (or thread) Dungeon Master persona.
 * This is the "big quality jump" foundation: a consistent tone + behavioral knobs
 * that both narration and scene/option generation can share.
 */

import { randomInt } from 'crypto';

const DEFAULT_PROFILE = Object.freeze({
  scopeType: 'channel',
  scopeId: null,
  // High-level tone preset (used to seed prompt + embed flavor)
  tonePreset: 'epic',
  // Behavioral knobs (0..1). Keep small + interpretable.
  intensity: 0.7,
  humor: 0.2,
  grit: 0.4,
  kindness: 0.5,
  // DM behaviors
  asksQuestions: true,
  offersOptions: true,
  // Safety/UX knobs
  verbosity: 0.4,
  updatedAt: null,
});

const TONE_PRESETS = Object.freeze({
  epic: {
    tonePreset: 'epic',
    intensity: 0.8,
    humor: 0.15,
    grit: 0.45,
    kindness: 0.55,
    verbosity: 0.45,
  },
  grim: {
    tonePreset: 'grim',
    intensity: 0.85,
    humor: 0.05,
    grit: 0.8,
    kindness: 0.35,
    verbosity: 0.4,
  },
  whimsical: {
    tonePreset: 'whimsical',
    intensity: 0.6,
    humor: 0.65,
    grit: 0.2,
    kindness: 0.65,
    verbosity: 0.5,
  },
  sardonic: {
    tonePreset: 'sardonic',
    intensity: 0.7,
    humor: 0.55,
    grit: 0.55,
    kindness: 0.35,
    verbosity: 0.45,
  },
});

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function mergeProfile(base, patch) {
  const next = { ...base, ...patch };
  // Normalize knobs
  for (const key of ['intensity', 'humor', 'grit', 'kindness', 'verbosity']) {
    if (key in next) next[key] = clamp01(next[key]);
  }
  if (typeof next.asksQuestions !== 'boolean') next.asksQuestions = Boolean(next.asksQuestions);
  if (typeof next.offersOptions !== 'boolean') next.offersOptions = Boolean(next.offersOptions);
  return next;
}

export class dmProfileService {
  constructor({ logger, databaseService, configService }) {
    this.logger = logger || console;
    this.databaseService = databaseService;
    this.configService = configService;

    this._cache = new Map(); // scopeKey -> { profile, expiresAt }
    this._cacheTtlMs = 60 * 1000;
    this._indexesEnsured = false;
  }

  getTonePresets() {
    return Object.keys(TONE_PRESETS);
  }

  _scopeKey({ scopeType, scopeId }) {
    return `${scopeType}:${String(scopeId || '')}`;
  }

  async _ensureIndexes(db) {
    if (this._indexesEnsured) return;
    this._indexesEnsured = true;
    try {
      await db.collection('dnd_dm_profiles').createIndex({ scopeType: 1, scopeId: 1 }, { unique: true });
      await db.collection('dnd_dm_profiles').createIndex({ updatedAt: -1 });
    } catch (e) {
      this.logger?.debug?.(`[DMProfile] Index creation skipped/failed: ${e.message}`);
    }
  }

  async getProfileForChannel(channelId) {
    if (!channelId) return { ...DEFAULT_PROFILE };
    const scope = { scopeType: 'channel', scopeId: String(channelId) };
    return await this.getProfile(scope);
  }

  async getProfile(scope) {
    const scopeType = scope?.scopeType || 'channel';
    const scopeId = scope?.scopeId;
    if (!scopeId) return { ...DEFAULT_PROFILE };

    const key = this._scopeKey({ scopeType, scopeId });
    const cached = this._cache.get(key);
    if (cached?.expiresAt && cached.expiresAt > Date.now() && cached.profile) {
      return cached.profile;
    }

    try {
      const db = await this.databaseService.getDatabase();
      await this._ensureIndexes(db);

      const doc = await db.collection('dnd_dm_profiles').findOne({ scopeType, scopeId: String(scopeId) });
      const profile = mergeProfile({ ...DEFAULT_PROFILE, scopeType, scopeId: String(scopeId) }, doc || {});

      this._cache.set(key, { profile, expiresAt: Date.now() + this._cacheTtlMs });
      return profile;
    } catch (e) {
      this.logger?.warn?.(`[DMProfile] Failed to load profile: ${e.message}`);
      return mergeProfile({ ...DEFAULT_PROFILE, scopeType, scopeId: String(scopeId) }, {});
    }
  }

  async setTonePresetForChannel(channelId, tonePreset) {
    return await this.setTonePreset({ scopeType: 'channel', scopeId: String(channelId) }, tonePreset);
  }

  async setTonePreset(scope, tonePreset) {
    const scopeType = scope?.scopeType || 'channel';
    const scopeId = String(scope?.scopeId || '');
    const preset = TONE_PRESETS[String(tonePreset || '').toLowerCase()];
    if (!scopeId) throw new Error('Missing scopeId');
    if (!preset) throw new Error(`Unknown tone preset: ${tonePreset}`);

    const now = new Date();
    const update = {
      $set: {
        scopeType,
        scopeId,
        ...preset,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    };

    const key = this._scopeKey({ scopeType, scopeId });

    const db = await this.databaseService.getDatabase();
    await this._ensureIndexes(db);

    await db.collection('dnd_dm_profiles').updateOne({ scopeType, scopeId }, update, { upsert: true });

    const profile = mergeProfile({ ...DEFAULT_PROFILE, scopeType, scopeId }, { ...preset, updatedAt: now });
    this._cache.set(key, { profile, expiresAt: Date.now() + this._cacheTtlMs });
    return profile;
  }

  /**
   * Used by DM to "self-adjust" in the moment (e.g., after a death -> raise grit)
   * without changing the whole preset.
   */
  async nudge(scope, patch) {
    const scopeType = scope?.scopeType || 'channel';
    const scopeId = String(scope?.scopeId || '');
    if (!scopeId) throw new Error('Missing scopeId');

    const current = await this.getProfile({ scopeType, scopeId });
    const next = mergeProfile(current, patch);

    const now = new Date();
    const db = await this.databaseService.getDatabase();
    await this._ensureIndexes(db);

    await db.collection('dnd_dm_profiles').updateOne(
      { scopeType, scopeId },
      {
        $set: {
          ...next,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );

    const key = this._scopeKey({ scopeType, scopeId });
    this._cache.set(key, { profile: { ...next, updatedAt: now }, expiresAt: Date.now() + this._cacheTtlMs });
    return { ...next, updatedAt: now };
  }

  /** Small helper for prompt flavor */
  getPersonaPrompt(profile) {
    const p = mergeProfile(DEFAULT_PROFILE, profile || {});

    const toneLine = {
      epic: 'Tone: epic fantasy, cinematic but not purple-prose.',
      grim: 'Tone: grim and tense, danger-forward, minimal humor.',
      whimsical: 'Tone: whimsical and playful, surprising imagery, light stakes unless critical.',
      sardonic: 'Tone: sardonic and wry, sharp observations, never mean-spirited.',
    }[p.tonePreset] || 'Tone: grounded fantasy.';

    const tightness = p.verbosity < 0.45 ? 'Keep outputs tight (1 sentence when possible).' : 'Keep outputs concise (1-2 sentences).';
    const questionLine = p.asksQuestions ? 'Frequently end scene beats with a direct question to the party.' : 'Do not ask questions unless necessary.';

    // These knobs translate to qualitative guidance; keep it stable.
    const gritLine = p.grit >= 0.65 ? 'Show grime, risk, and consequence.' : 'Keep the tone relatively clean and heroic.';
    const humorLine = p.humor >= 0.55 ? 'Allow light humor and clever phrasing.' : 'Avoid jokes and keep it serious.';
    const kindnessLine = p.kindness >= 0.6 ? 'Be supportive and encouraging to players.' : 'Be neutral and matter-of-fact.';

    return [toneLine, tightness, questionLine, gritLine, humorLine, kindnessLine].join('\n');
  }

  /**
   * A deterministic-ish "DM quirk" seed for a channel that can be used to keep personality consistent.
   * Not persisted; derived from scope.
   */
  getQuirkSeed(scopeId) {
    const s = String(scopeId || '');
    let acc = 0;
    for (let i = 0; i < s.length; i++) acc = (acc + s.charCodeAt(i) * (i + 1)) % 100000;
    // salt with a tiny crypto jitter to avoid uniformity across empty ids
    return (acc + randomInt(0, 997)) % 100000;
  }
}

export default dmProfileService;
