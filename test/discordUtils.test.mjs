import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDiscordServiceEnabled, shouldRegisterDiscordRoutes } from '../src/utils/discordUtils.mjs';

test('isDiscordServiceEnabled uses service isEnabled signal', () => {
  const env = {};
  const service = { isEnabled: () => true };
  assert.equal(isDiscordServiceEnabled(service, env), true);
});

test('isDiscordServiceEnabled falls back to enabled property', () => {
  const env = {};
  const service = { enabled: false };
  assert.equal(isDiscordServiceEnabled(service, env), false);
});

test('isDiscordServiceEnabled uses env fallback when no service provided', () => {
  const env = { DISCORD_BOT_TOKEN: 'abc' };
  assert.equal(isDiscordServiceEnabled(undefined, env), true);
});

test('isDiscordServiceEnabled tolerates throwing isEnabled and uses availability flag', () => {
  const env = {};
  const service = {
    isEnabled() {
      throw new Error('boom');
    },
    available: true
  };
  assert.equal(isDiscordServiceEnabled(service, env), true);
});

test('shouldRegisterDiscordRoutes proxies isDiscordServiceEnabled', () => {
  const env = {};
  const services = { discordService: { enabled: true } };
  assert.equal(shouldRegisterDiscordRoutes(services, env), true);
});
