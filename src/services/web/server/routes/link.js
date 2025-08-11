/**
 * Wallet Linking API: issue challenge and verify signatures to link wallets to Discord accounts.
 */
import express from 'express';
import crypto from 'crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

export default function linkRoutes(db) {
  if (!db) throw new Error('Database not connected');
  const router = express.Router();
  const codesCol = db.collection('wallet_link_codes');
  const linksCol = db.collection('discord_wallet_links');
  const auditCol = db.collection('wallet_link_audit');

  // Indexes
  codesCol.createIndex({ code: 1 }, { unique: true }).catch(()=>{});
  codesCol.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(()=>{}); // auto-expire
  linksCol.createIndex({ discordId: 1 }, { unique: false }).catch(()=>{});
  linksCol.createIndex({ address: 1, chain: 1 }, { unique: false }).catch(()=>{});
  auditCol.createIndex({ at: 1 }).catch(()=>{});
  auditCol.createIndex({ ip: 1, at: 1 }).catch(()=>{});

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
      await auditCol.insertOne({ event, ip, at: new Date(), ua: req.headers['user-agent'] || '', ...extra });
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

  // Endpoint for the bot to create a code (optional external use)
  router.post('/initiate', rateLimit(10, 60_000), async (req, res) => {
    const { discordId, guildId } = req.body || {};
    if (!discordId) return res.status(400).json({ error: 'discordId required' });
    const code = makeCode(18);
    const nonce = makeCode(12);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes
    await codesCol.insertOne({ code, nonce, discordId, guildId: guildId || null, createdAt: now, expiresAt, used: false });
    audit(req, 'link.initiate', { discordId, guildId, code });
    res.json({ code, expiresAt });
  });

  // Returns the canonical message to sign
  router.get('/challenge', rateLimit(60, 60_000), async (req, res) => {
  const code = normalizeCode(req.query?.code);
  if (!code) return res.status(400).json({ error: 'code required' });
  const rec = await codesCol.findOne({ code });
    if (!rec) return res.status(404).json({ error: 'invalid code' });
    if (rec.used) return res.status(410).json({ error: 'code already used' });
    if (rec.expiresAt && rec.expiresAt < new Date()) return res.status(410).json({ error: 'code expired' });
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const issuedAt = rec.createdAt?.toISOString() || new Date().toISOString();
    const message = challengeMessage({ host, discordId: rec.discordId, code: rec.code, nonce: rec.nonce, issuedAt });
    audit(req, 'link.challenge', { discordId: rec.discordId, code: rec.code });
    res.json({ message, discordId: rec.discordId });
  });

  // Verify signature and link
  router.post('/complete', rateLimit(30, 60_000), async (req, res) => {
    try {
  const { chain, address, signature, message, publicKey } = req.body || {};
  const code = normalizeCode(req.body?.code);
      if (!code || !chain || !address || !signature || !message) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
  const rec = await codesCol.findOne({ code });
      if (!rec) return res.status(404).json({ error: 'invalid code' });
      if (rec.used) return res.status(410).json({ error: 'code already used' });
      if (rec.expiresAt && rec.expiresAt < new Date()) return res.status(410).json({ error: 'code expired' });

      const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
      const expected = challengeMessage({ host, discordId: rec.discordId, code: rec.code, nonce: rec.nonce, issuedAt: rec.createdAt?.toISOString() || '' });
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
        audit(req, 'link.complete.fail', { reason: 'verify', discordId: rec.discordId, chain, address });
        return res.status(401).json({ error: 'signature verification failed' });
      }

      const now = new Date();
      await codesCol.updateOne({ _id: rec._id }, { $set: { used: true, usedAt: now } });
      const linkDoc = { discordId: rec.discordId, guildId: rec.guildId || null, chain: lowerChain, address, verifiedAt: now, createdAt: rec.createdAt };
      await linksCol.updateOne({ discordId: rec.discordId, chain: lowerChain, address }, { $set: linkDoc }, { upsert: true });
      audit(req, 'link.complete.success', { discordId: rec.discordId, chain: lowerChain, address });
      res.json({ success: true, linked: linkDoc });
    } catch (e) {
      audit(req, 'link.complete.error', { error: String(e?.message || e) });
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
