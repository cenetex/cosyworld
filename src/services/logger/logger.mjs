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

  info(...args) {
    const formatted = args.map(a => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.message}\n${a.stack}`;
      try { return JSON.stringify(a, null, 2); } catch { return String(a); }
    });
    this.logger.info(formatted.join(' '));
  }

  warn(...args) {
    const formatted = args.map(a => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.message}\n${a.stack}`;
      try { return JSON.stringify(a, null, 2); } catch { return String(a); }
    });
    this.logger.warn(formatted.join(' '));
  }

  error(...args) {
    const formatted = args.map(a => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.message}\n${a.stack}`;
      try { return JSON.stringify(a, null, 2); } catch { return String(a); }
    });
    this.logger.error(formatted.join(' '));
  }

  debug(...args) {
    const formatted = args.map(a => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.message}\n${a.stack}`;
      try { return JSON.stringify(a, null, 2); } catch { return String(a); }
    });
    this.logger.debug(formatted.join(' '));
  }

  log(...args) {
    this.info(...args);
  }
}
