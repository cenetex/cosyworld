/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file vitest.config.js
 * @description Vitest test configuration for CosyWorld
 */

import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',
    
    // Global test setup
    globals: true,
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        'public/',
        'docs/',
        'infra/',
        'scripts/',
        '**/*.config.{js,mjs}',
        '**/test/**',
        '**/__tests__/**',
        '**/*.test.{js,mjs}',
        '**/*.spec.{js,mjs}',
      ],
      include: ['src/**/*.mjs'],
      all: true,
      lines: 10,
      functions: 10,
      branches: 10,
      statements: 10,
    },
    
    // Test file patterns
    include: [
      'test/**/*.test.{js,mjs}',
      'src/**/*.test.{js,mjs}',
    ],
    
    // Test timeout (10 seconds)
    testTimeout: 10000,
    
    // Hook timeout
    hookTimeout: 10000,
    
    // Mocking
    mockReset: true,
    restoreMocks: true,
    clearMocks: true,
    
    // Parallel execution
    threads: true,
    
    // Retry failed tests once
    retry: 1,
    
    // Setup files
    setupFiles: ['./test/setup.mjs'],
  },
  
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@test': path.resolve(__dirname, './test'),
    },
  },
});
