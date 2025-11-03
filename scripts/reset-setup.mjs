#!/usr/bin/env node
/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * Reset Setup Script
 * 
 * Forces the application back to first-run setup state by clearing
 * the setup status from MongoDB. This is useful for:
 * - Testing the first-run setup flow
 * - Reconfiguring the application from scratch
 * - Troubleshooting setup issues
 * 
 * Usage:
 *   npm run reset-setup
 *   node scripts/reset-setup.mjs
 *   node scripts/reset-setup.mjs --confirm
 * 
 * Options:
 *   --confirm        Skip confirmation prompt
 *   --keep-secrets   Keep existing secrets (only reset setup status)
 *   --help           Show this help message
 */

import { MongoClient } from 'mongodb';
import readline from 'readline';
import process from 'process';

// Parse command line arguments
const args = process.argv.slice(2);
const flags = {
  confirm: args.includes('--confirm'),
  keepSecrets: args.includes('--keep-secrets'),
  help: args.includes('--help') || args.includes('-h')
};

// Show help
if (flags.help) {
  console.log(`
🔄 Reset Setup Script

Forces the application back to first-run setup state.

Usage:
  npm run reset-setup
  node scripts/reset-setup.mjs [options]

Options:
  --confirm        Skip confirmation prompt
  --keep-secrets   Keep existing secrets (only reset setup status)
  --help, -h       Show this help message

What this script does:
  1. Clears the setup completion status from MongoDB
  2. Optionally clears all secrets from the database
  3. Keeps your .env file intact (if present)
  4. Forces the application to show the first-run setup wizard

After running this script:
  - Restart your application
  - Navigate to /admin/setup
  - Complete the setup wizard again
`);
  process.exit(0);
}

// Load environment variables
async function loadEnv() {
  try {
    const { config } = await import('dotenv');
    config();
  } catch {
    console.warn('⚠️  dotenv not available, using existing environment variables');
  }
}

// Get MongoDB URI from environment
function getMongoUri() {
  return process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017';
}

function getDbName() {
  return process.env.MONGO_DB_NAME || 'cosyworld8';
}

// Prompt for confirmation
function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

// Main reset function
async function resetSetup() {
  console.log('\n🔄 CosyWorld8 Setup Reset Tool\n');

  await loadEnv();

  const mongoUri = getMongoUri();
  const dbName = getDbName();

  console.log(`📦 Database: ${dbName}`);
  console.log(`🔗 MongoDB: ${mongoUri.replace(/\/\/.*@/, '//***@')}\n`);

  // Confirmation prompt
  if (!flags.confirm) {
    console.log('⚠️  WARNING: This will reset your setup status.\n');
    
    if (!flags.keepSecrets) {
      console.log('   This will also clear all secrets from the database.');
      console.log('   Your .env file will remain intact.\n');
    } else {
      console.log('   Your secrets will be preserved (--keep-secrets flag).\n');
    }

    const confirmed = await confirm('Are you sure you want to continue? (yes/no): ');
    
    if (!confirmed) {
      console.log('\n❌ Reset cancelled.\n');
      process.exit(0);
    }
  }

  console.log('\n🔄 Connecting to MongoDB...');

  let client;
  try {
    client = new MongoClient(mongoUri);
    await client.connect();
    
    const db = client.db(dbName);
    console.log('✅ Connected to database\n');

    // Reset setup status
    console.log('🧹 Clearing setup status...');
    const setupResult = await db.collection('system_setup').deleteMany({});
    console.log(`   Removed ${setupResult.deletedCount} setup record(s)`);

    // Optionally clear secrets
    if (!flags.keepSecrets) {
      console.log('\n🔐 Clearing secrets...');
      const secretsResult = await db.collection('secrets').deleteMany({});
      console.log(`   Removed ${secretsResult.deletedCount} secret(s)`);
    } else {
      console.log('\n🔐 Keeping existing secrets (--keep-secrets flag)');
    }

    console.log('\n✅ Setup reset complete!\n');
    console.log('Next steps:');
    console.log('  1. Restart your application (npm start)');
    console.log('  2. Navigate to /admin/setup in your browser');
    console.log('  3. Complete the first-run setup wizard\n');

    if (flags.keepSecrets) {
      console.log('Note: Secrets were preserved. You may want to review them in the setup wizard.\n');
    }

  } catch (error) {
    console.error('\n❌ Error resetting setup:', error.message);
    console.error('\nTroubleshooting:');
    console.error('  - Check your MONGO_URI environment variable');
    console.error('  - Ensure MongoDB is running and accessible');
    console.error('  - Verify you have write permissions to the database\n');
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log('📤 Disconnected from MongoDB\n');
    }
  }
}

// Run the script
resetSetup().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
