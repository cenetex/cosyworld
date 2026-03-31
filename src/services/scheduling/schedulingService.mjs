/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

// SchedulingService.mjs
export class SchedulingService {
  constructor({
    logger = console,
  }) {
    this.logger = logger;

    this.intervals = [];
    this.timeouts = new Map(); // Track one-shot timeouts by name
    this.logger.info('[SchedulingService] Initialized');
  }

  /**
   * Adds a named periodic task.
   * @param {string} name - Task name for logging.
   * @param {Function} fn - Async function to execute periodically.
   * @param {number} intervalMs - Interval in milliseconds.
   */
  addTask(name, fn, intervalMs) {
    const interval = setInterval(fn, intervalMs);
    this.intervals.push(interval);
    this.logger.info(`[SchedulingService] Task '${name}' added with interval ${intervalMs}ms`);
  }

  /**
   * Schedules a one-shot task to execute after a delay.
   * If a task with the same name is already scheduled, it will be cancelled first.
   * @param {string} name - Task name for logging and deduplication.
   * @param {Function} fn - Async function to execute once.
   * @param {number} delayMs - Delay in milliseconds before execution.
   * @returns {boolean} - True if task was scheduled, false if skipped.
   */
  scheduleOnce(name, fn, delayMs) {
    // Cancel any existing task with the same name
    if (this.timeouts.has(name)) {
      clearTimeout(this.timeouts.get(name));
      this.timeouts.delete(name);
    }

    const timeout = setTimeout(async () => {
      this.timeouts.delete(name);
      try {
        await fn();
      } catch (e) {
        this.logger.warn?.(`[SchedulingService] One-shot task '${name}' failed: ${e.message}`);
      }
    }, delayMs);

    this.timeouts.set(name, timeout);
    this.logger.debug?.(`[SchedulingService] One-shot task '${name}' scheduled in ${delayMs}ms`);
    return true;
  }

  /**
   * Cancel a scheduled one-shot task by name.
   * @param {string} name - Task name to cancel.
   * @returns {boolean} - True if a task was cancelled.
   */
  cancelOnce(name) {
    if (this.timeouts.has(name)) {
      clearTimeout(this.timeouts.get(name));
      this.timeouts.delete(name);
      return true;
    }
    return false;
  }

  /**
   * Check if a one-shot task is currently scheduled.
   * @param {string} name - Task name to check.
   * @returns {boolean}
   */
  hasScheduledOnce(name) {
    return this.timeouts.has(name);
  }

  /** Starts all periodic tasks. */
  start() {
    this.logger.info('[SchedulingService] Starting scheduled tasks');
  }

  /** Stops all periodic tasks. */
  stop() {
    this.intervals.forEach(clearInterval);
    // Also clear one-shot timeouts
    for (const timeout of this.timeouts.values()) {
      clearTimeout(timeout);
    }
    this.timeouts.clear();
    this.logger.info('[SchedulingService] Stopped all scheduled tasks');
  }
}