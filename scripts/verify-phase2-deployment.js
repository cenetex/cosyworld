#!/usr/bin/env node
/**
 * Production deployment verification.
 *
 * Verifies the configured backend and core runtime settings. SQLite is the
 * default self-contained backend; MongoDB is optional when DATA_BACKEND=mongo.
 */

import dotenv from 'dotenv';

import { createDataLayer } from '../src/data/dataLayer.mjs';
import { DatabaseService } from '../src/services/foundation/databaseService.mjs';

dotenv.config();

const REQUIRED_ENV_VARS = [
  'DISCORD_BOT_TOKEN',
  'DISCORD_CLIENT_ID'
];

const AI_ENV_GROUPS = [
  ['OPENROUTER_API_KEY', 'OPENROUTER_API_TOKEN'],
  ['GOOGLE_API_KEY', 'GOOGLE_AI_API_KEY']
];

const RECOMMENDED_VALUES = {
  ENABLE_LLM_TOOL_CALLING: 'true',
  TOOL_USE_META_PROMPTING: 'true',
  MAX_RESPONSES_PER_MESSAGE: '1',
  STICKY_AFFINITY_EXCLUSIVE: 'true',
  TURN_BASED_MODE: 'true',
  TURN_MIN_INTERVAL_SEC: '90',
  TARGET_CADENCE_MIN: '12'
};

class DeploymentVerifier {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.successes = [];
    this.databaseService = null;
  }

  log(type, message) {
    const prefix = { error: 'ERR', warning: 'WARN', success: 'OK', info: 'INFO' }[type] || 'INFO';
    console.log(`[${prefix}] ${message}`);
    if (type === 'error') this.errors.push(message);
    if (type === 'warning') this.warnings.push(message);
    if (type === 'success') this.successes.push(message);
  }

  verifyEnvironmentVariables() {
    this.log('info', 'Checking environment variables');

    for (const name of REQUIRED_ENV_VARS) {
      if (process.env[name]) this.log('success', `${name} is set`);
      else this.log('error', `Missing required env: ${name}`);
    }

    const hasAi = AI_ENV_GROUPS.some(group => group.some(name => process.env[name]));
    if (hasAi) this.log('success', 'At least one AI provider key is set');
    else this.log('error', 'Missing AI provider key: set OpenRouter or Google AI credentials');

    const backend = String(process.env.DATA_BACKEND || process.env.STORAGE_DATA_BACKEND || 'sqlite').toLowerCase();
    if (backend === 'sqlite') {
      this.log('success', `DATA_BACKEND=${backend}`);
      this.log('success', `SQLITE_DB_PATH=${process.env.SQLITE_DB_PATH || (process.env.NODE_ENV === 'production' ? '/data/cosyworld.sqlite' : 'data/cosyworld.sqlite')}`);
    } else if (backend === 'mongo' || backend === 'mongodb') {
      if (process.env.MONGO_URI) this.log('success', 'MONGO_URI is set for Mongo backend');
      else this.log('error', 'DATA_BACKEND=mongo requires MONGO_URI');
    } else {
      this.log('error', `Unsupported DATA_BACKEND=${backend}`);
    }

    this.log('info', 'Checking recommended configuration');
    for (const [name, expected] of Object.entries(RECOMMENDED_VALUES)) {
      const actual = process.env[name];
      if (actual === expected) this.log('success', `${name}=${actual}`);
      else this.log('warning', `${name}=${actual || 'unset'} (recommended ${expected})`);
    }
  }

  async verifyDatabase() {
    this.log('info', 'Checking database backend');

    DatabaseService.instance = null;
    const logger = {
      info: () => {},
      warn: (msg) => this.log('warning', String(msg)),
      error: (msg) => this.log('error', String(msg)),
      debug: () => {}
    };
    this.databaseService = new DatabaseService({ logger, configService: {} });
    const db = await this.databaseService.connect();
    if (!db) {
      this.log('error', 'Database connection failed');
      return null;
    }

    this.log('success', `Connected to ${this.databaseService.backend} backend`);

    const dataLayer = createDataLayer({ logger, databaseService: this.databaseService });
    await dataLayer.initialize();
    const setup = await dataLayer.config.getSetupStatus();
    this.log('success', `V2 config store initialized (setupComplete=${setup.setupComplete})`);

    const smoke = db.collection('deployment_verification');
    const marker = `verify-${Date.now()}`;
    await smoke.insertOne({ marker, createdAt: new Date() });
    const found = await smoke.findOne({ marker });
    await smoke.deleteMany({ marker });
    if (found?.marker === marker) this.log('success', 'Document persistence smoke test passed');
    else this.log('error', 'Document persistence smoke test failed');

    return db;
  }

  verifyPhase2Features() {
    this.log('info', 'Checking feature flags');
    const features = [
      ['LLM Tool Calling', process.env.ENABLE_LLM_TOOL_CALLING === 'true', true],
      ['Meta-Prompting', process.env.TOOL_USE_META_PROMPTING === 'true', true],
      ['Single Response Mode', process.env.MAX_RESPONSES_PER_MESSAGE === '1', true],
      ['Sticky Affinity', process.env.STICKY_AFFINITY_EXCLUSIVE === 'true', false],
      ['Turn-Based Mode', process.env.TURN_BASED_MODE === 'true', false]
    ];

    for (const [name, enabled, critical] of features) {
      if (enabled) this.log('success', `${name}: enabled`);
      else this.log(critical ? 'error' : 'warning', `${name}: disabled`);
    }
  }

  verifyToolConfiguration() {
    this.log('info', `Tool decision model: ${process.env.TOOL_DECISION_MODEL || 'default'}`);
    this.log('info', `Tool max iterations: ${process.env.TOOL_MAX_ITERATIONS || '3'}`);
  }

  report() {
    console.log('\nDEPLOYMENT VERIFICATION REPORT');
    console.log('='.repeat(38));
    console.log(`Successes: ${this.successes.length}`);
    console.log(`Warnings:  ${this.warnings.length}`);
    console.log(`Errors:    ${this.errors.length}`);

    if (this.errors.length) {
      console.log('\nCritical issues:');
      this.errors.forEach(error => console.log(`- ${error}`));
      return false;
    }

    if (this.warnings.length) {
      console.log('\nWarnings:');
      this.warnings.forEach(warning => console.log(`- ${warning}`));
    }

    console.log('\nDeployment verification passed');
    return true;
  }

  async run() {
    try {
      this.verifyEnvironmentVariables();
      await this.verifyDatabase();
      this.verifyPhase2Features();
      this.verifyToolConfiguration();
      return this.report() ? 0 : 1;
    } finally {
      await this.databaseService?.close?.();
    }
  }
}

new DeploymentVerifier().run()
  .then(code => process.exit(code))
  .catch((error) => {
    console.error('Verification failed:', error?.stack || error?.message || error);
    process.exit(1);
  });
