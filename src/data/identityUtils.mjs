import crypto from 'crypto';

export function createId(prefix = '') {
  const id = crypto.randomBytes(12).toString('hex');
  return prefix ? `${prefix}_${id}` : id;
}

export function nowIso() {
  return new Date().toISOString();
}

export function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function encodeJson(value) {
  return JSON.stringify(value ?? null);
}

export function decodeJson(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function normalizeChain(chain = 'solana') {
  return String(chain || 'solana').trim().toLowerCase();
}

export function normalizeAddress(address, chain = 'solana') {
  const trimmed = String(address || '').trim();
  const normalizedChain = normalizeChain(chain);
  if (!trimmed) return '';
  if (['ethereum', 'evm', 'base', 'polygon', 'arbitrum', 'optimism'].includes(normalizedChain)) {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

export function normalizeOwner(owner = {}) {
  const kind = String(owner.kind || 'global').trim().toLowerCase();
  const id = String(owner.id || (kind === 'global' ? 'global' : '')).trim();
  if (!id) throw new Error('owner.id is required');
  return { kind, id };
}
