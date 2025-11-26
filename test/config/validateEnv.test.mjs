import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateEnv } from '../../src/config/validateEnv.mjs';

const ORIGINAL_ENV = { ...process.env };

function setupBaseEnv(overrides = {}) {
  process.env = {
    ...ORIGINAL_ENV,
    DISCORD_BOT_TOKEN: 'bot-token',
    DISCORD_CLIENT_ID: 'client-id',
    MONGO_URI: 'mongodb://localhost/test',
    OPENROUTER_API_KEY: 'openrouter-key',
    ...overrides
  };
}

describe('validateEnv', () => {
  beforeEach(() => {
    setupBaseEnv();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('passes when required and conditional env vars are present', () => {
    const logger = { info: vi.fn(), warn: vi.fn() };

    const result = validateEnv(logger);

    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith('[config] Environment validation passed.');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns when required variables are missing', () => {
    setupBaseEnv({ DISCORD_BOT_TOKEN: '' });
    const logger = { info: vi.fn(), warn: vi.fn() };

    const result = validateEnv(logger);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Missing required env: DISCORD_BOT_TOKEN');
    expect(logger.warn).toHaveBeenCalledWith(
      '[config] Environment validation warnings (configuration wizard will help):',
      expect.arrayContaining(['Missing required env: DISCORD_BOT_TOKEN'])
    );
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('warns when google AI service is selected without API keys', () => {
    setupBaseEnv({
      AI_SERVICE: 'google',
      GOOGLE_AI_API_KEY: '',
      GOOGLE_API_KEY: ''
    });
    const logger = { info: vi.fn(), warn: vi.fn() };

    const result = validateEnv(logger);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Missing at least one of: GOOGLE_AI_API_KEY, GOOGLE_API_KEY');
    expect(logger.warn).toHaveBeenCalledWith(
      '[config] Environment validation warnings (configuration wizard will help):',
      expect.arrayContaining(['Missing at least one of: GOOGLE_AI_API_KEY, GOOGLE_API_KEY'])
    );
  });
});
