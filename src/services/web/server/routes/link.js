/**
 * Wallet Linking API: issue challenge and verify signatures to link wallets to Discord accounts.
 */
import express from 'express';
import crypto from 'crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

export default function linkRoutes(input) {
  const services = input?.dataLayer ? input : null;
  const identityStore = services?.dataLayer?.identity || null;
  const db = services ? null : input;
  if (!identityStore && !db?.collection) throw new Error('Database not connected');
  const router = express.Router();
  const codesCol = db?.collection?.('wallet_link_codes');
  const linksCol = db?.collection?.('discord_wallet_links');
  const auditCol = db?.collection?.('wallet_link_audit');

  // Indexes
  codesCol?.createIndex({ code: 1 }, { unique: true }).catch(()=>{});
  codesCol?.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(()=>{}); // auto-expire
  linksCol?.createIndex({ discordId: 1 }, { unique: false }).catch(()=>{});
  linksCol?.createIndex({ address: 1, chain: 1 }, { unique: false }).catch(()=>{});
  auditCol?.createIndex({ at: 1 }).catch(()=>{});
  auditCol?.createIndex({ ip: 1, at: 1 }).catch(()=>{});

  // Basic in-memory rate limiter (per-process) to reduce abuse
  const recentHits = new Map(); // key: ip:path, value: { count, ts }
  const rateLimit = (limit, windowMs) => (req, res, next) => {
    try {
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress || 'unknown';
      const key = `${ip}:${req.path}`;
      const now = Date.now();
      const rec = recentHits.get(key);
      if (!rec || (now - rec.ts) > windowMs) {
        recentHits.set(key, { count: 1, ts: now });
        return next();
      }
      if (rec.count >= limit) return res.status(429).json({ error: 'Too many requests' });
      rec.count += 1;
      next();
    } catch { next(); }
  };

  const audit = async (req, event, extra = {}) => {
    try {
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress || 'unknown';
      if (identityStore) {
        await identityStore.recordAuthEvent({
          event,
          ip,
          userAgent: req.headers['user-agent'] || '',
          details: extra
        });
      } else {
        await auditCol.insertOne({ event, ip, at: new Date(), ua: req.headers['user-agent'] || '', ...extra });
      }
    } catch {}
  };

  function makeCode(len = 24) {
    return crypto.randomBytes(len).toString('base64url');
  }

  function normalizeCode(v) {
    return String(v || '')
      .trim()
      .replace(/\|/g, '') // strip Discord spoiler pipes
      .replace(/\s+/g, ''); // remove any whitespace
  }

  function challengeMessage({ host, discordId, code, nonce, issuedAt }) {
    return [
      'Sign to link your wallet to Discord',
      `Domain: ${host}`,
      `Discord ID: ${discordId}`,
      `Code: ${code}`,
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt}`
    ].join('\n');
  }

  function isExpired(expiresAt) {
    return expiresAt && new Date(expiresAt).getTime() < Date.now();
  }

  // Endpoint for the bot to create a code (optional external use)
  router.post('/initiate', rateLimit(10, 60_000), async (req, res) => {
    const { discordId, guildId } = req.body || {};
    if (!discordId) return res.status(400).json({ error: 'discordId required' });
    const code = makeCode(18);
    const nonce = makeCode(12);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes
    if (identityStore) {
      const challenge = await identityStore.createWalletChallenge({
        purpose: 'discord_wallet_link',
        subject: { discordId, guildId: guildId || null, code },
        nonce,
        expiresAt
      });
      audit(req, 'link.initiate', { discordId, guildId, code: challenge.id });
      return res.json({ code: challenge.id, expiresAt });
    }

    await codesCol.insertOne({ code, nonce, discordId, guildId: guildId || null, createdAt: now, expiresAt, used: false });
    audit(req, 'link.initiate', { discordId, guildId, code });
    return res.json({ code, expiresAt });
  });

  // Returns the canonical message to sign
  router.get('/challenge', rateLimit(60, 60_000), async (req, res) => {
    const code = normalizeCode(req.query?.code);
    if (!code) return res.status(400).json({ error: 'code required' });
    const rec = identityStore ? await identityStore.getWalletChallenge(code) : await codesCol.findOne({ code });
    if (!rec) return res.status(404).json({ error: 'invalid code' });
    if (rec.used || rec.consumedAt) return res.status(410).json({ error: 'code already used' });
    if (isExpired(rec.expiresAt)) return res.status(410).json({ error: 'code expired' });
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const subject = rec.subject || {};
    const discordId = rec.discordId || subject.discordId;
    const issuedAt = rec.createdAt?.toISOString?.() || rec.createdAt || new Date().toISOString();
    const message = challengeMessage({ host, discordId, code: rec.code || rec.id, nonce: rec.nonce, issuedAt });
    audit(req, 'link.challenge', { discordId, code: rec.code || rec.id });
    res.json({ message, discordId });
  });

  // Verify signature and link
  router.post('/complete', rateLimit(30, 60_000), async (req, res) => {
    try {
      const { chain, address, signature, message, publicKey } = req.body || {};
      const code = normalizeCode(req.body?.code);
      if (!code || !chain || !address || !signature || !message) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      const rec = identityStore ? await identityStore.getWalletChallenge(code) : await codesCol.findOne({ code });
      if (!rec) return res.status(404).json({ error: 'invalid code' });
      if (rec.used || rec.consumedAt) return res.status(410).json({ error: 'code already used' });
      if (isExpired(rec.expiresAt)) return res.status(410).json({ error: 'code expired' });

      const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
      const subject = rec.subject || {};
      const discordId = rec.discordId || subject.discordId;
      const guildId = rec.guildId ?? subject.guildId ?? null;
      const issuedAt = rec.createdAt?.toISOString?.() || rec.createdAt || '';
      const expected = challengeMessage({ host, discordId, code: rec.code || rec.id, nonce: rec.nonce, issuedAt });
      if (expected !== message) return res.status(400).json({ error: 'message mismatch' });

      const lowerChain = String(chain).toLowerCase();
      let verified = false;
      if (lowerChain === 'solana') {
        try {
          const sigBytes = Buffer.from(signature, 'hex');
          const msgBytes = new TextEncoder().encode(message);
          const pubKey = publicKey ? bs58.decode(publicKey) : bs58.decode(address);
          verified = nacl.sign.detached.verify(msgBytes, sigBytes, pubKey);
        } catch {}
      } else {
        try {
          const { verifyMessage } = await import('ethers');
          const recovered = verifyMessage(message, signature);
          verified = recovered?.toLowerCase() === String(address).toLowerCase();
        } catch {}
      }
      if (!verified) {
        audit(req, 'link.complete.fail', { reason: 'verify', discordId, chain, address });
        return res.status(401).json({ error: 'signature verification failed' });
      }

      const now = new Date();
      if (identityStore) {
        const consumed = await identityStore.consumeWalletChallenge({ challengeId: rec.id });
        if (!consumed) return res.status(410).json({ error: 'code already used or expired' });

        const { user, wallet } = await identityStore.upsertWalletUser({
          address,
          chain: lowerChain,
          displayAddress: address
        });
        await identityStore.linkExternalIdentity({
          userId: user.id,
          provider: 'discord',
          providerUserId: discordId,
          profile: { guildId }
        });

        const linkDoc = { discordId, guildId, chain: lowerChain, address, userId: user.id, walletId: wallet.id, verifiedAt: now, createdAt: rec.createdAt };
        audit(req, 'link.complete.success', { discordId, chain: lowerChain, address, userId: user.id, walletId: wallet.id });
        return res.json({ success: true, linked: linkDoc });
      }

      await codesCol.updateOne({ _id: rec._id }, { $set: { used: true, usedAt: now } });
      const linkDoc = { discordId, guildId, chain: lowerChain, address, verifiedAt: now, createdAt: rec.createdAt };
      await linksCol.updateOne({ discordId, chain: lowerChain, address }, { $set: linkDoc }, { upsert: true });
      audit(req, 'link.complete.success', { discordId, chain: lowerChain, address });
      return res.json({ success: true, linked: linkDoc });
    } catch (e) {
      audit(req, 'link.complete.error', { error: String(e?.message || e) });
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
