import crypto from 'crypto';

const rawSecret = process.env.ENCRYPTION_KEY || process.env.APP_SECRET || '';
if (process.env.NODE_ENV === 'production') {
  if (!rawSecret || rawSecret.length < 16) {
    throw new Error('ENCRYPTION_KEY/APP_SECRET must be set to a strong value in production');
  }
}
const secret = rawSecret || 'dev-secret';

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
  // Decide secure cookie behavior
  const xfProto = res?.req?.headers?.['x-forwarded-proto'];
  const isHttps = res?.req?.secure || res?.req?.protocol === 'https' || xfProto === 'https';
  let secure;
  if (process.env.COOKIE_SECURE === 'true') secure = true;
  else if (process.env.COOKIE_SECURE === 'false') secure = false;
  else secure = process.env.NODE_ENV === 'production' ? true : !!isHttps; // default secure in prod
  res.cookie('authToken', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export default { attachUserFromCookie, ensureAuthenticated, ensureAdmin, issueAuthCookie };

// Additional write-safety middleware: require a fresh signed message
import nacl from 'tweetnacl';
import bs58 from 'bs58';

export function requireSignedWrite(req, res, next) {
  try {
    const method = (req.method || 'GET').toUpperCase();
    // Only enforce for mutating methods
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next();

    // Use req.get for case-insensitive header retrieval (Express normalizes to lowercase internally)
    const addr = req.get('x-wallet-address');
    const msg = req.get('x-message');
    const sig = req.get('x-signature');
    if (!addr || !msg || !sig) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[requireSignedWrite] missing header(s)', {
          haveAddr: !!addr,
          haveMsg: !!msg,
          haveSig: !!sig,
          path: req.path,
          method
        });
      }
      return res.status(401).json({ error: 'Signed message required' });
    }

    // Reject messages older than 2 minutes to prevent replay
    let payload;
    try { payload = JSON.parse(msg); } catch {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[requireSignedWrite] invalid JSON message', { msgSnippet: String(msg).slice(0,120) });
      }
    }
    const now = Date.now();
    if (!payload || typeof payload !== 'object' || !payload.nonce || !payload.ts) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[requireSignedWrite] missing nonce/ts in payload', { payload });
      }
      return res.status(400).json({ error: 'Invalid message payload' });
    }
    if (Math.abs(now - Number(payload.ts)) > 2 * 60 * 1000) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[requireSignedWrite] expired signed message', { ts: payload.ts, now });
      }
      return res.status(400).json({ error: 'Signed message expired' });
    }

    // Verify signature (ed25519 base58 address/signature)
    const pubKey = bs58.decode(String(addr));
    // Sign the exact msg string to avoid canonicalization differences
    const messageBytes = new TextEncoder().encode(String(msg));
    let sigBytes;
    try { sigBytes = bs58.decode(String(sig)); } catch {
      // Allow JSON array of byte values as a fallback
      try { sigBytes = new Uint8Array(JSON.parse(sig)); } catch {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[requireSignedWrite] signature decode failed', { sigSnippet: String(sig).slice(0,60) });
        }
        return res.status(400).json({ error: 'Invalid signature format' });
      }
    }

    const ok = nacl.sign.detached.verify(messageBytes, sigBytes, pubKey);
    if (!ok) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[requireSignedWrite] signature verification failed', { addr, op: payload.op, path: req.path });
      }
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Attach signer to request for downstream handlers
    req.signer = { walletAddress: String(addr), payload };
    return next();
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[requireSignedWrite] exception', e);
    }
    return res.status(400).json({ error: 'Signature verification error' });
  }
}
