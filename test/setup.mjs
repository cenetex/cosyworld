/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/setup.mjs
 * @description Global test setup for Vitest
 */

import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import dotenv from 'dotenv';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Set test environment
process.env.NODE_ENV = 'test';

// Mock console methods to reduce noise in test output
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

// Global setup before all tests
beforeAll(() => {
  // Suppress console output in tests unless DEBUG is set
  if (!process.env.DEBUG) {
    console.log = () => {};
    console.info = () => {};
    console.warn = () => {};
    // Keep console.error for important errors
  }
});

// Global teardown after all tests
afterAll(() => {
  // Restore console methods
  console.log = originalConsole.log;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
});

// Reset state before each test
beforeEach(() => {
  // Clear all timers
  vi.clearAllTimers();
});

// Cleanup after each test
afterEach(() => {
  // Clear all mocks
  vi.clearAllMocks();
});
