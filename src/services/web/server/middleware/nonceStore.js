// Ephemeral nonce store to enforce single-use on signed wallet messages
// For production scale, replace with Redis (TTL) if multi-process.
import crypto from 'crypto';
const nonces = new Map(); // nonce -> exp timestamp
const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

export function issueNonce() {
  const nonce = crypto.randomBytes(16).toString('hex');
  const exp = Date.now() + MAX_AGE_MS;
  nonces.set(nonce, exp);
  return { nonce, exp };
}

export function useNonce(nonce) {
  const exp = nonces.get(nonce);
  if (!exp) return false;
  if (Date.now() > exp) { nonces.delete(nonce); return false; }
  nonces.delete(nonce); // single-use
  return true;
}

export function pruneNonces() {
  const now = Date.now();
  for (const [n, exp] of nonces.entries()) if (now > exp) nonces.delete(n);
}
setInterval(pruneNonces, 60 * 1000).unref?.();
