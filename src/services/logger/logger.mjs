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
    this.logger.info(...args);
  }

  warn(...args) {
    this.logger.warn(...args);
  }

  error(...args) {
    this.logger.error(...args);
  }

  debug(...args) {
    this.logger.debug(...args);
  }

  log(...args) {
    this.logger.info(...args);
  }
}
