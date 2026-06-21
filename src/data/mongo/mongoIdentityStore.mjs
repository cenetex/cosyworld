import {
  createId,
  normalizeAddress,
  normalizeChain,
  normalizeOwner,
  nowIso,
  toIso
} from '../identityUtils.mjs';

function userFromDoc(doc) {
  if (!doc) return null;
  return {
    id: doc.id,
    status: doc.status || 'active',
    isAdmin: !!doc.isAdmin,
    profile: doc.profile || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

function walletFromDoc(doc) {
  if (!doc) return null;
  return {
    id: doc.id,
    chain: doc.chain,
    normalizedAddress: doc.normalizedAddress,
    displayAddress: doc.displayAddress,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

function credentialFromDoc(doc) {
  if (!doc) return null;
  return {
    id: doc.id,
    provider: doc.provider,
    owner: doc.owner,
    credential: doc.credential || {},
    profile: doc.profile || null,
    scopes: doc.scopes || [],
    expiresAt: doc.expiresAt || null,
    status: doc.status || 'active',
    error: doc.error || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

export class MongoIdentityStore {
  constructor({ databaseService, logger }) {
    this.databaseService = databaseService;
    this.logger = logger || console;
    this.db = null;
  }

  async initialize() {
    this.db = this.db || await this.databaseService.getDatabase();
    if (!this.db) throw new Error('MongoDB unavailable');

    await Promise.all([
      this.db.collection('v2_users').createIndex({ id: 1 }, { unique: true }),
      this.db.collection('v2_wallets').createIndex({ chain: 1, normalizedAddress: 1 }, { unique: true }),
      this.db.collection('v2_user_wallets').createIndex({ userId: 1, walletId: 1 }, { unique: true }),
      this.db.collection('v2_external_identities').createIndex({ provider: 1, providerUserId: 1 }, { unique: true }),
      this.db.collection('v2_auth_sessions').createIndex({ id: 1 }, { unique: true }),
      this.db.collection('v2_auth_sessions').createIndex({ userId: 1, expiresAt: 1 }),
      this.db.collection('v2_auth_challenges').createIndex({ purpose: 1, nonce: 1 }, { unique: true }),
      this.db.collection('v2_auth_challenges').createIndex({ chain: 1, normalizedAddress: 1, expiresAt: 1 }),
      this.db.collection('v2_oauth_states').createIndex({ provider: 1, state: 1 }, { unique: true }),
      this.db.collection('v2_oauth_states').createIndex({ provider: 1, 'owner.kind': 1, 'owner.id': 1 }),
      this.db.collection('v2_provider_credentials').createIndex({ provider: 1, 'owner.kind': 1, 'owner.id': 1 }, { unique: true }),
      this.db.collection('v2_auth_events').createIndex({ createdAt: -1 })
    ]);
  }

  async _db() {
    if (!this.db) await this.initialize();
    return this.db;
  }

  async findUserById(userId) {
    const db = await this._db();
    return userFromDoc(await db.collection('v2_users').findOne({ id: userId }));
  }

  async findUserByWallet(address, { chain = 'solana' } = {}) {
    const db = await this._db();
    const normalizedChain = normalizeChain(chain);
    const normalizedAddress = normalizeAddress(address, normalizedChain);
    const wallet = await db.collection('v2_wallets').findOne({ chain: normalizedChain, normalizedAddress });
    if (!wallet) return null;
    const link = await db.collection('v2_user_wallets').findOne({ walletId: wallet.id }, { sort: { verifiedAt: -1 } });
    if (!link) return null;
    return await this.findUserById(link.userId);
  }

  async hasAdminUser() {
    const db = await this._db();
    return !!(await db.collection('v2_users').findOne({ isAdmin: true }, { projection: { id: 1 } }));
  }

  async upsertWalletUser({ address, chain = 'solana', displayAddress = null, profile = null, isAdmin = false } = {}) {
    const db = await this._db();
    const normalizedChain = normalizeChain(chain);
    const normalizedAddress = normalizeAddress(address, normalizedChain);
    if (!normalizedAddress) throw new Error('address is required');

    const at = nowIso();
    const display = displayAddress || String(address).trim();
    let wallet = await db.collection('v2_wallets').findOne({ chain: normalizedChain, normalizedAddress });

    if (!wallet) {
      wallet = {
        id: createId('wal'),
        chain: normalizedChain,
        normalizedAddress,
        displayAddress: display,
        createdAt: at,
        updatedAt: at
      };
      await db.collection('v2_wallets').insertOne(wallet);
    } else if (wallet.displayAddress !== display) {
      await db.collection('v2_wallets').updateOne({ id: wallet.id }, { $set: { displayAddress: display, updatedAt: at } });
      wallet = { ...wallet, displayAddress: display, updatedAt: at };
    }

    let link = await db.collection('v2_user_wallets').findOne({ walletId: wallet.id });
    let user = link ? await db.collection('v2_users').findOne({ id: link.userId }) : null;

    if (!user) {
      user = {
        id: createId('usr'),
        status: 'active',
        isAdmin: !!isAdmin,
        profile,
        createdAt: at,
        updatedAt: at
      };
      await db.collection('v2_users').insertOne(user);
      link = {
        userId: user.id,
        walletId: wallet.id,
        role: 'login',
        verifiedAt: at,
        createdAt: at
      };
      await db.collection('v2_user_wallets').insertOne(link);
    }

    return { user: userFromDoc(user), wallet: walletFromDoc(wallet) };
  }

  async setAdminStatus({ userId, isAdmin }) {
    const db = await this._db();
    await db.collection('v2_users').updateOne({ id: userId }, { $set: { isAdmin: !!isAdmin, updatedAt: nowIso() } });
    return await this.findUserById(userId);
  }

  async createWalletChallenge({ address, chain = 'solana', purpose = 'login', subject = null, expiresAt, nonce = null, message = null } = {}) {
    const db = await this._db();
    const normalizedChain = normalizeChain(chain);
    const normalizedAddress = address ? normalizeAddress(address, normalizedChain) : null;
    const challenge = {
      id: createId('chg'),
      purpose,
      chain: normalizedChain,
      normalizedAddress,
      subject,
      nonce: nonce || createId(),
      message: message || nonce || createId(),
      createdAt: nowIso(),
      expiresAt: toIso(expiresAt || new Date(Date.now() + 5 * 60 * 1000)),
      consumedAt: null
    };
    await db.collection('v2_auth_challenges').insertOne(challenge);
    return challenge;
  }

  async consumeWalletChallenge({ challengeId = null, address = null, chain = 'solana', purpose = 'login', nonce = null } = {}) {
    const db = await this._db();
    const query = challengeId
      ? { id: challengeId }
      : {
          purpose,
          nonce,
          chain: normalizeChain(chain),
          normalizedAddress: normalizeAddress(address, chain)
        };
    const challenge = await db.collection('v2_auth_challenges').findOne(query, { sort: { createdAt: -1 } });
    if (!challenge || challenge.consumedAt || new Date(challenge.expiresAt).getTime() < Date.now()) return null;
    const consumedAt = nowIso();
    await db.collection('v2_auth_challenges').updateOne({ id: challenge.id }, { $set: { consumedAt } });
    return { ...challenge, consumedAt };
  }

  async getWalletChallenge(challengeId) {
    const db = await this._db();
    return await db.collection('v2_auth_challenges').findOne({ id: challengeId });
  }

  async createSession({ userId, expiresAt, metadata = null } = {}) {
    const db = await this._db();
    if (!userId) throw new Error('userId is required');
    const session = {
      id: createId('ses'),
      userId,
      createdAt: nowIso(),
      expiresAt: toIso(expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
      revokedAt: null,
      metadata
    };
    await db.collection('v2_auth_sessions').insertOne(session);
    return session;
  }

  async getSession(sessionId) {
    const db = await this._db();
    const session = await db.collection('v2_auth_sessions').findOne({ id: sessionId });
    if (!session || session.revokedAt || new Date(session.expiresAt).getTime() < Date.now()) return null;
    const user = await this.findUserById(session.userId);
    return { ...session, user };
  }

  async revokeSession(sessionId) {
    const db = await this._db();
    await db.collection('v2_auth_sessions').updateOne({ id: sessionId }, { $set: { revokedAt: nowIso() } });
    return true;
  }

  async linkExternalIdentity({ userId, provider, providerUserId, profile = null, verifiedAt = new Date() } = {}) {
    const db = await this._db();
    if (!userId || !provider || !providerUserId) throw new Error('userId, provider, and providerUserId are required');
    const at = nowIso();
    await db.collection('v2_external_identities').updateOne(
      { provider, providerUserId },
      {
        $set: { userId, provider, providerUserId, profile, verifiedAt: toIso(verifiedAt), updatedAt: at },
        $setOnInsert: { id: createId('ext'), createdAt: at }
      },
      { upsert: true }
    );
    return await db.collection('v2_external_identities').findOne({ provider, providerUserId });
  }

  async createOAuthState({ provider, owner, codeVerifier = null, state = null, scopes = [], payload = null, expiresAt } = {}) {
    const db = await this._db();
    const oauthState = {
      id: createId('oas'),
      provider,
      state: state || createId(),
      owner: normalizeOwner(owner),
      codeVerifier,
      scopes,
      payload,
      createdAt: nowIso(),
      expiresAt: toIso(expiresAt || new Date(Date.now() + 10 * 60 * 1000)),
      consumedAt: null
    };
    await db.collection('v2_oauth_states').insertOne(oauthState);
    return oauthState;
  }

  async consumeOAuthState({ provider, state }) {
    const db = await this._db();
    const row = await db.collection('v2_oauth_states').findOne({ provider, state });
    if (!row || row.consumedAt || new Date(row.expiresAt).getTime() < Date.now()) return null;
    const consumedAt = nowIso();
    await db.collection('v2_oauth_states').updateOne({ id: row.id }, { $set: { consumedAt } });
    return { ...row, consumedAt };
  }

  async saveProviderCredential({ provider, owner, credential, profile = null, scopes = [], expiresAt = null, status = 'active', error = null } = {}) {
    const db = await this._db();
    const normalizedOwner = normalizeOwner(owner);
    const at = nowIso();
    await db.collection('v2_provider_credentials').updateOne(
      { provider, 'owner.kind': normalizedOwner.kind, 'owner.id': normalizedOwner.id },
      {
        $set: {
          provider,
          owner: normalizedOwner,
          credential,
          profile,
          scopes,
          expiresAt: toIso(expiresAt),
          status,
          error,
          updatedAt: at
        },
        $setOnInsert: { id: createId('pcr'), createdAt: at }
      },
      { upsert: true }
    );
    return await this.getProviderCredential({ provider, owner: normalizedOwner });
  }

  async getProviderCredential({ provider, owner }) {
    const db = await this._db();
    const normalizedOwner = normalizeOwner(owner);
    return credentialFromDoc(await db.collection('v2_provider_credentials').findOne({
      provider,
      'owner.kind': normalizedOwner.kind,
      'owner.id': normalizedOwner.id
    }));
  }

  async deleteProviderCredential({ provider, owner }) {
    const db = await this._db();
    const normalizedOwner = normalizeOwner(owner);
    const result = await db.collection('v2_provider_credentials').deleteOne({
      provider,
      'owner.kind': normalizedOwner.kind,
      'owner.id': normalizedOwner.id
    });
    return result.deletedCount > 0;
  }

  async recordAuthEvent({ event, userId = null, walletId = null, provider = null, owner = null, ip = null, userAgent = null, details = null } = {}) {
    const db = await this._db();
    const normalizedOwner = owner ? normalizeOwner(owner) : null;
    const doc = {
      id: createId('evt'),
      event,
      userId,
      walletId,
      provider,
      owner: normalizedOwner,
      ip,
      userAgent,
      details,
      createdAt: nowIso()
    };
    await db.collection('v2_auth_events').insertOne(doc);
    return { id: doc.id };
  }
}
