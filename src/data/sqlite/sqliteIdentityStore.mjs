import {
  createId,
  decodeJson,
  encodeJson,
  normalizeAddress,
  normalizeChain,
  normalizeOwner,
  nowIso,
  toIso
} from '../identityUtils.mjs';

function userFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    isAdmin: !!row.is_admin,
    profile: decodeJson(row.profile_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function walletFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    chain: row.chain,
    normalizedAddress: row.normalized_address,
    displayAddress: row.display_address,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function credentialFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    owner: { kind: row.owner_kind, id: row.owner_id },
    credential: decodeJson(row.credential_json, {}),
    profile: decodeJson(row.profile_json, null),
    scopes: decodeJson(row.scopes_json, []),
    expiresAt: row.expires_at,
    status: row.status,
    error: decodeJson(row.error_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SqliteIdentityStore {
  constructor({ sqliteConnection, logger }) {
    this.connection = sqliteConnection;
    this.logger = logger || console;
    this.db = this.connection.connect();
  }

  async initialize() {
    this.connection.connect();
  }

  async findUserById(userId) {
    return userFromRow(this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId));
  }

  async findUserByWallet(address, { chain = 'solana' } = {}) {
    const normalizedChain = normalizeChain(chain);
    const normalizedAddress = normalizeAddress(address, normalizedChain);
    const row = this.db.prepare(`
      SELECT u.*
      FROM users u
      JOIN user_wallets uw ON uw.user_id = u.id
      JOIN wallets w ON w.id = uw.wallet_id
      WHERE w.chain = ? AND w.normalized_address = ?
      ORDER BY uw.verified_at DESC
      LIMIT 1
    `).get(normalizedChain, normalizedAddress);
    return userFromRow(row);
  }

  async hasAdminUser() {
    const row = this.db.prepare('SELECT id FROM users WHERE is_admin = 1 LIMIT 1').get();
    return !!row;
  }

  async upsertWalletUser({ address, chain = 'solana', displayAddress = null, profile = null, isAdmin = false } = {}) {
    const normalizedChain = normalizeChain(chain);
    const normalizedAddress = normalizeAddress(address, normalizedChain);
    if (!normalizedAddress) throw new Error('address is required');

    const display = displayAddress || String(address).trim();
    const at = nowIso();

    const run = this.db.transaction(() => {
      let wallet = this.db.prepare('SELECT * FROM wallets WHERE chain = ? AND normalized_address = ?')
        .get(normalizedChain, normalizedAddress);

      if (!wallet) {
        const walletId = createId('wal');
        this.db.prepare(`
          INSERT INTO wallets (id, chain, normalized_address, display_address, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(walletId, normalizedChain, normalizedAddress, display, at, at);
        wallet = this.db.prepare('SELECT * FROM wallets WHERE id = ?').get(walletId);
      } else if (wallet.display_address !== display) {
        this.db.prepare('UPDATE wallets SET display_address = ?, updated_at = ? WHERE id = ?')
          .run(display, at, wallet.id);
      }

      let user = this.db.prepare(`
        SELECT u.*
        FROM users u
        JOIN user_wallets uw ON uw.user_id = u.id
        WHERE uw.wallet_id = ?
        LIMIT 1
      `).get(wallet.id);

      if (!user) {
        const userId = createId('usr');
        this.db.prepare(`
          INSERT INTO users (id, status, is_admin, profile_json, created_at, updated_at)
          VALUES (?, 'active', ?, ?, ?, ?)
        `).run(userId, isAdmin ? 1 : 0, encodeJson(profile), at, at);
        this.db.prepare(`
          INSERT INTO user_wallets (user_id, wallet_id, role, verified_at, created_at)
          VALUES (?, ?, 'login', ?, ?)
        `).run(userId, wallet.id, at, at);
        user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      }

      return { user: userFromRow(user), wallet: walletFromRow(wallet) };
    });

    return run();
  }

  async setAdminStatus({ userId, isAdmin }) {
    const at = nowIso();
    this.db.prepare('UPDATE users SET is_admin = ?, updated_at = ? WHERE id = ?')
      .run(isAdmin ? 1 : 0, at, userId);
    return await this.findUserById(userId);
  }

  async createWalletChallenge({ address, chain = 'solana', purpose = 'login', subject = null, expiresAt, nonce = null, message = null } = {}) {
    const normalizedChain = normalizeChain(chain);
    const normalizedAddress = address ? normalizeAddress(address, normalizedChain) : null;
    const id = createId('chg');
    const challengeNonce = nonce || createId();
    const at = nowIso();
    const expiry = toIso(expiresAt || new Date(Date.now() + 5 * 60 * 1000));
    const challengeMessage = message || challengeNonce;

    this.db.prepare(`
      INSERT INTO auth_challenges
        (id, purpose, chain, normalized_address, subject_json, nonce, message, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, purpose, normalizedChain, normalizedAddress, encodeJson(subject), challengeNonce, challengeMessage, at, expiry);

    return {
      id,
      purpose,
      chain: normalizedChain,
      normalizedAddress,
      subject,
      nonce: challengeNonce,
      message: challengeMessage,
      createdAt: at,
      expiresAt: expiry
    };
  }

  async consumeWalletChallenge({ challengeId = null, address = null, chain = 'solana', purpose = null, nonce = null } = {}) {
    const normalizedChain = normalizeChain(chain);
    const normalizedAddress = address ? normalizeAddress(address, normalizedChain) : null;
    const query = challengeId
      ? this.db.prepare('SELECT * FROM auth_challenges WHERE id = ?')
      : this.db.prepare(`
        SELECT * FROM auth_challenges
        WHERE purpose = ? AND nonce = ? AND chain = ? AND normalized_address = ?
        ORDER BY created_at DESC
        LIMIT 1
      `);
    const row = challengeId
      ? query.get(challengeId)
      : query.get(purpose || 'login', nonce, normalizedChain, normalizedAddress);

    if (!row) return null;
    if (row.consumed_at) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;

    const consumedAt = nowIso();
    this.db.prepare('UPDATE auth_challenges SET consumed_at = ? WHERE id = ?').run(consumedAt, row.id);
    return {
      id: row.id,
      purpose: row.purpose,
      chain: row.chain,
      normalizedAddress: row.normalized_address,
      subject: decodeJson(row.subject_json, null),
      nonce: row.nonce,
      message: row.message,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      consumedAt
    };
  }

  async getWalletChallenge(challengeId) {
    const row = this.db.prepare('SELECT * FROM auth_challenges WHERE id = ?').get(challengeId);
    if (!row) return null;
    return {
      id: row.id,
      purpose: row.purpose,
      chain: row.chain,
      normalizedAddress: row.normalized_address,
      subject: decodeJson(row.subject_json, null),
      nonce: row.nonce,
      message: row.message,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at
    };
  }

  async createSession({ userId, expiresAt, metadata = null } = {}) {
    if (!userId) throw new Error('userId is required');
    const id = createId('ses');
    const at = nowIso();
    const expiry = toIso(expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    this.db.prepare(`
      INSERT INTO auth_sessions (id, user_id, created_at, expires_at, metadata_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, userId, at, expiry, encodeJson(metadata));
    return { id, userId, createdAt: at, expiresAt: expiry, revokedAt: null, metadata };
  }

  async getSession(sessionId) {
    const row = this.db.prepare(`
      SELECT s.*, u.status AS user_status, u.is_admin
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = ?
    `).get(sessionId);
    if (!row || row.revoked_at || new Date(row.expires_at).getTime() < Date.now()) return null;
    return {
      id: row.id,
      userId: row.user_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      metadata: decodeJson(row.metadata_json, null),
      user: { id: row.user_id, status: row.user_status, isAdmin: !!row.is_admin }
    };
  }

  async revokeSession(sessionId) {
    this.db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ?').run(nowIso(), sessionId);
    return true;
  }

  async linkExternalIdentity({ userId, provider, providerUserId, profile = null, verifiedAt = new Date() } = {}) {
    if (!userId || !provider || !providerUserId) throw new Error('userId, provider, and providerUserId are required');
    const at = nowIso();
    const id = createId('ext');
    this.db.prepare(`
      INSERT INTO external_identities
        (id, user_id, provider, provider_user_id, profile_json, verified_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, provider_user_id) DO UPDATE SET
        user_id = excluded.user_id,
        profile_json = excluded.profile_json,
        verified_at = excluded.verified_at,
        updated_at = excluded.updated_at
    `).run(id, userId, provider, providerUserId, encodeJson(profile), toIso(verifiedAt), at, at);

    return this.db.prepare('SELECT * FROM external_identities WHERE provider = ? AND provider_user_id = ?')
      .get(provider, providerUserId);
  }

  async createOAuthState({ provider, owner, codeVerifier = null, state = null, scopes = [], payload = null, expiresAt } = {}) {
    const normalizedOwner = normalizeOwner(owner);
    const id = createId('oas');
    const at = nowIso();
    const oauthState = state || createId();
    const expiry = toIso(expiresAt || new Date(Date.now() + 10 * 60 * 1000));
    this.db.prepare(`
      INSERT INTO oauth_states
        (id, provider, state, owner_kind, owner_id, code_verifier, scopes_json, payload_json, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, provider, oauthState, normalizedOwner.kind, normalizedOwner.id, codeVerifier, encodeJson(scopes), encodeJson(payload), at, expiry);

    return { id, provider, state: oauthState, owner: normalizedOwner, codeVerifier, scopes, payload, createdAt: at, expiresAt: expiry };
  }

  async consumeOAuthState({ provider, state }) {
    const row = this.db.prepare('SELECT * FROM oauth_states WHERE provider = ? AND state = ?').get(provider, state);
    if (!row || row.consumed_at || new Date(row.expires_at).getTime() < Date.now()) return null;
    const consumedAt = nowIso();
    this.db.prepare('UPDATE oauth_states SET consumed_at = ? WHERE id = ?').run(consumedAt, row.id);
    return {
      id: row.id,
      provider: row.provider,
      state: row.state,
      owner: { kind: row.owner_kind, id: row.owner_id },
      codeVerifier: row.code_verifier,
      scopes: decodeJson(row.scopes_json, []),
      payload: decodeJson(row.payload_json, null),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      consumedAt
    };
  }

  async saveProviderCredential({ provider, owner, credential, profile = null, scopes = [], expiresAt = null, status = 'active', error = null } = {}) {
    const normalizedOwner = normalizeOwner(owner);
    const id = createId('pcr');
    const at = nowIso();
    this.db.prepare(`
      INSERT INTO provider_credentials
        (id, provider, owner_kind, owner_id, credential_json, profile_json, scopes_json, expires_at, status, error_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, owner_kind, owner_id) DO UPDATE SET
        credential_json = excluded.credential_json,
        profile_json = excluded.profile_json,
        scopes_json = excluded.scopes_json,
        expires_at = excluded.expires_at,
        status = excluded.status,
        error_json = excluded.error_json,
        updated_at = excluded.updated_at
    `).run(
      id,
      provider,
      normalizedOwner.kind,
      normalizedOwner.id,
      encodeJson(credential),
      encodeJson(profile),
      encodeJson(scopes),
      toIso(expiresAt),
      status,
      encodeJson(error),
      at,
      at
    );

    return await this.getProviderCredential({ provider, owner: normalizedOwner });
  }

  async getProviderCredential({ provider, owner }) {
    const normalizedOwner = normalizeOwner(owner);
    const row = this.db.prepare(`
      SELECT * FROM provider_credentials
      WHERE provider = ? AND owner_kind = ? AND owner_id = ?
    `).get(provider, normalizedOwner.kind, normalizedOwner.id);
    return credentialFromRow(row);
  }

  async deleteProviderCredential({ provider, owner }) {
    const normalizedOwner = normalizeOwner(owner);
    const result = this.db.prepare(`
      DELETE FROM provider_credentials
      WHERE provider = ? AND owner_kind = ? AND owner_id = ?
    `).run(provider, normalizedOwner.kind, normalizedOwner.id);
    return result.changes > 0;
  }

  async recordAuthEvent({ event, userId = null, walletId = null, provider = null, owner = null, ip = null, userAgent = null, details = null } = {}) {
    const id = createId('evt');
    const normalizedOwner = owner ? normalizeOwner(owner) : null;
    this.db.prepare(`
      INSERT INTO auth_events
        (id, event, user_id, wallet_id, provider, owner_kind, owner_id, ip, user_agent, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      event,
      userId,
      walletId,
      provider,
      normalizedOwner?.kind || null,
      normalizedOwner?.id || null,
      ip,
      userAgent,
      encodeJson(details),
      nowIso()
    );
    return { id };
  }
}
