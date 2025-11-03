/**
 * @fileoverview Tests for SecretsService encryption and key rotation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SecretsService } from '@/services/security/secretsService.mjs';

describe('SecretsService', () => {
  describe('Constructor - Encryption Key Validation', () => {
    const originalEnv = process.env.NODE_ENV;

    beforeEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('should accept strong encryption keys in production (32+ bytes)', () => {
      process.env.NODE_ENV = 'production';
      process.env.ENCRYPTION_KEY = 'a'.repeat(32); // 32 byte key

      expect(() => {
        new SecretsService();
      }).not.toThrow();
    });

    it('should reject weak encryption keys in production (<32 bytes)', () => {
      process.env.NODE_ENV = 'production';
      process.env.ENCRYPTION_KEY = 'short'; // Only 5 bytes

      expect(() => {
        new SecretsService();
      }).toThrow('ENCRYPTION_KEY too weak for production use');
    });

    it('should reject missing encryption keys in production', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ENCRYPTION_KEY;
      delete process.env.APP_SECRET;

      expect(() => {
        new SecretsService();
      }).toThrow('ENCRYPTION_KEY too weak for production use');
    });

    it('should allow weak keys in development', () => {
      process.env.NODE_ENV = 'development';
      process.env.ENCRYPTION_KEY = 'dev';

      expect(() => {
        new SecretsService();
      }).not.toThrow();
    });

    it('should log warning for weak dev keys', () => {
      process.env.NODE_ENV = 'development';
      process.env.ENCRYPTION_KEY = 'dev';
      const mockLogger = { warn: vi.fn(), info: vi.fn() };

      new SecretsService({ logger: mockLogger });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Weak or missing ENCRYPTION_KEY')
      );
    });
  });

  describe('Encryption and Decryption', () => {
    let service;

    beforeEach(() => {
      process.env.NODE_ENV = 'test';
      process.env.ENCRYPTION_KEY = 'test-key-32-bytes-long-enough!!';
      service = new SecretsService();
    });

    it('should encrypt and decrypt strings', () => {
      const plaintext = 'my-secret-token';
      const encrypted = service.encrypt(plaintext);
      
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted).toMatch(/^[A-Za-z0-9+/=]+$/); // Base64
      
      const decrypted = service.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should encrypt and decrypt objects', () => {
      const obj = { apiKey: 'secret123', userId: 456 };
      const encrypted = service.encrypt(obj);
      const decrypted = service.decrypt(encrypted);
      
      expect(decrypted).toEqual(obj);
    });

    it('should produce different ciphertexts for same plaintext (IV)', () => {
      const plaintext = 'same-secret';
      const encrypted1 = service.encrypt(plaintext);
      const encrypted2 = service.encrypt(plaintext);
      
      expect(encrypted1).not.toBe(encrypted2);
      expect(service.decrypt(encrypted1)).toBe(plaintext);
      expect(service.decrypt(encrypted2)).toBe(plaintext);
    });

    it('should handle empty strings', () => {
      const encrypted = service.encrypt('');
      const decrypted = service.decrypt(encrypted);
      expect(decrypted).toBe('');
    });
  });

  describe('Get and Set', () => {
    let service;

    beforeEach(() => {
      process.env.NODE_ENV = 'test';
      process.env.ENCRYPTION_KEY = 'test-key-32-bytes-long-enough!!';
      service = new SecretsService();
    });

    it('should store and retrieve secrets', () => {
      service.set('API_KEY', 'secret123');
      expect(service.get('API_KEY')).toBe('secret123');
    });

    it('should return undefined for non-existent keys', () => {
      expect(service.get('NONEXISTENT')).toBeUndefined();
    });

    it('should support guild-scoped secrets', async () => {
      service.set('API_KEY', 'global-value');
      service.set('API_KEY', 'guild-value', { guildId: 'guild-123' });
      
      expect(service.get('API_KEY')).toBe('global-value');
      expect(await service.getAsync('API_KEY', { guildId: 'guild-123' })).toBe('guild-value');
    });

    it('should delete secrets', () => {
      service.set('TEMP', 'value');
      expect(service.get('TEMP')).toBe('value');
      
      service.delete('TEMP');
      expect(service.get('TEMP')).toBeUndefined();
    });
  });

  describe('Key Rotation', () => {
    let service;

    beforeEach(() => {
      process.env.NODE_ENV = 'test';
      process.env.ENCRYPTION_KEY = 'old-key-32-bytes-long-enough!!!';
      service = new SecretsService();
    });

    it('should rotate encryption key successfully', async () => {
      // Store some secrets with old key
      service.set('SECRET_1', 'value1');
      service.set('SECRET_2', { nested: 'value2' });
      service.set('GUILD_SECRET', 'guild-value', { guildId: 'guild-123' });

      const newKey = 'b'.repeat(32); // Exactly 32 bytes
      const stats = await service.rotateKey(newKey);

      expect(stats.success).toBe(true);
      expect(stats.reencrypted).toBe(3);
      expect(stats.errors).toBe(0);

      // Verify secrets are still accessible with new key
      expect(service.get('SECRET_1')).toBe('value1');
      expect(service.get('SECRET_2')).toEqual({ nested: 'value2' });
      expect(await service.getAsync('GUILD_SECRET', { guildId: 'guild-123' })).toBe('guild-value');
    });

    it('should reject weak keys for rotation', async () => {
      await expect(service.rotateKey('weak')).rejects.toThrow(
        'New encryption key must be at least 32 bytes'
      );
    });

    it('should reject missing keys for rotation', async () => {
      await expect(service.rotateKey('')).rejects.toThrow(
        'New encryption key must be at least 32 bytes'
      );
    });

    it('should handle rotation with no secrets', async () => {
      const newKey = 'c'.repeat(32); // Exactly 32 bytes
      const stats = await service.rotateKey(newKey);

      expect(stats.success).toBe(true);
      expect(stats.reencrypted).toBe(0);
      expect(stats.errors).toBe(0);
    });

    it('should log rotation progress', async () => {
      const mockLogger = { 
        info: vi.fn(), 
        error: vi.fn(),
        warn: vi.fn()
      };
      service.logger = mockLogger;

      service.set('SECRET', 'value');
      const newKey = 'd'.repeat(32); // Exactly 32 bytes
      await service.rotateKey(newKey);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Starting key rotation')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Key rotation complete')
      );
    });
  });

  describe('Environment Hydration', () => {
    let service;

    beforeEach(() => {
      process.env.NODE_ENV = 'test';
      process.env.ENCRYPTION_KEY = 'test-key-32-bytes-long-enough!!';
      process.env.TEST_VAR_1 = 'env-value-1';
      process.env.TEST_VAR_2 = 'env-value-2';
      service = new SecretsService();
    });

    it('should hydrate secrets from environment variables', () => {
      const result = service.hydrateFromEnv(['TEST_VAR_1', 'TEST_VAR_2']);
      
      expect(result).toBe(true);
      expect(service.get('TEST_VAR_1')).toBe('env-value-1');
      expect(service.get('TEST_VAR_2')).toBe('env-value-2');
    });

    it('should skip missing environment variables', () => {
      service.hydrateFromEnv(['NONEXISTENT']);
      expect(service.get('NONEXISTENT')).toBeUndefined();
    });
  });
});
