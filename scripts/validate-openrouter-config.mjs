#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';

async function loadCapabilities() {
  const file = path.join(process.cwd(), 'data', 'openrouter-model-capabilities.json');
  try {
    const txt = await fs.readFile(file, 'utf8');
    return JSON.parse(txt).capabilities || {};
  } catch (e) {
    console.error(`[ERROR] Cannot load capabilities file (${e.message}). Run: npm run task update:models`);
    return null;
  }
}

function getenv(keys) {
  const out = {};
  for (const k of keys) out[k] = process.env[k];
  return out;
}

function checkModel(name, caps) {
  if (!name) return { ok: false, reason: 'not set' };
  const record = caps[name];
  if (!record) return { ok: false, reason: 'missing from capabilities (maybe filtered or fetch failed)' };
  if (!record.supportsResponseFormat) return { ok: false, reason: 'does not support response_format (json_schema)' };
  return { ok: true };
}

async function main() {
  const caps = await loadCapabilities();
  if (!caps) process.exit(2);

  const env = getenv([
    'OPENROUTER_MODEL',
    'OPENROUTER_CHAT_MODEL',
    'OPENROUTER_VISION_MODEL',
    'OPENROUTER_STRUCTURED_MODEL',
    'META_PROMPT_MODEL'
  ]);

  const report = {};
  for (const [k, v] of Object.entries(env)) {
    if (!v) { report[k] = { status: 'WARN', message: 'Not set' }; continue; }
    const check = checkModel(v, caps);
    if (k.includes('STRUCTURED')) {
      report[k] = check.ok ? { status: 'OK', message: 'Structured output supported' } : { status: 'ERROR', message: check.reason };
    } else {
      report[k] = check.ok ? { status: 'OK', message: 'Model present' } : { status: 'WARN', message: check.reason };
    }
  }

  let hasError = false;
  console.log('\nOpenRouter Environment Validation');
  console.log('--------------------------------');
  for (const [k, v] of Object.entries(report)) {
    const tag = v.status === 'OK' ? '✅' : v.status === 'ERROR' ? '❌' : '⚠️';
    if (v.status === 'ERROR') hasError = true;
    console.log(`${tag} ${k} = ${env[k] || '(unset)'} -> ${v.status} ${v.message}`);
  }
  console.log('--------------------------------');
  if (hasError) {
    console.log('❌ One or more required structured models are misconfigured.');
    process.exit(1);
  } else {
    console.log('✅ Validation complete.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
