/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/setup.mjs
 * @description Global test setup for Vitest
 */

import { beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import dotenv from 'dotenv';
import http from 'node:http';
import { Readable, PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Set test environment
process.env.NODE_ENV = 'test';

class MockReq extends Readable {
  constructor({ method, url, headers, body }) {
    super();
    this.method = method;
    this.url = url;
    this.headers = headers || {};
    this.socket = new PassThrough();
    this.connection = this.socket;
    this._body = body;
    this._readStarted = false;
    this._read = () => {
      if (this._readStarted) return;
      this._readStarted = true;
      if (this._body) {
        this.push(this._body);
      }
      this.push(null);
    };
  }
}

class MockRes extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.bodyChunks = [];
    this.headersSent = false;
    this.finished = false;

    this.setHeader = (name, value) => {
      this.headers[name.toLowerCase()] = value;
    };

    this.getHeader = (name) => this.headers[name.toLowerCase()];

    this.removeHeader = (name) => {
      delete this.headers[name.toLowerCase()];
    };

    this.writeHead = (statusCode, headers) => {
      this.statusCode = statusCode;
      if (headers) {
        for (const [key, value] of Object.entries(headers)) {
          this.setHeader(key, value);
        }
      }
      this.headersSent = true;
    };

    this.write = (chunk, encoding, cb) => {
      if (chunk) {
        this.bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      }
      this.headersSent = true;
      if (cb) cb();
      return true;
    };

    this.end = (chunk, encoding, cb) => {
      if (chunk) {
        this.write(chunk, encoding);
      }
      this.finished = true;
      this.emit('finish');
      if (cb) cb();
      return this;
    };
  }
}

async function handleExpressRequest(app, method, path, body, headers = {}) {
  const headerMap = { ...headers };
  let bodyPayload;

  if (body !== undefined) {
    if (Buffer.isBuffer(body) || typeof body === 'string') {
      bodyPayload = body;
    } else {
      bodyPayload = JSON.stringify(body);
      if (!headerMap['content-type']) {
        headerMap['content-type'] = 'application/json';
      }
    }
    if (!headerMap['content-length']) {
      headerMap['content-length'] = Buffer.byteLength(bodyPayload || '');
    }
  }

  const req = new MockReq({
    method,
    url: path,
    headers: headerMap,
    body: bodyPayload,
  });
  const res = new MockRes();

  return await new Promise((resolve, reject) => {
    const finalize = () => {
      const buffer = Buffer.concat(res.bodyChunks);
      const text = buffer.toString('utf8');
      let parsedBody = text;
      if (text) {
        try {
          parsedBody = JSON.parse(text);
        } catch {}
      }
      resolve({
        status: res.statusCode,
        body: parsedBody,
        text,
        headers: res.headers,
      });
    };

    res.once('finish', finalize);
    res.once('error', reject);

    app.handle(req, res);
  });
}

function createTestRequest(app, method, path) {
  return {
    _body: undefined,
    _headers: {},
    send(body) {
      this._body = body;
      return this;
    },
    set(name, value) {
      this._headers[String(name).toLowerCase()] = value;
      return this;
    },
    then(resolve, reject) {
      return handleExpressRequest(app, method, path, this._body, this._headers)
        .then(resolve, reject);
    },
  };
}

vi.mock('supertest', () => {
  return {
    default: (app) => ({
      get: (path) => createTestRequest(app, 'GET', path),
      post: (path) => createTestRequest(app, 'POST', path),
      put: (path) => createTestRequest(app, 'PUT', path),
      patch: (path) => createTestRequest(app, 'PATCH', path),
      delete: (path) => createTestRequest(app, 'DELETE', path),
    }),
  };
});

const ORIGINAL_SERVER_LISTEN = http.Server.prototype.listen;
const TEST_BIND_HOST = '127.0.0.1';

function normalizeListenArgs(args) {
  if (!args.length) return args;
  const [first, second] = args;

  if (first && typeof first === 'object' && !Array.isArray(first)) {
    const options = { ...first };
    if (!options.host || options.host === '0.0.0.0') {
      options.host = TEST_BIND_HOST;
    }
    args[0] = options;
    return args;
  }

  if (typeof first === 'number') {
    if (typeof second === 'string') {
      if (second === '0.0.0.0') {
        args[1] = TEST_BIND_HOST;
      }
      return args;
    }
    if (typeof second === 'undefined' || typeof second === 'function' || typeof second === 'number') {
      args.splice(1, 0, TEST_BIND_HOST);
    }
  }

  return args;
}

http.Server.prototype.listen = function patchedListen(...args) {
  if (process.env.NODE_ENV === 'test') {
    normalizeListenArgs(args);
  }
  return ORIGINAL_SERVER_LISTEN.apply(this, args);
};

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

  http.Server.prototype.listen = ORIGINAL_SERVER_LISTEN;
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
