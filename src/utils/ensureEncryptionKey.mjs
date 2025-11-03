/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Ensures that an ENCRYPTION_KEY exists in the environment.
 * If not present, generates a secure key and saves it to .env file.
 * This allows the app to start even without pre-configuration.
 * 
 * @returns {string} The encryption key (existing or newly generated)
 */
export function ensureEncryptionKey() {
  // Check if key already exists
  let key = process.env.ENCRYPTION_KEY || process.env.APP_SECRET;
  
  if (key && key.length >= 32) {
    return key;
  }

  // Generate a secure 32-byte (64 hex character) key
  key = crypto.randomBytes(32).toString('hex');
  
  console.log('⚠️  No ENCRYPTION_KEY found - generating a secure key...');
  console.log('🔐 Generated ENCRYPTION_KEY (save this!):', key);
  
  // Try to save to .env file
  try {
    const projectRoot = path.resolve(__dirname, '../..');
    const envPath = path.join(projectRoot, '.env');
    
    let envContent = '';
    
    // Read existing .env if it exists
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
      
      // Check if ENCRYPTION_KEY or APP_SECRET is already in the file
      if (envContent.includes('ENCRYPTION_KEY=') || envContent.includes('APP_SECRET=')) {
        // Update existing entry
        envContent = envContent.replace(
          /^(ENCRYPTION_KEY|APP_SECRET)=.*$/m,
          `ENCRYPTION_KEY="${key}"`
        );
      } else {
        // Append new entry
        if (!envContent.endsWith('\n')) envContent += '\n';
        envContent += `\n# Auto-generated encryption key\nENCRYPTION_KEY="${key}"\n`;
      }
    } else {
      // Create new .env file
      envContent = `# CosyWorld Configuration
# Auto-generated on first run

ENCRYPTION_KEY="${key}"
NODE_ENV="development"

# Configure the rest via the setup wizard at http://localhost:3100
`;
    }
    
    fs.writeFileSync(envPath, envContent, 'utf8');
    console.log('✅ ENCRYPTION_KEY saved to .env file');
    console.log('📝 Please complete setup via the configuration wizard');
    
  } catch (error) {
    console.error('❌ Failed to save ENCRYPTION_KEY to .env:', error.message);
    console.error('⚠️  Please manually add this to your .env file:');
    console.error(`   ENCRYPTION_KEY="${key}"`);
  }
  
  // Set in current process environment so the app can continue
  process.env.ENCRYPTION_KEY = key;
  
  return key;
}

/**
 * Generate a secure random encryption key
 * @returns {string} 64-character hex string (32 bytes)
 */
export function generateEncryptionKey() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Validate an encryption key
 * @param {string} key - The key to validate
 * @returns {boolean} True if key is strong enough
 */
export function isStrongEncryptionKey(key) {
  return key && typeof key === 'string' && key.length >= 32;
}
