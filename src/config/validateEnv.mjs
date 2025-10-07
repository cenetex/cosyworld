// Basic environment validation (Phase 1)
// Expands later with schema & optional severity levels.

const REQUIRED = [
  'DISCORD_BOT_TOKEN',
  'DISCORD_CLIENT_ID',
  'MONGO_URI'
];

const CONDITIONAL = [
  { vars: ['OPENROUTER_API_KEY','OPENROUTER_API_TOKEN'], when: () => (process.env.AI_SERVICE || 'openrouter').toLowerCase() === 'openrouter' },
  { vars: ['GOOGLE_AI_API_KEY','GOOGLE_API_KEY'], when: () => (process.env.AI_SERVICE || '') === 'google' }
];

export function validateEnv(logger = console) {
  const errors = [];
  for (const v of REQUIRED) {
    if (!process.env[v] || String(process.env[v]).trim() === '') errors.push(`Missing required env: ${v}`);
  }
  for (const group of CONDITIONAL) {
    if (group.when()) {
      const hasOne = group.vars.some(v => process.env[v] && String(process.env[v]).trim() !== '');
      if (!hasOne) errors.push(`Missing at least one of: ${group.vars.join(', ')}`);
    }
  }
  if (errors.length) {
    // Changed from error to warning - let the wizard handle configuration
    logger.warn('[config] Environment validation warnings (configuration wizard will help):', errors);
  } else {
    logger.info('[config] Environment validation passed.');
  }
  return { ok: errors.length === 0, errors };
}

export default validateEnv;
