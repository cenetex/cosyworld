/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { extractJsonFuzzy } from './extractJsonFuzzy.mjs';

/**
 * Attempt to extract and parse a JSON object/array from raw model output.
 * Strategy:
 * 1. Direct JSON.parse (fast path) if the whole string parses.
 * 2. Delimited scan for first balanced top-level object/array.
 * 3. Fuzzy extraction (re-uses extractJsonFuzzy) as last resort.
 * Returns parsed object or throws last error if all strategies fail.
 */
export function parseFirstJson(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('No text to parse');
  const trimmed = text.trim();
  // Fast path
  try {
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      return JSON.parse(trimmed);
    }
  } catch {} // fallthrough

  // Balanced scan (borrow logic similar to existing implementations)
  const openIdx = trimmed.search(/[\[{]/);
  if (openIdx !== -1) {
    const openChar = trimmed[openIdx];
    const closeChar = openChar === '{' ? '}' : ']';
    let depth = 0;
    for (let i = openIdx; i < trimmed.length; i++) {
      const c = trimmed[i];
      if (c === openChar) depth++;
      else if (c === closeChar) depth--;
      if (depth === 0) {
        const candidate = trimmed.slice(openIdx, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {}
        break;
      }
    }
  }

  // Fuzzy
  const fuzzy = extractJsonFuzzy(trimmed);
  if (fuzzy != null) return fuzzy;
  throw new Error('Unable to parse JSON from text');
}

/**
 * Repeatedly invoke a provider to obtain raw output and parse JSON.
 * - getRaw: async fn returning string
 * - retries: additional attempts after initial (default 2 → total 3 tries)
 * - backoffMs: base delay between attempts (exponential + jitter)
 */
export async function parseWithRetries(getRaw, { retries = 2, backoffMs = 500 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const raw = await getRaw();
    try {
      return parseFirstJson(raw);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const delay = backoffMs * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
    }
  }
  throw lastErr || new Error('JSON parse attempts exhausted');
}
