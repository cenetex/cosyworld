#!/usr/bin/env node
/**
 * Phase 2 Production Deployment Verification Script
 * 
 * Validates that all Phase 2 components are properly configured
 * and operational before full production deployment.
 * 
 * Run: node scripts/verify-phase2-deployment.js
 */

import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const REQUIRED_ENV_VARS = [
  'MONGO_URI',
  'MONGO_DB_NAME',
  'DISCORD_BOT_TOKEN',
  'OPENROUTER_API_KEY',
  'ENABLE_LLM_TOOL_CALLING',
  'TOOL_USE_META_PROMPTING',
  'MAX_RESPONSES_PER_MESSAGE',
  'STICKY_AFFINITY_EXCLUSIVE',
  'TURN_BASED_MODE'
];

const RECOMMENDED_VALUES = {
  'ENABLE_LLM_TOOL_CALLING': 'true',
  'TOOL_USE_META_PROMPTING': 'true',
  'MAX_RESPONSES_PER_MESSAGE': '1',
  'STICKY_AFFINITY_EXCLUSIVE': 'true',
  'TURN_BASED_MODE': 'true',
  'TURN_MIN_INTERVAL_SEC': '90',
  'TARGET_CADENCE_MIN': '12'
};

const REQUIRED_INDEXES = {
  'presence': [
    'channelId_avatarId_unique',
    'channelId_state',
    'channelId_lastTurnAt',
    'channelId_summonTurns'
  ],
  'conversation_sessions': [
    'channelId_userId_unique',
    'lastInteractionAt_ttl'
  ],
  'response_locks': [
    'expiresAt_ttl',
    'channelId_avatarId'
  ]
};

class DeploymentVerifier {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.info = [];
    this.client = null;
  }

  log(type, message) {
    const timestamp = new Date().toISOString();
    const prefix = {
      error: '❌',
      warning: '⚠️',
      success: '✅',
      info: 'ℹ️'
    }[type] || '•';
    
    console.log(`${prefix} [${timestamp}] ${message}`);
    
    if (type === 'error') this.errors.push(message);
    if (type === 'warning') this.warnings.push(message);
    if (type === 'info') this.info.push(message);
  }

  async verifyEnvironmentVariables() {
    this.log('info', 'Checking environment variables...\n');
    
    // Check required variables exist
    for (const varName of REQUIRED_ENV_VARS) {
      const value = process.env[varName];
      if (!value || value === '') {
        this.log('error', `Required environment variable missing: ${varName}`);
      } else {
        this.log('success', `${varName} is set`);
      }
    }
    
    // Check recommended values
    console.log('');
    this.log('info', 'Checking recommended configuration...\n');
    for (const [varName, expectedValue] of Object.entries(RECOMMENDED_VALUES)) {
      const actualValue = process.env[varName];
      if (actualValue !== expectedValue) {
        this.log('warning', `${varName}=${actualValue || 'unset'} (recommended: ${expectedValue})`);
      } else {
        this.log('success', `${varName}=${actualValue}`);
      }
    }
  }

  async verifyDatabaseConnection() {
    console.log('');
    this.log('info', 'Testing database connection...\n');
    
    const mongoUri = process.env.MONGO_URI;
    const dbName = process.env.MONGO_DB_NAME;
    
    try {
      this.client = new MongoClient(mongoUri);
      await this.client.connect();
      this.log('success', `Connected to MongoDB: ${dbName}`);
      
      const db = this.client.db(dbName);
      await db.command({ ping: 1 });
      this.log('success', 'Database ping successful');
      
      return db;
    } catch (error) {
      this.log('error', `Database connection failed: ${error.message}`);
      return null;
    }
  }

  async verifyDatabaseIndexes(db) {
    if (!db) {
      this.log('error', 'Cannot verify indexes: no database connection');
      return;
    }
    
    console.log('');
    this.log('info', 'Verifying database indexes...\n');
    
    for (const [collectionName, expectedIndexNames] of Object.entries(REQUIRED_INDEXES)) {
      try {
        const collection = db.collection(collectionName);
        const indexes = await collection.indexes();
        const indexNames = indexes.map(idx => idx.name);
        
        this.log('info', `Checking ${collectionName} collection (${indexes.length} indexes):`);
        
        for (const expectedName of expectedIndexNames) {
          if (indexNames.includes(expectedName)) {
            this.log('success', `  ✓ ${expectedName}`);
          } else {
            this.log('error', `  ✗ Missing index: ${expectedName}`);
          }
        }
        
        console.log('');
      } catch (error) {
        this.log('error', `Failed to check ${collectionName} indexes: ${error.message}`);
      }
    }
  }

  async verifyCollectionsExist(db) {
    if (!db) return;
    
    this.log('info', 'Verifying required collections...\n');
    
    const requiredCollections = [
      'presence',
      'conversation_sessions',
      'response_locks',
      'avatars',
      'messages'
    ];
    
    try {
      const collections = await db.listCollections().toArray();
      const collectionNames = collections.map(c => c.name);
      
      for (const name of requiredCollections) {
        if (collectionNames.includes(name)) {
          this.log('success', `Collection exists: ${name}`);
        } else {
          this.log('warning', `Collection not found: ${name} (will be created on first use)`);
        }
      }
    } catch (error) {
      this.log('error', `Failed to list collections: ${error.message}`);
    }
  }

  async verifyPhase2Features() {
    console.log('');
    this.log('info', 'Verifying Phase 2 feature flags...\n');
    
    const features = [
      {
        name: 'LLM Tool Calling',
        enabled: process.env.ENABLE_LLM_TOOL_CALLING === 'true',
        critical: true
      },
      {
        name: 'Meta-Prompting (Universal Tools)',
        enabled: process.env.TOOL_USE_META_PROMPTING === 'true',
        critical: true
      },
      {
        name: 'Single Response Mode',
        enabled: process.env.MAX_RESPONSES_PER_MESSAGE === '1',
        critical: true
      },
      {
        name: 'Sticky Affinity',
        enabled: process.env.STICKY_AFFINITY_EXCLUSIVE === 'true',
        critical: false
      },
      {
        name: 'Turn-Based Mode',
        enabled: process.env.TURN_BASED_MODE === 'true',
        critical: false
      },
      {
        name: 'Memory V2',
        enabled: process.env.MEMORY_RECALL_ENABLED === 'true',
        critical: false
      }
    ];
    
    for (const feature of features) {
      if (feature.enabled) {
        this.log('success', `${feature.name}: ENABLED`);
      } else {
        const level = feature.critical ? 'error' : 'warning';
        this.log(level, `${feature.name}: DISABLED${feature.critical ? ' (CRITICAL)' : ''}`);
      }
    }
  }

  async verifyToolConfiguration() {
    console.log('');
    this.log('info', 'Verifying tool system configuration...\n');
    
    const toolModel = process.env.TOOL_DECISION_MODEL || 'anthropic/claude-haiku-4.5';
    this.log('info', `Tool decision model: ${toolModel}`);
    
    const maxIterations = process.env.TOOL_MAX_ITERATIONS || '3';
    this.log('info', `Max tool iterations: ${maxIterations}`);
    
    const chainingEnabled = process.env.TOOL_ENABLE_CHAINING !== 'false';
    this.log('info', `Tool chaining: ${chainingEnabled ? 'ENABLED' : 'DISABLED'}`);
  }

  async generateReport() {
    console.log('\n' + '='.repeat(70));
    console.log('DEPLOYMENT VERIFICATION REPORT');
    console.log('='.repeat(70) + '\n');
    
    console.log(`✅ Successes: ${this.info.filter(m => m.includes('✅')).length}`);
    console.log(`⚠️  Warnings:  ${this.warnings.length}`);
    console.log(`❌ Errors:    ${this.errors.length}\n`);
    
    if (this.errors.length > 0) {
      console.log('CRITICAL ISSUES (must fix before deployment):');
      this.errors.forEach(err => console.log(`  - ${err}`));
      console.log('');
    }
    
    if (this.warnings.length > 0) {
      console.log('WARNINGS (recommended to fix):');
      this.warnings.forEach(warn => console.log(`  - ${warn}`));
      console.log('');
    }
    
    if (this.errors.length === 0) {
      console.log('✅ DEPLOYMENT VERIFICATION PASSED');
      console.log('   Phase 2 is ready for production deployment!\n');
      return true;
    } else {
      console.log('❌ DEPLOYMENT VERIFICATION FAILED');
      console.log(`   Fix ${this.errors.length} critical issue(s) before deploying.\n`);
      return false;
    }
  }

  async run() {
    console.log('🚀 Phase 2 Deployment Verification\n');
    console.log('='.repeat(70) + '\n');
    
    try {
      // Run all verification checks
      await this.verifyEnvironmentVariables();
      
      const db = await this.verifyDatabaseConnection();
      if (db) {
        await this.verifyCollectionsExist(db);
        await this.verifyDatabaseIndexes(db);
      }
      
      await this.verifyPhase2Features();
      await this.verifyToolConfiguration();
      
      // Generate final report
      const passed = await this.generateReport();
      
      return passed ? 0 : 1;
      
    } catch (error) {
      console.error('\n❌ Verification script failed:', error);
      return 1;
    } finally {
      if (this.client) {
        await this.client.close();
      }
    }
  }
}

// Run the verifier
const verifier = new DeploymentVerifier();
verifier.run().then(exitCode => {
  process.exit(exitCode);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
