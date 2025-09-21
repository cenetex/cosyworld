#!/usr/bin/env node
import 'dotenv/config';
import OpenAI from 'openai';

// This script intentionally triggers an error (bad model) to demonstrate parsed logging.
// Usage: node scripts/debug-openrouter-error.mjs

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('OPENROUTER_API_KEY missing in env.');
  process.exit(1);
}

const client = new OpenAI({
  apiKey,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://ratimics.com',
    'X-Title': 'cosyworld'
  }
});

async function run() {
  try {
    // Deliberately invalid model (assuming it does not exist) to force 400/404
    await client.chat.completions.create({
      model: 'nonexistent/provider-model-x999',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 5
    });
  } catch (err) {
    const status = err?.response?.status || err?.status;
    const raw = err?.error || err?.response?.data?.error || {};
    const parsed = {
      status,
      code: raw?.code || (status ? `HTTP_${status}` : null),
      type: raw?.type || null,
      providerMessage: raw?.message || err.message
    };
    console.log('[debug-openrouter-error] Parsed error:', parsed);
    if (process.env.DEBUG_FULL_ERROR === 'true') {
      console.log('Raw error object keys:', Object.keys(err));
    }
  }
}
run();
