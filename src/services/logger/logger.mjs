/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

// services/logger.mjs
import winston from 'winston';

const { combine, timestamp, printf, json, colorize } = winston.format;

const consoleFormat = printf(({ level, message, timestamp }) => {
  return `[${timestamp}] ${level}: ${message}`;
});

/**
 * Sanitize an object for logging by truncating large data like base64 images.
 * Recursively processes objects and arrays to redact sensitive/large data.
 * 
 * @param {any} obj - Object to sanitize
 * @param {number} [maxStringLen=200] - Maximum length for string values
 * @returns {any} - Sanitized copy of the object safe for logging
 */
function sanitizeForLogging(obj, maxStringLen = 200) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    // Truncate long strings (like base64 data)
    if (obj.length > maxStringLen) {
      // Check if it looks like base64 data
      if (/^[A-Za-z0-9+/=]{100,}$/.test(obj.slice(0, 100))) {
        return `[base64 data, ${obj.length} chars]`;
      }
      // Check if it's a data URI (e.g., data:image/png;base64,...)
      if (obj.startsWith('data:')) {
        const match = obj.match(/^data:([^;,]+)/);
        return `[data URI: ${match?.[1] || 'unknown'}, ${obj.length} chars]`;
      }
      return obj.slice(0, maxStringLen) + `... [truncated, ${obj.length} total chars]`;
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeForLogging(item, maxStringLen));
  }
  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = sanitizeForLogging(value, maxStringLen);
    }
    return result;
  }
  return obj;
}

/**
 * Get default log level from environment or use 'info'
 * LOG_LEVEL can be: debug, info, warn, error
 */
function getDefaultLevel() {
  const level = (process.env.LOG_LEVEL || 'info').toLowerCase();
  if (['debug', 'info', 'warn', 'error'].includes(level)) {
    return level;
  }
  return 'info';
}

export class Logger {
  constructor(options = {}) {
    this._context = new Map(); // thread-local-ish simple map; keyed by async operation id if expanded later
    const logLevel = options.level || getDefaultLevel();
    
    this.logger = winston.createLogger({
      level: logLevel,
      format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        json()
      ),
      transports: [
        new winston.transports.Console({ format: combine(colorize(), consoleFormat) }),
        new winston.transports.File({ filename: 'app.log' }),
      ],
    });
  }

  /**
   * Set log level at runtime
   * @param {string} level - One of: debug, info, warn, error
   */
  setLevel(level) {
    if (['debug', 'info', 'warn', 'error'].includes(level)) {
      this.logger.level = level;
    }
  }

  /**
   * Get current log level
   * @returns {string}
   */
  getLevel() {
    return this.logger.level;
  }

  withCorrelation(corrId, fn) {
    const prev = this._context.get('corrId');
    this._context.set('corrId', corrId);
    try { return fn(); } finally {
      if (prev) this._context.set('corrId', prev); else this._context.delete('corrId');
    }
  }

  _injectContext(args) {
    const corrId = this._context.get('corrId');
    if (!corrId) return args;
    return [ `[corrId=${corrId}]`, ...args ];
  }

  info(...args) {
    const formatted = args.map(a => {
      if (typeof a === 'string') return sanitizeForLogging(a);
      if (a instanceof Error) return `${a.message}\n${a.stack}`;
      try { return JSON.stringify(sanitizeForLogging(a), null, 2); } catch { return String(a); }
    });
  this.logger.info(this._injectContext(formatted).join(' '));
  }

  warn(...args) {
    const formatted = args.map(a => {
      if (typeof a === 'string') return sanitizeForLogging(a);
      if (a instanceof Error) return `${a.message}\n${a.stack}`;
      try { return JSON.stringify(sanitizeForLogging(a), null, 2); } catch { return String(a); }
    });
  this.logger.warn(this._injectContext(formatted).join(' '));
  }

  error(...args) {
    const formatted = args.map(a => {
      if (typeof a === 'string') return sanitizeForLogging(a);
      if (a instanceof Error) return `${a.message}\n${a.stack}`;
      try { return JSON.stringify(sanitizeForLogging(a), null, 2); } catch { return String(a); }
    });
  this.logger.error(this._injectContext(formatted).join(' '));
  }

  debug(...args) {
    const formatted = args.map(a => {
      if (typeof a === 'string') return sanitizeForLogging(a);
      if (a instanceof Error) return `${a.message}\n${a.stack}`;
      try { return JSON.stringify(sanitizeForLogging(a), null, 2); } catch { return String(a); }
    });
  this.logger.debug(this._injectContext(formatted).join(' '));
  }

  log(...args) {
    this.info(...args);
  }
}
