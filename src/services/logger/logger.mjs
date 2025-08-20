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

export class Logger {
  constructor() {
  this._context = new Map(); // thread-local-ish simple map; keyed by async operation id if expanded later
    this.logger = winston.createLogger({
      level: 'info',
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
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.message}\n${a.stack}`;
      try { return JSON.stringify(a, null, 2); } catch { return String(a); }
    });
  this.logger.info(this._injectContext(formatted).join(' '));
  }

  warn(...args) {
    const formatted = args.map(a => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.message}\n${a.stack}`;
      try { return JSON.stringify(a, null, 2); } catch { return String(a); }
    });
  this.logger.warn(this._injectContext(formatted).join(' '));
  }

  error(...args) {
    const formatted = args.map(a => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.message}\n${a.stack}`;
      try { return JSON.stringify(a, null, 2); } catch { return String(a); }
    });
  this.logger.error(this._injectContext(formatted).join(' '));
  }

  debug(...args) {
    const formatted = args.map(a => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.message}\n${a.stack}`;
      try { return JSON.stringify(a, null, 2); } catch { return String(a); }
    });
  this.logger.debug(this._injectContext(formatted).join(' '));
  }

  log(...args) {
    this.info(...args);
  }
}
