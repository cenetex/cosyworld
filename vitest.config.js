/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { configDefaults, defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { DurationSequencer } from './test/helpers/duration-sequencer.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// These share module state with other files, so each gets fresh modules.
const ISOLATED = [
  'test/card-dialogue-funding.test.mjs',
  'test/card-lane-token.test.mjs',
  'test/card-live-gate.test.mjs',
  'test/card-one-way-pack.test.mjs',
  'test/card-shared-open-retry.test.mjs',
  'test/card-store-fetch.test.mjs',
];

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
    testTimeout: 10000,
    hookTimeout: 10000,
    mockReset: true,
    restoreMocks: true,
    clearMocks: true,
    pool: 'forks',
    poolOptions: { forks: { isolate: false } },
    maxWorkers: '100%',
    minWorkers: 1,
    sequence: { sequencer: DurationSequencer },
    retry: 1,
    setupFiles: ['./test/setup.mjs'],
    projects: [
      {
        extends: true,
        test: {
          name: 'shared',
          include: ['test/**/*.test.{js,mjs}'],
          exclude: [...configDefaults.exclude, ...ISOLATED],
        },
      },
      {
        extends: true,
        test: {
          name: 'isolated',
          include: ISOLATED,
          poolOptions: { forks: { isolate: true } },
        },
      },
    ],
  },

  resolve: {
    alias: {
      '@test': path.resolve(__dirname, './test'),
    },
  },
});
