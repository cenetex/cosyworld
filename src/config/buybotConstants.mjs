/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Configuration constants for BuybotService
 */

// Default ORB collection address (can be overridden per channel via trackCollection)
export const DEFAULT_ORB_COLLECTION_ADDRESS = process.env.ORB_COLLECTION_ADDRESS || '8GCAyy5L2o2ZPdQKo3EtYAYNKYT8Y6sqGHweintLTSJ';

// Polling interval for checking token transactions (milliseconds)
export const POLLING_INTERVAL_MS = parseInt(process.env.BUYBOT_POLL_INTERVAL_MS, 10) || 300000; // 5 minutes

// Maximum number of tokens/collections that can be tracked per channel
export const MAX_TRACKED_TOKENS_PER_CHANNEL = parseInt(process.env.MAX_TRACKED_TOKENS_PER_CHANNEL, 10) || 20;
export const MAX_TRACKED_COLLECTIONS_PER_CHANNEL = parseInt(process.env.MAX_TRACKED_COLLECTIONS_PER_CHANNEL, 10) || 10;

// Maximum total active webhooks across all channels
export const MAX_TOTAL_ACTIVE_WEBHOOKS = parseInt(process.env.MAX_TOTAL_ACTIVE_WEBHOOKS, 10) || 100;

// Retry configuration for external API calls
export const API_RETRY_MAX_ATTEMPTS = parseInt(process.env.API_RETRY_MAX_ATTEMPTS, 10) || 3;
export const API_RETRY_BASE_DELAY_MS = parseInt(process.env.API_RETRY_BASE_DELAY_MS, 10) || 1000;

// Rate limit configuration for Helius API
export const RATE_LIMIT_MAX_ATTEMPTS = parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS, 10) || 5;
export const RATE_LIMIT_BASE_DELAY_MS = parseInt(process.env.RATE_LIMIT_BASE_DELAY_MS, 10) || 5000; // 5 seconds
export const RATE_LIMIT_MAX_DELAY_MS = parseInt(process.env.RATE_LIMIT_MAX_DELAY_MS, 10) || 300000; // 5 minutes
export const RATE_LIMIT_COOLDOWN_MS = parseInt(process.env.RATE_LIMIT_COOLDOWN_MS, 10) || 60000; // 1 minute

// Price cache TTL (milliseconds)
export const PRICE_CACHE_TTL_MS = parseInt(process.env.PRICE_CACHE_TTL_MS, 10) || 300000; // 5 minutes

// Maximum number of recent transactions to request per poll (higher value reduces missed buys during bursts)
export const RECENT_TRANSACTIONS_LIMIT = parseInt(process.env.BUYBOT_RECENT_TRANSACTIONS_LIMIT, 10) || 100;

// Maximum number of paginated requests to fetch per poll when the recent transactions endpoint returns more than the limit
export const RECENT_TRANSACTIONS_MAX_PAGES = parseInt(process.env.BUYBOT_RECENT_TRANSACTIONS_MAX_PAGES, 10) || 5;
