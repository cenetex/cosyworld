// admin-auth.js: centralizes wallet initialization & signing for admin pages
import { initializeWallet, signWriteHeaders } from '../services/wallet.js';

let initialized = false;
let initError = null;

export async function ensureWallet() {
  if (initialized) return { ok: !initError, error: initError };
  try {
    await initializeWallet();
    initialized = true;
    return { ok: true };
  } catch (e) {
    initError = e;
    initialized = true;
    return { ok: false, error: e };
  }
}

export async function getSignedHeaders(meta) {
  return signWriteHeaders(meta);
}

export async function signedFetch(path, options = {}, meta) {
  const method = (options.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    const sig = await getSignedHeaders(meta);
    options.headers = { ...(options.headers || {}), ...sig };
  }
  return fetch(path, options);
}

// Convenience for integrating with AdminAPI wrapper
export async function augmentOptionsWithSignature(options = {}, meta) {
  const sig = await getSignedHeaders(meta);
  return { ...options, headers: { ...(options.headers || {}), ...sig } };
}
