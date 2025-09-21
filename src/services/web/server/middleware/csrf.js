// CSRF middleware: issues and validates per-session HMAC tokens bound to wallet & cookie
import crypto from 'crypto';

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const ISSUED = new Map(); // sessionId -> { token, issued }

function deriveSecret() {
  // Use a stable secret base (fallback to NODE_ENV for dev if not set)
  const base = process.env.CSRF_SECRET || process.env.SESSION_SECRET || 'dev-secret';
  return crypto.createHash('sha256').update(base).digest();
}

function hmac(data) {
  return crypto.createHmac('sha256', deriveSecret()).update(data).digest('base64url');
}

function buildToken({ wallet, sessionId }) {
  const nonce = crypto.randomBytes(16).toString('base64url');
  const ts = Date.now();
  const body = `${wallet || 'anon'}:${sessionId}:${nonce}:${ts}`;
  const sig = hmac(body);
  return `${body}:${sig}`;
}

export function csrfTokenRoute() {
  return (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const sessionId = req.cookies?.sessionId || req.user?.sessionId || 'session';
    // Re-issue if missing or expired
    const existing = ISSUED.get(sessionId);
    if (existing && Date.now() - existing.issued < TOKEN_TTL_MS) {
      return res.json({ token: existing.token, expiresIn: TOKEN_TTL_MS - (Date.now() - existing.issued) });
    }
    const token = buildToken({ wallet: req.user?.walletAddress, sessionId });
    ISSUED.set(sessionId, { token, issued: Date.now() });
    res.json({ token, expiresIn: TOKEN_TTL_MS });
  };
}

export function validateCsrf(req, res, next) {
  const method = (req.method || 'GET').toUpperCase();
  if (!['POST','PUT','PATCH','DELETE'].includes(method)) return next();
  if (!req.path.startsWith('/api/admin')) return next();
  const hdr = req.get('x-csrf-token');
  if (!hdr) return res.status(403).json({ error: 'Missing CSRF token' });
  const parts = hdr.split(':');
  // Expected format: wallet:sessionId:nonce:ts:sig (5 parts)
  if (parts.length !== 5) return res.status(403).json({ error: 'Malformed CSRF token' });
  const [wallet, sessionId, nonce, tsStr, sigProvided] = parts;
  const issued = ISSUED.get(sessionId);
  if (!issued || issued.token !== hdr) return res.status(403).json({ error: 'Unknown CSRF token' });
  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || Date.now() - ts > TOKEN_TTL_MS) return res.status(403).json({ error: 'Expired CSRF token' });
  const body = `${wallet}:${sessionId}:${nonce}:${ts}`;
  const expected = hmac(body);
  if (expected !== sigProvided) return res.status(403).json({ error: 'Invalid CSRF signature' });
  next();
}

export default { csrfTokenRoute, validateCsrf };
