/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Metrics Service
 * 
 * Provides observability through metrics collection and structured logging.
 * Supports Prometheus-compatible metrics export.
 * 
 * Features:
 * - Counter, Gauge, Histogram metric types
 * - Prometheus text format export
 * - Structured JSON logging
 * - Request timing helpers
 * - Service health tracking
 * 
 * @module services/observability/metricsService
 */

/**
 * Metric types
 */
const MetricType = {
  COUNTER: 'counter',
  GAUGE: 'gauge',
  HISTOGRAM: 'histogram'
};

/**
 * Default histogram buckets (in milliseconds)
 */
const DEFAULT_BUCKETS = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000];

/**
 * ObservabilityService - Metrics collection and structured logging
 */
export class ObservabilityService {
  /**
   * @param {Object} deps - Service dependencies
   * @param {Object} deps.logger - Logger instance
   * @param {Object} deps.configService - Config service
   */
  constructor({ logger, configService }) {
    this.logger = logger;
    this.configService = configService;
    
    // Metrics storage
    this._counters = new Map();
    this._gauges = new Map();
    this._histograms = new Map();
    
    // Service registry for health checks
    this._services = new Map();
    
    // Startup time
    this._startTime = Date.now();
    
    // Initialize default metrics
    this._initDefaultMetrics();
    
    this.logger?.info?.('[ObservabilityService] Initialized');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // METRIC CREATION
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create or get a counter metric
   * @param {string} name - Metric name
   * @param {string} [help] - Help text
   * @param {string[]} [labelNames] - Label names
   * @returns {Object} - Counter interface
   */
  counter(name, help = '', labelNames = []) {
    const key = name;
    if (!this._counters.has(key)) {
      this._counters.set(key, {
        name,
        help,
        labelNames,
        type: MetricType.COUNTER,
        values: new Map() // labelKey -> value
      });
    }
    
    const metric = this._counters.get(key);
    return {
      inc: (labelsOrValue, value) => this._incCounter(metric, labelsOrValue, value),
      get: (labels) => this._getCounterValue(metric, labels),
      reset: () => metric.values.clear()
    };
  }

  /**
   * Create or get a gauge metric
   * @param {string} name - Metric name
   * @param {string} [help] - Help text
   * @param {string[]} [labelNames] - Label names
   * @returns {Object} - Gauge interface
   */
  gauge(name, help = '', labelNames = []) {
    const key = name;
    if (!this._gauges.has(key)) {
      this._gauges.set(key, {
        name,
        help,
        labelNames,
        type: MetricType.GAUGE,
        values: new Map()
      });
    }
    
    const metric = this._gauges.get(key);
    return {
      set: (labelsOrValue, value) => this._setGauge(metric, labelsOrValue, value),
      inc: (labelsOrValue, value) => this._incGauge(metric, labelsOrValue, value),
      dec: (labelsOrValue, value) => this._decGauge(metric, labelsOrValue, value),
      get: (labels) => this._getGaugeValue(metric, labels),
      reset: () => metric.values.clear()
    };
  }

  /**
   * Create or get a histogram metric
   * @param {string} name - Metric name
   * @param {string} [help] - Help text
   * @param {string[]} [labelNames] - Label names
   * @param {number[]} [buckets] - Bucket boundaries
   * @returns {Object} - Histogram interface
   */
  histogram(name, help = '', labelNames = [], buckets = DEFAULT_BUCKETS) {
    const key = name;
    if (!this._histograms.has(key)) {
      this._histograms.set(key, {
        name,
        help,
        labelNames,
        type: MetricType.HISTOGRAM,
        buckets: [...buckets].sort((a, b) => a - b),
        values: new Map() // labelKey -> { buckets: [], sum: 0, count: 0 }
      });
    }
    
    const metric = this._histograms.get(key);
    return {
      observe: (labelsOrValue, value) => this._observeHistogram(metric, labelsOrValue, value),
      startTimer: (labels) => this._startTimer(metric, labels),
      get: (labels) => this._getHistogramValue(metric, labels),
      reset: () => metric.values.clear()
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CONVENIENCE METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Start a timer and return a function to stop it
   * @param {string} metricName - Histogram metric name
   * @param {Object} [labels] - Labels
   * @returns {Function} - Stop timer function that returns duration
   */
  startTimer(metricName, labels = {}) {
    const start = process.hrtime.bigint();
    const histogram = this.histogram(metricName);
    
    return () => {
      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1_000_000;
      histogram.observe(labels, durationMs);
      return durationMs;
    };
  }

  /**
   * Wrap an async function with timing
   * @param {string} metricName - Histogram metric name
   * @param {Object} labels - Labels
   * @param {Function} fn - Async function to time
   * @returns {Promise<any>} - Result of fn
   */
  async timed(metricName, labels, fn) {
    const stopTimer = this.startTimer(metricName, labels);
    try {
      const result = await fn();
      return result;
    } finally {
      stopTimer();
    }
  }

  /**
   * Track an operation with success/error counting
   * @param {string} operationName - Operation name for metrics
   * @param {Object} labels - Additional labels
   * @param {Function} fn - Async function to execute
   * @returns {Promise<any>}
   */
  async trackOperation(operationName, labels, fn) {
    const counter = this.counter(`${operationName}_total`, `Total ${operationName} operations`, ['status', ...Object.keys(labels)]);
    const histogram = this.histogram(`${operationName}_duration_ms`, `Duration of ${operationName}`, Object.keys(labels));
    
    const stopTimer = histogram.startTimer(labels);
    
    try {
      const result = await fn();
      counter.inc({ ...labels, status: 'success' });
      return result;
    } catch (error) {
      counter.inc({ ...labels, status: 'error' });
      throw error;
    } finally {
      stopTimer();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SERVICE HEALTH
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Register a service for health tracking
   * @param {string} name - Service name
   * @param {Function} [healthCheck] - Optional async health check function
   */
  registerService(name, healthCheck = null) {
    this._services.set(name, {
      name,
      healthCheck,
      status: 'unknown',
      lastCheck: null,
      lastError: null
    });
  }

  /**
   * Update service status
   * @param {string} name - Service name
   * @param {string} status - 'healthy', 'degraded', 'unhealthy', 'unknown'
   * @param {string} [error] - Error message if unhealthy
   */
  setServiceStatus(name, status, error = null) {
    const service = this._services.get(name) || { name };
    service.status = status;
    service.lastCheck = Date.now();
    service.lastError = error;
    this._services.set(name, service);
    
    // Update gauge
    const statusValue = status === 'healthy' ? 1 : status === 'degraded' ? 0.5 : 0;
    this.gauge('service_health', 'Service health status', ['service']).set({ service: name }, statusValue);
  }

  /**
   * Run health checks for all registered services
   * @returns {Promise<Object>} - Health check results
   */
  async checkHealth() {
    const results = {
      status: 'healthy',
      uptime: Date.now() - this._startTime,
      services: {}
    };
    
    for (const [name, service] of this._services.entries()) {
      try {
        if (service.healthCheck) {
          await service.healthCheck();
        }
        this.setServiceStatus(name, 'healthy');
        results.services[name] = { status: 'healthy' };
      } catch (err) {
        this.setServiceStatus(name, 'unhealthy', err.message);
        results.services[name] = { status: 'unhealthy', error: err.message };
        results.status = 'degraded';
      }
    }
    
    return results;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // EXPORT
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Export metrics in Prometheus text format
   * @returns {string}
   */
  toPrometheusText() {
    const lines = [];
    
    // Export counters
    for (const metric of this._counters.values()) {
      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} counter`);
      for (const [labelKey, value] of metric.values.entries()) {
        const labels = labelKey ? `{${labelKey}}` : '';
        lines.push(`${metric.name}${labels} ${value}`);
      }
    }
    
    // Export gauges
    for (const metric of this._gauges.values()) {
      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} gauge`);
      for (const [labelKey, value] of metric.values.entries()) {
        const labels = labelKey ? `{${labelKey}}` : '';
        lines.push(`${metric.name}${labels} ${value}`);
      }
    }
    
    // Export histograms
    for (const metric of this._histograms.values()) {
      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} histogram`);
      for (const [labelKey, data] of metric.values.entries()) {
        const labelPrefix = labelKey ? `${labelKey},` : '';
        
        // Bucket values
        let cumulative = 0;
        for (let i = 0; i < metric.buckets.length; i++) {
          cumulative += data.buckets[i] || 0;
          lines.push(`${metric.name}_bucket{${labelPrefix}le="${metric.buckets[i]}"} ${cumulative}`);
        }
        lines.push(`${metric.name}_bucket{${labelPrefix}le="+Inf"} ${data.count}`);
        lines.push(`${metric.name}_sum{${labelKey || ''}} ${data.sum}`);
        lines.push(`${metric.name}_count{${labelKey || ''}} ${data.count}`);
      }
    }
    
    return lines.join('\n');
  }

  /**
   * Export metrics as JSON
   * @returns {Object}
   */
  toJSON() {
    const result = {
      counters: {},
      gauges: {},
      histograms: {},
      services: {},
      uptime: Date.now() - this._startTime
    };
    
    for (const [name, metric] of this._counters.entries()) {
      result.counters[name] = Object.fromEntries(metric.values);
    }
    
    for (const [name, metric] of this._gauges.entries()) {
      result.gauges[name] = Object.fromEntries(metric.values);
    }
    
    for (const [name, metric] of this._histograms.entries()) {
      result.histograms[name] = Object.fromEntries(metric.values);
    }
    
    for (const [name, service] of this._services.entries()) {
      result.services[name] = {
        status: service.status,
        lastCheck: service.lastCheck,
        lastError: service.lastError
      };
    }
    
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STRUCTURED LOGGING
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Log a structured event
   * @param {string} event - Event name
   * @param {Object} data - Event data
   * @param {string} [level='info'] - Log level
   */
  logEvent(event, data = {}, level = 'info') {
    const logData = {
      event,
      timestamp: new Date().toISOString(),
      ...data
    };
    
    if (this.logger?.[level]) {
      this.logger[level](JSON.stringify(logData));
    }
  }

  /**
   * Log a metric event (for external aggregation)
   * @param {string} metric - Metric name
   * @param {number} value - Metric value
   * @param {Object} [tags] - Tags/labels
   */
  logMetric(metric, value, tags = {}) {
    this.logEvent('metric', { metric, value, tags }, 'debug');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Initialize default metrics
   * @private
   */
  _initDefaultMetrics() {
    // Process metrics
    this.gauge('process_uptime_seconds', 'Process uptime in seconds');
    this.gauge('process_memory_bytes', 'Process memory usage', ['type']);
    
    // Update process metrics periodically
    setInterval(() => {
      this.gauge('process_uptime_seconds').set((Date.now() - this._startTime) / 1000);
      const mem = process.memoryUsage();
      this.gauge('process_memory_bytes').set({ type: 'heapUsed' }, mem.heapUsed);
      this.gauge('process_memory_bytes').set({ type: 'heapTotal' }, mem.heapTotal);
      this.gauge('process_memory_bytes').set({ type: 'rss' }, mem.rss);
    }, 15000); // Every 15 seconds
  }

  /**
   * Convert labels to string key
   * @private
   */
  _labelsToKey(labels) {
    if (!labels || Object.keys(labels).length === 0) return '';
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
  }

  /**
   * Parse labels from various input formats
   * @private
   */
  _parseLabels(labelsOrValue, value) {
    if (typeof labelsOrValue === 'number') {
      return { labels: {}, value: labelsOrValue };
    }
    return { labels: labelsOrValue || {}, value: value ?? 1 };
  }

  // Counter operations
  _incCounter(metric, labelsOrValue, value) {
    const { labels, value: incValue } = this._parseLabels(labelsOrValue, value);
    const key = this._labelsToKey(labels);
    const current = metric.values.get(key) || 0;
    metric.values.set(key, current + incValue);
  }

  _getCounterValue(metric, labels) {
    const key = this._labelsToKey(labels);
    return metric.values.get(key) || 0;
  }

  // Gauge operations
  _setGauge(metric, labelsOrValue, value) {
    const { labels, value: setValue } = this._parseLabels(labelsOrValue, value);
    const key = this._labelsToKey(labels);
    metric.values.set(key, setValue);
  }

  _incGauge(metric, labelsOrValue, value) {
    const { labels, value: incValue } = this._parseLabels(labelsOrValue, value);
    const key = this._labelsToKey(labels);
    const current = metric.values.get(key) || 0;
    metric.values.set(key, current + incValue);
  }

  _decGauge(metric, labelsOrValue, value) {
    const { labels, value: decValue } = this._parseLabels(labelsOrValue, value);
    const key = this._labelsToKey(labels);
    const current = metric.values.get(key) || 0;
    metric.values.set(key, current - decValue);
  }

  _getGaugeValue(metric, labels) {
    const key = this._labelsToKey(labels);
    return metric.values.get(key) || 0;
  }

  // Histogram operations
  _observeHistogram(metric, labelsOrValue, value) {
    const { labels, value: observeValue } = this._parseLabels(labelsOrValue, value);
    const key = this._labelsToKey(labels);
    
    let data = metric.values.get(key);
    if (!data) {
      data = {
        buckets: new Array(metric.buckets.length).fill(0),
        sum: 0,
        count: 0
      };
      metric.values.set(key, data);
    }
    
    // Update buckets
    for (let i = 0; i < metric.buckets.length; i++) {
      if (observeValue <= metric.buckets[i]) {
        data.buckets[i]++;
      }
    }
    
    data.sum += observeValue;
    data.count++;
  }

  _startTimer(metric, labels) {
    const start = process.hrtime.bigint();
    return () => {
      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1_000_000;
      this._observeHistogram(metric, labels, durationMs);
      return durationMs;
    };
  }

  _getHistogramValue(metric, labels) {
    const key = this._labelsToKey(labels);
    return metric.values.get(key) || { buckets: [], sum: 0, count: 0 };
  }
}

export default ObservabilityService;
