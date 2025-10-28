/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file rotate-encryption-key.mjs
 * @description Rotates the encryption key for all secrets
 * 
 * Usage:
 *   1. Generate new key: openssl rand -base64 32
 *   2. Set NEW_ENCRYPTION_KEY environment variable
 *   3. Run: node scripts/rotate-encryption-key.mjs
 *   4. Update ENCRYPTION_KEY in secrets manager
 *   5. Restart all app instances
 */

import { createContainer } from '../src/container.mjs';

async function rotateKey() {
  console.log('🔄 Starting encryption key rotation...\n');

  // Validate new key
  const newKey = process.env.NEW_ENCRYPTION_KEY;
  if (!newKey) {
    console.error('❌ Error: NEW_ENCRYPTION_KEY environment variable not set');
    console.error('   Generate with: openssl rand -base64 32');
    process.exit(1);
  }

  if (newKey.length < 32) {
    console.error(`❌ Error: NEW_ENCRYPTION_KEY must be at least 32 bytes (current: ${newKey.length})`);
    console.error('   Generate with: openssl rand -base64 32');
    process.exit(1);
  }

  console.log('✓ New encryption key validated (32+ bytes)');

  try {
    // Initialize container
    console.log('⚙️  Initializing services...');
    const container = await createContainer();
    const secretsService = container.resolve('secretsService');

    // Perform rotation
    console.log('🔐 Decrypting and re-encrypting all secrets...');
    const stats = await secretsService.rotateKey(newKey);

    if (stats.success) {
      console.log('\n✅ Key rotation complete!');
      console.log(`   Re-encrypted: ${stats.reencrypted} secrets`);
      console.log(`   Errors: ${stats.errors}`);
      
      console.log('\n⚠️  IMPORTANT: Next steps:');
      console.log('   1. Update ENCRYPTION_KEY in your secrets manager with the NEW_ENCRYPTION_KEY value');
      console.log('   2. Restart all app instances to use the new key');
      console.log('   3. Verify all secrets are accessible after restart');
      console.log('   4. Securely delete the old encryption key');
      
      process.exit(0);
    } else {
      console.error('\n❌ Key rotation failed');
      console.error('   The old key has been restored');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Key rotation failed:', error.message);
    console.error('   Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run rotation
rotateKey().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
