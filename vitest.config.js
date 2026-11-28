/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { DurationSequencer } from './test/helpers/duration-sequencer.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        'docs/',
        'infra/',
        'scripts/',
        '**/*.config.{js,mjs}',
        '**/test/**',
        '**/__tests__/**',
        '**/*.test.{js,mjs}',
        '**/*.spec.{js,mjs}',
      ],
      include: ['v2/scripts/**/*.mjs'],
      all: true,
      lines: 10,
      functions: 10,
      branches: 10,
      statements: 10,
    },
    include: [
      'test/**/*.test.{js,mjs}',
    ],
    testTimeout: 30000,
    hookTimeout: 30000,
    mockReset: true,
    restoreMocks: true,
    clearMocks: true,
    maxWorkers: '75%',
    minWorkers: 1,
    sequence: { sequencer: DurationSequencer },
    setupFiles: ['./test/setup.mjs'],
  },

  resolve: {
    alias: {
      '@test': path.resolve(__dirname, './test'),
    },
  },
});
