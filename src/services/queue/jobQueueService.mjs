/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Job Queue Service
 * 
 * Simple in-memory job queue for handling long-running tasks asynchronously.
 * Can be extended to use Redis/BullMQ for production distributed workloads.
 * 
 * Features:
 * - Priority-based job scheduling
 * - Retry with exponential backoff
 * - Job status tracking
 * - Concurrency control
 * - Job expiration/cleanup
 * 
 * @module services/queue/jobQueueService
 */

/**
 * Job states
 */
export const JobState = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

/**
 * Job priorities
 */
export const JobPriority = {
  LOW: 0,
  NORMAL: 5,
  HIGH: 10,
  CRITICAL: 20
};

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  concurrency: 3,                    // Max concurrent jobs
  retryAttempts: 3,                  // Max retry attempts
  retryDelayMs: 1000,                // Initial retry delay
  retryBackoffFactor: 2,             // Exponential backoff factor
  jobTimeoutMs: 300000,              // 5 minute job timeout
  cleanupIntervalMs: 60000,          // Cleanup every minute
  jobRetentionMs: 3600000,           // Keep completed jobs for 1 hour
  maxQueueSize: 1000                 // Max pending jobs
};

/**
 * JobQueueService - Async job processing
 */
export class JobQueueService {
  /**
   * @param {Object} deps - Service dependencies
   * @param {Object} deps.logger - Logger instance
   * @param {Object} deps.databaseService - Database service (optional, for persistence)
   */
  constructor({ logger, databaseService }) {
    this.logger = logger;
    this.databaseService = databaseService;
    
    this.config = { ...DEFAULT_CONFIG };
    
    // Job storage
    this._jobs = new Map();           // jobId -> job
    this._queue = [];                 // Pending job IDs (priority sorted)
    this._processing = new Set();     // Currently processing job IDs
    
    // Job handlers by type
    this._handlers = new Map();       // jobType -> handler function
    
    // Event listeners
    this._listeners = new Map();      // event -> Set<callback>
    
    // Processing state
    this._isProcessing = false;
    this._cleanupInterval = null;
    
    this.logger?.info?.('[JobQueueService] Initialized');
  }

  /**
   * Start the queue processor
   */
  start() {
    if (this._isProcessing) return;
    
    this._isProcessing = true;
    this._processQueue();
    
    // Start cleanup interval
    this._cleanupInterval = setInterval(() => {
      this._cleanup();
    }, this.config.cleanupIntervalMs);
    
    this.logger?.info?.('[JobQueueService] Started');
  }

  /**
   * Stop the queue processor
   */
  stop() {
    this._isProcessing = false;
    
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
    
    this.logger?.info?.('[JobQueueService] Stopped');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // JOB MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Add a job to the queue
   * @param {string} type - Job type (must have registered handler)
   * @param {Object} data - Job data
   * @param {Object} [options] - Job options
   * @param {number} [options.priority] - Job priority (higher = sooner)
   * @param {number} [options.delay] - Delay before processing (ms)
   * @param {number} [options.timeout] - Custom timeout (ms)
   * @param {Object} [options.metadata] - Additional metadata
   * @returns {string} - Job ID
   */
  async addJob(type, data, options = {}) {
    if (!this._handlers.has(type)) {
      throw new Error(`No handler registered for job type: ${type}`);
    }
    
    if (this._queue.length >= this.config.maxQueueSize) {
      throw new Error('Queue is full');
    }
    
    const jobId = this._generateJobId();
    const now = Date.now();
    
    const job = {
      id: jobId,
      type,
      data,
      priority: options.priority ?? JobPriority.NORMAL,
      state: JobState.PENDING,
      attempts: 0,
      maxAttempts: options.maxAttempts ?? this.config.retryAttempts,
      timeout: options.timeout ?? this.config.jobTimeoutMs,
      metadata: options.metadata || {},
      createdAt: now,
      scheduledAt: now + (options.delay || 0),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null
    };
    
    this._jobs.set(jobId, job);
    this._insertIntoQueue(jobId, job.priority, job.scheduledAt);
    
    this._emit('job:added', job);
    this.logger?.debug?.(`[JobQueueService] Job added: ${jobId} (${type})`);
    
    // Trigger processing
    if (this._isProcessing) {
      setImmediate(() => this._processQueue());
    }
    
    return jobId;
  }

  /**
   * Get job status
   * @param {string} jobId - Job ID
   * @returns {Object|null} - Job or null if not found
   */
  getJob(jobId) {
    return this._jobs.get(jobId) || null;
  }

  /**
   * Cancel a pending job
   * @param {string} jobId - Job ID
   * @returns {boolean} - Whether job was cancelled
   */
  cancelJob(jobId) {
    const job = this._jobs.get(jobId);
    if (!job) return false;
    
    if (job.state !== JobState.PENDING) {
      return false; // Can only cancel pending jobs
    }
    
    job.state = JobState.CANCELLED;
    job.completedAt = Date.now();
    
    // Remove from queue
    const idx = this._queue.indexOf(jobId);
    if (idx !== -1) {
      this._queue.splice(idx, 1);
    }
    
    this._emit('job:cancelled', job);
    this.logger?.debug?.(`[JobQueueService] Job cancelled: ${jobId}`);
    
    return true;
  }

  /**
   * Get queue statistics
   * @returns {Object} - Queue stats
   */
  getStats() {
    let pending = 0, processing = 0, completed = 0, failed = 0;
    
    for (const job of this._jobs.values()) {
      switch (job.state) {
        case JobState.PENDING: pending++; break;
        case JobState.PROCESSING: processing++; break;
        case JobState.COMPLETED: completed++; break;
        case JobState.FAILED: failed++; break;
      }
    }
    
    return {
      pending,
      processing,
      completed,
      failed,
      total: this._jobs.size,
      queueLength: this._queue.length,
      handlers: [...this._handlers.keys()]
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HANDLER REGISTRATION
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Register a job handler
   * @param {string} type - Job type
   * @param {Function} handler - Async handler function (receives job data, returns result)
   */
  registerHandler(type, handler) {
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }
    
    this._handlers.set(type, handler);
    this.logger?.debug?.(`[JobQueueService] Handler registered: ${type}`);
  }

  /**
   * Unregister a job handler
   * @param {string} type - Job type
   */
  unregisterHandler(type) {
    this._handlers.delete(type);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // EVENTS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Subscribe to queue events
   * @param {string} event - Event name (job:added, job:started, job:completed, job:failed, job:cancelled)
   * @param {Function} callback - Event callback
   * @returns {Function} - Unsubscribe function
   */
  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);
    
    return () => {
      this._listeners.get(event)?.delete(callback);
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CONVENIENCE METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Add a job and wait for completion
   * @param {string} type - Job type
   * @param {Object} data - Job data
   * @param {Object} [options] - Job options
   * @param {number} [waitTimeout=60000] - Max time to wait (ms)
   * @returns {Promise<Object>} - Job result
   */
  async addJobAndWait(type, data, options = {}, waitTimeout = 60000) {
    const jobId = await this.addJob(type, data, options);
    
    return new Promise((resolve, reject) => {
      const checkInterval = 100;
      const startTime = Date.now();
      
      const check = () => {
        const job = this.getJob(jobId);
        if (!job) {
          reject(new Error('Job not found'));
          return;
        }
        
        if (job.state === JobState.COMPLETED) {
          resolve(job.result);
          return;
        }
        
        if (job.state === JobState.FAILED) {
          reject(new Error(job.error || 'Job failed'));
          return;
        }
        
        if (job.state === JobState.CANCELLED) {
          reject(new Error('Job was cancelled'));
          return;
        }
        
        if (Date.now() - startTime > waitTimeout) {
          reject(new Error('Timeout waiting for job'));
          return;
        }
        
        setTimeout(check, checkInterval);
      };
      
      check();
    });
  }

  /**
   * Add a media generation job
   * @param {Object} params - Job params
   * @returns {string} - Job ID
   */
  async addMediaJob(params) {
    const { type, channelId, prompt, options = {} } = params;
    
    return this.addJob(`media:${type}`, {
      channelId,
      prompt,
      ...options
    }, {
      priority: JobPriority.NORMAL,
      timeout: type === 'video' ? 600000 : 120000, // Videos: 10min, Images: 2min
      metadata: {
        mediaType: type,
        channelId
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Process the job queue
   * @private
   */
  async _processQueue() {
    if (!this._isProcessing) return;
    
    // Check if we can process more jobs
    while (
      this._processing.size < this.config.concurrency &&
      this._queue.length > 0
    ) {
      // Find next ready job
      const now = Date.now();
      let nextJobId = null;
      let nextJobIdx = -1;
      
      for (let i = 0; i < this._queue.length; i++) {
        const jobId = this._queue[i];
        const job = this._jobs.get(jobId);
        
        if (job && job.scheduledAt <= now) {
          nextJobId = jobId;
          nextJobIdx = i;
          break;
        }
      }
      
      if (!nextJobId) break;
      
      // Remove from queue and start processing
      this._queue.splice(nextJobIdx, 1);
      this._processing.add(nextJobId);
      
      // Process job (don't await, let it run async)
      this._processJob(nextJobId).catch(err => {
        this.logger?.error?.(`[JobQueueService] Job processing error:`, err);
      });
    }
    
    // Schedule next check if queue not empty
    if (this._queue.length > 0 && this._isProcessing) {
      setTimeout(() => this._processQueue(), 100);
    }
  }

  /**
   * Process a single job
   * @private
   */
  async _processJob(jobId) {
    const job = this._jobs.get(jobId);
    if (!job) {
      this._processing.delete(jobId);
      return;
    }
    
    const handler = this._handlers.get(job.type);
    if (!handler) {
      job.state = JobState.FAILED;
      job.error = `No handler for job type: ${job.type}`;
      job.completedAt = Date.now();
      this._processing.delete(jobId);
      this._emit('job:failed', job);
      return;
    }
    
    job.state = JobState.PROCESSING;
    job.startedAt = Date.now();
    job.attempts++;
    
    this._emit('job:started', job);
    this.logger?.debug?.(`[JobQueueService] Job started: ${jobId} (attempt ${job.attempts})`);
    
    try {
      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Job timeout')), job.timeout);
      });
      
      // Race handler against timeout
      const result = await Promise.race([
        handler(job.data, job),
        timeoutPromise
      ]);
      
      job.state = JobState.COMPLETED;
      job.result = result;
      job.completedAt = Date.now();
      
      this._emit('job:completed', job);
      this.logger?.debug?.(`[JobQueueService] Job completed: ${jobId}`);
      
    } catch (error) {
      job.error = error.message;
      
      // Check if should retry
      if (job.attempts < job.maxAttempts) {
        // Calculate retry delay with exponential backoff
        const delay = this.config.retryDelayMs * Math.pow(this.config.retryBackoffFactor, job.attempts - 1);
        job.state = JobState.PENDING;
        job.scheduledAt = Date.now() + delay;
        
        this._insertIntoQueue(jobId, job.priority, job.scheduledAt);
        this.logger?.debug?.(`[JobQueueService] Job ${jobId} scheduled for retry in ${delay}ms`);
        
        this._emit('job:retry', job);
      } else {
        job.state = JobState.FAILED;
        job.completedAt = Date.now();
        
        this._emit('job:failed', job);
        this.logger?.warn?.(`[JobQueueService] Job failed: ${jobId} - ${error.message}`);
      }
    } finally {
      this._processing.delete(jobId);
      
      // Trigger next job processing
      if (this._isProcessing) {
        setImmediate(() => this._processQueue());
      }
    }
  }

  /**
   * Insert job into queue maintaining priority order
   * @private
   */
  _insertIntoQueue(jobId, priority, scheduledAt) {
    // Find insertion point (higher priority = earlier in queue)
    let insertIdx = this._queue.length;
    for (let i = 0; i < this._queue.length; i++) {
      const otherJob = this._jobs.get(this._queue[i]);
      if (!otherJob) continue;
      
      // Sort by: priority (desc), then scheduledAt (asc)
      if (priority > otherJob.priority ||
          (priority === otherJob.priority && scheduledAt < otherJob.scheduledAt)) {
        insertIdx = i;
        break;
      }
    }
    
    this._queue.splice(insertIdx, 0, jobId);
  }

  /**
   * Cleanup old completed/failed jobs
   * @private
   */
  _cleanup() {
    const now = Date.now();
    const retentionMs = this.config.jobRetentionMs;
    
    for (const [jobId, job] of this._jobs.entries()) {
      if (
        (job.state === JobState.COMPLETED || job.state === JobState.FAILED || job.state === JobState.CANCELLED) &&
        job.completedAt &&
        now - job.completedAt > retentionMs
      ) {
        this._jobs.delete(jobId);
      }
    }
  }

  /**
   * Generate unique job ID
   * @private
   */
  _generateJobId() {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Emit an event
   * @private
   */
  _emit(event, data) {
    const listeners = this._listeners.get(event);
    if (listeners) {
      for (const callback of listeners) {
        try {
          callback(data);
        } catch (err) {
          this.logger?.error?.(`[JobQueueService] Event listener error:`, err);
        }
      }
    }
  }
}

export default JobQueueService;
