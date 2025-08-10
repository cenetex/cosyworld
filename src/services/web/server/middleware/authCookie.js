import crypto from 'crypto';

const secret = process.env.ENCRYPTION_KEY || process.env.APP_SECRET || 'dev-secret';

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = 4 - (str.length % 4);
  if (pad !== 4) str += '='.repeat(pad);
  return Buffer.from(str, 'base64').toString();
}
function signPayload(payload) {
  const data = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(data).digest();
  const sigb64 = b64url(sig);
  return `${data}.${sigb64}`;
}
function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [data, sigb64] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(data).digest();
  const given = Buffer.from(sigb64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  const payload = JSON.parse(b64urlDecode(data));
  if (payload.exp && Date.now() > payload.exp) return null;
  return payload;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  const parts = header.split(';');
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx === -1) continue;
    const k = p.slice(0, idx).trim();
    const v = decodeURIComponent(p.slice(idx + 1).trim());
    out[k] = v;
  }
  return out;
}

export function attachUserFromCookie(req, _res, next) {
  try {
    const cookies = parseCookies(req.headers.cookie || '');
    const token = cookies.authToken;
    const payload = verifyToken(token);
    if (payload) {
      req.user = { walletAddress: payload.addr, isAdmin: !!payload.isAdmin };
    }
  } catch {}
  next();
}

export function ensureAuthenticated(req, res, next) {
  if (req.user) return next();
  if (req.accepts('html')) return res.redirect('/admin/login');
  return res.status(401).json({ error: 'Unauthorized' });
}

export function ensureAdmin(req, res, next) {
  if (req.user?.isAdmin) return next();
  if (req.accepts('html')) return res.redirect('/admin/login');
  return res.status(403).json({ error: 'Forbidden' });
}

export function issueAuthCookie(res, { addr, isAdmin }) {
  const now = Date.now();
  const payload = { addr, isAdmin: !!isAdmin, iat: now, exp: now + 7 * 24 * 60 * 60 * 1000 };
  const token = signPayload(payload);
  res.cookie('authToken', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export default { attachUserFromCookie, ensureAuthenticated, ensureAdmin, issueAuthCookie };
