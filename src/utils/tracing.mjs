/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Request Tracing Utilities
 * 
 * Provides correlation ID generation and tracing context management
 * for tracking requests through the media generation pipeline.
 * 
 * @module utils/tracing
 */

import { randomBytes } from 'crypto';

/**
 * Generate a unique trace ID for request correlation
 * Format: trc_<timestamp>_<random>
 * @returns {string} Trace ID
 */
export function generateTraceId() {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(6).toString('hex');
  return `trc_${timestamp}_${random}`;
}

/**
 * Generate a span ID for tracking sub-operations within a trace
 * Format: spn_<random>
 * @returns {string} Span ID
 */
export function generateSpanId() {
  return `spn_${randomBytes(4).toString('hex')}`;
}

/**
 * Tracing context for a media generation request
 */
export class TracingContext {
  /**
   * @param {Object} options - Context options
   * @param {string} [options.traceId] - Existing trace ID to continue
   * @param {string} [options.parentSpanId] - Parent span ID for nested operations
   * @param {Object} [options.metadata] - Additional metadata to attach
   */
  constructor(options = {}) {
    this.traceId = options.traceId || generateTraceId();
    this.spanId = generateSpanId();
    this.parentSpanId = options.parentSpanId || null;
    this.startTime = Date.now();
    this.metadata = options.metadata || {};
    this.spans = [];
    this.events = [];
  }

  /**
   * Create a child span for sub-operations
   * @param {string} name - Span name/operation
   * @param {Object} [metadata] - Additional metadata
   * @returns {TracingSpan}
   */
  startSpan(name, metadata = {}) {
    const span = new TracingSpan({
      traceId: this.traceId,
      parentSpanId: this.spanId,
      name,
      metadata
    });
    this.spans.push(span);
    return span;
  }

  /**
   * Record an event in the trace
   * @param {string} name - Event name
   * @param {Object} [data] - Event data
   */
  recordEvent(name, data = {}) {
    this.events.push({
      name,
      timestamp: Date.now(),
      elapsed: Date.now() - this.startTime,
      data
    });
  }

  /**
   * Add metadata to the context
   * @param {string} key - Metadata key
   * @param {*} value - Metadata value
   */
  setMetadata(key, value) {
    this.metadata[key] = value;
  }

  /**
   * Get the total duration of this context
   * @returns {number} Duration in milliseconds
   */
  getDuration() {
    return Date.now() - this.startTime;
  }

  /**
   * Convert to a loggable object
   * @returns {Object}
   */
  toLogObject() {
    return {
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      duration: this.getDuration(),
      metadata: this.metadata,
      eventCount: this.events.length,
      spanCount: this.spans.length
    };
  }

  /**
   * Convert to full trace data for storage/analysis
   * @returns {Object}
   */
  toJSON() {
    return {
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      startTime: this.startTime,
      duration: this.getDuration(),
      metadata: this.metadata,
      events: this.events,
      spans: this.spans.map(s => s.toJSON())
    };
  }
}

/**
 * Individual span within a trace
 */
export class TracingSpan {
  /**
   * @param {Object} options - Span options
   * @param {string} options.traceId - Parent trace ID
   * @param {string} [options.parentSpanId] - Parent span ID
   * @param {string} options.name - Span name
   * @param {Object} [options.metadata] - Additional metadata
   */
  constructor({ traceId, parentSpanId, name, metadata = {} }) {
    this.traceId = traceId;
    this.spanId = generateSpanId();
    this.parentSpanId = parentSpanId || null;
    this.name = name;
    this.startTime = Date.now();
    this.endTime = null;
    this.metadata = metadata;
    this.status = 'in_progress';
    this.error = null;
    this.events = [];
  }

  /**
   * Record an event in this span
   * @param {string} name - Event name
   * @param {Object} [data] - Event data
   */
  recordEvent(name, data = {}) {
    this.events.push({
      name,
      timestamp: Date.now(),
      elapsed: Date.now() - this.startTime,
      data
    });
  }

  /**
   * Add metadata to the span
   * @param {string} key - Metadata key
   * @param {*} value - Metadata value
   */
  setMetadata(key, value) {
    this.metadata[key] = value;
  }

  /**
   * Mark span as successfully completed
   * @param {Object} [result] - Result metadata
   */
  finish(result = {}) {
    this.endTime = Date.now();
    this.status = 'success';
    this.metadata.result = result;
  }

  /**
   * Mark span as failed
   * @param {Error} error - The error that occurred
   */
  fail(error) {
    this.endTime = Date.now();
    this.status = 'error';
    this.error = {
      name: error.name || 'Error',
      message: error.message,
      code: error.code || 'UNKNOWN',
      stack: error.stack
    };
  }

  /**
   * Get the duration of this span
   * @returns {number} Duration in milliseconds
   */
  getDuration() {
    const end = this.endTime || Date.now();
    return end - this.startTime;
  }

  /**
   * Convert to a loggable object
   * @returns {Object}
   */
  toLogObject() {
    return {
      traceId: this.traceId,
      spanId: this.spanId,
      name: this.name,
      status: this.status,
      duration: this.getDuration()
    };
  }

  /**
   * Convert to full span data
   * @returns {Object}
   */
  toJSON() {
    return {
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.getDuration(),
      status: this.status,
      error: this.error,
      metadata: this.metadata,
      events: this.events
    };
  }
}

/**
 * Create a traced wrapper for async functions
 * Automatically creates spans and handles errors
 * 
 * @param {TracingContext} ctx - Tracing context
 * @param {string} name - Span name
 * @param {Function} fn - Async function to wrap
 * @param {Object} [metadata] - Additional metadata
 * @returns {Promise<*>} Result of the function
 */
export async function traced(ctx, name, fn, metadata = {}) {
  const span = ctx.startSpan(name, metadata);
  try {
    const result = await fn(span);
    span.finish({ success: true });
    return result;
  } catch (error) {
    span.fail(error);
    throw error;
  }
}

/**
 * Create a logging helper with tracing context
 * @param {Object} logger - Base logger
 * @param {TracingContext|Object} ctx - Tracing context or object with traceId
 * @returns {Object} Logger with tracing context injected
 */
export function createTracedLogger(logger, ctx) {
  const traceId = ctx?.traceId || ctx;
  const injectContext = (level, ...args) => {
    const message = args[0];
    const data = args[1] || {};
    return logger?.[level]?.(message, { ...data, traceId });
  };

  return {
    info: (...args) => injectContext('info', ...args),
    warn: (...args) => injectContext('warn', ...args),
    error: (...args) => injectContext('error', ...args),
    debug: (...args) => injectContext('debug', ...args),
    trace: (...args) => injectContext('trace', ...args)
  };
}
