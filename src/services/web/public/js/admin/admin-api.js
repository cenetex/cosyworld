// admin-api.js: centralized API + CSRF handling
let _csrfToken = null;
let _csrfFetchedAt = 0;
const CSRF_TTL_MS = 1000 * 60 * 60 * 1.5; // 1.5h (token TTL is 2h; refresh early)

async function fetchCsrfToken() {
  const now = Date.now();
  if (_csrfToken && (now - _csrfFetchedAt) < CSRF_TTL_MS) return _csrfToken;
  try {
    const res = await fetch('/api/admin/csrf-token', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed CSRF token fetch');
    const data = await res.json();
    if (data?.token) {
      _csrfToken = data.token;
      _csrfFetchedAt = now;
    }
    return _csrfToken;
  } catch (e) {
    console.warn('[admin-api] CSRF token fetch failed:', e.message);
    return null;
  }
}

function normalizeError(e) {
  if (typeof e === 'string') return { message: e };
  if (!e) return { message: 'Unknown error' };
  if (e instanceof Error) return { message: e.message, stack: e.stack };
  if (e.message) return e;
  return { message: JSON.stringify(e).slice(0,300) };
}

// sign: when true and method is mutating, automatically fetch signed headers via admin-auth
export async function apiFetch(path, { method = 'GET', body, headers = {}, requireCsrf = false, json = true, sign = false, signMeta } = {}) {
  const opts = { method, headers: { ...headers }, credentials: 'include' };
  if (body !== undefined) {
    if (body instanceof FormData) {
      opts.body = body; // let browser set multipart boundary
    } else if (typeof body === 'object' && !(body instanceof Blob)) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    } else {
      opts.body = body;
    }
  }
  const isMutating = ['POST','PUT','PATCH','DELETE'].includes(method.toUpperCase());
  if (requireCsrf && isMutating) {
    const token = await fetchCsrfToken();
    if (token) opts.headers['x-csrf-token'] = token;
  }
  if (sign && isMutating) {
    try {
      // dynamic import to avoid circular dependency if admin-auth imports apiFetch somewhere
      const auth = await import('./admin-auth.js');
      const signed = await auth.getSignedHeaders(signMeta || {});
      Object.assign(opts.headers, signed);
    } catch (e) {
      const normalized = normalizeError(e);
      const message = normalized.message || 'Wallet signature required';
      throw { ...normalized, message };
    }
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch (e) {
    throw normalizeError(e);
  }
  let data = null;
  const ct = res.headers.get('Content-Type') || '';
  if (json && ct.includes('application/json')) {
    try { data = await res.json(); } catch { data = null; }
  } else if (!json) {
    data = await res.text().catch(() => null);
  }
  if (!res.ok) {
    const errMsg = data?.error || data?.message || res.statusText || 'Request failed';
    throw { status: res.status, message: errMsg, data };
  }
  return data;
}

export async function safeApi(path, opts) {
  try { return { ok: true, data: await apiFetch(path, opts) }; }
  catch (e) { return { ok: false, error: e }; }
}

export function invalidateCsrf() { _csrfToken = null; _csrfFetchedAt = 0; }
