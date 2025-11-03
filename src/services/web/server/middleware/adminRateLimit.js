// Simple in-memory token bucket per route key (method+path pattern) for admin writes
const buckets = new Map();
const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_TOKENS = Number(process.env.ADMIN_WRITE_RATE_MAX || 100);

export function adminWriteRateLimit(req, res, next) {
  const method = (req.method || 'GET').toUpperCase();
  if (!['POST','PUT','PATCH','DELETE'].includes(method)) return next();
  if (!req.path.startsWith('/api/admin')) return next();
  const key = method + ':' + req.path.replace(/\/[0-9a-f]{24}(?=\/|$)/gi, '/:id');
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) { b = { tokens: MAX_TOKENS, updated: now }; buckets.set(key, b); }
  const elapsed = now - b.updated;
  if (elapsed > WINDOW_MS) {
    // Refill proportionally (simplified full refill each window)
    b.tokens = MAX_TOKENS;
    b.updated = now;
  }
  if (b.tokens <= 0) {
    return res.status(429).json({ error: 'Route write rate limit exceeded' });
  }
  b.tokens -= 1;
  next();
}
