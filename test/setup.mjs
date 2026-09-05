
import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

process.env.NODE_ENV = 'test';

const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

beforeAll(() => {
  if (!process.env.DEBUG) {
    console.log = () => {};
    console.info = () => {};
    console.warn = () => {};
  }
});

afterAll(() => {
  console.log = originalConsole.log;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
});

beforeEach(() => {
  vi.clearAllTimers();
});

afterEach(() => {
  vi.clearAllMocks();
});
