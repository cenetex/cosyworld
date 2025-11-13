# Report 01 - Docker Containerization Guide

**Document Version:** 1.0  
**Date:** November 13, 2025  
**Prerequisites:** None  
**Estimated Implementation Time:** 1-2 days  
**Related Reports:** [00 - Overview](./00_AWS_DEPLOYMENT_OVERVIEW.md)

---

## Table of Contents

1. [Overview](#overview)
2. [Dockerfile Design](#dockerfile-design)
3. [Multi-Stage Build](#multi-stage-build)
4. [Health Check Endpoints](#health-check-endpoints)
5. [Graceful Shutdown](#graceful-shutdown)
6. [docker-compose for Local Development](#docker-compose-for-local-development)
7. [Testing & Validation](#testing--validation)
8. [Build Optimization](#build-optimization)
9. [Security Hardening](#security-hardening)
10. [Implementation Checklist](#implementation-checklist)

---

## Overview

### Goals

Transform CosyWorld from a platform-dependent Node.js application to a **portable, production-ready Docker container** that can run on any orchestration platform (ECS, Kubernetes, local development).

### Why Containerization?

**Current State (Replit Deployment):**
```
Replit VM
  ├─ Node.js 18 (Replit-managed)
  ├─ MongoDB (external Atlas)
  ├─ Environment variables (Replit Secrets)
  └─ Manual start/stop via UI
```

**Problems:**
- ❌ Platform lock-in (Replit-specific)
- ❌ Inconsistent environments (dev vs prod)
- ❌ No health checks or graceful shutdown
- ❌ Manual deployment process
- ❌ Cannot run multiple instances
- ❌ No rollback capability

**Target State (Containerized):**
```
Docker Container
  ├─ Node.js 18 (locked version)
  ├─ Application code (immutable)
  ├─ Health check endpoints
  ├─ Graceful shutdown handlers
  └─ Runs identically everywhere
```

**Benefits:**
- ✅ Platform-agnostic (runs on ECS, EKS, local, anywhere)
- ✅ Consistent environments (dev = staging = prod)
- ✅ Automated health monitoring
- ✅ Graceful shutdown prevents data loss
- ✅ Horizontal scaling ready
- ✅ Instant rollback via image tags
- ✅ Reproducible builds

---

## Dockerfile Design

### Production Dockerfile

Create `Dockerfile` in project root:

```dockerfile
# syntax=docker/dockerfile:1.4

# ============================================================================
# Stage 1: Dependencies (cached layer)
# ============================================================================
FROM node:18.20-alpine AS dependencies

# Install build dependencies for native modules (sharp, etc.)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libc6-compat \
    vips-dev

WORKDIR /app

# Copy package files for dependency installation
COPY package.json package-lock.json ./

# Install ALL dependencies (including devDependencies for build stage)
RUN npm ci --include=dev

# ============================================================================
# Stage 2: Builder (compile frontend assets)
# ============================================================================
FROM dependencies AS builder

WORKDIR /app

# Copy source code
COPY . .

# Build frontend assets with webpack
RUN npm run build:js

# Generate documentation
RUN npm run docs

# ============================================================================
# Stage 3: Production dependencies only
# ============================================================================
FROM node:18.20-alpine AS prod-dependencies

WORKDIR /app

COPY package.json package-lock.json ./

# Install ONLY production dependencies (smaller image)
RUN npm ci --omit=dev --ignore-scripts

# ============================================================================
# Stage 4: Runtime (final production image)
# ============================================================================
FROM node:18.20-alpine AS runtime

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Install runtime dependencies only
RUN apk add --no-cache \
    dumb-init \
    vips

WORKDIR /app

# Copy production dependencies
COPY --from=prod-dependencies --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy built assets from builder stage
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/docs ./docs

# Copy application source code
COPY --chown=nodejs:nodejs . .

# Set NODE_ENV to production
ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=2048" \
    PORT=3000

# Expose web service port
EXPOSE 3000

# Switch to non-root user
USER nodejs

# Health check configuration
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health/live', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

# Use dumb-init to handle signals properly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Start the application
CMD ["node", "src/index.mjs"]
```

### Dockerfile Breakdown

#### Stage 1: Dependencies
```dockerfile
FROM node:18.20-alpine AS dependencies
RUN apk add --no-cache python3 make g++ libc6-compat vips-dev
RUN npm ci --include=dev
```
- **Base image:** `node:18.20-alpine` (small, secure, specific version)
- **Build tools:** Required for native modules (sharp uses vips)
- **Dependencies:** All deps including devDependencies (needed for webpack build)

#### Stage 2: Builder
```dockerfile
FROM dependencies AS builder
RUN npm run build:js
RUN npm run docs
```
- **Purpose:** Compile frontend JavaScript bundle and docs
- **Output:** `dist/` directory with optimized webpack bundle
- **Why separate:** Build tools not needed in final image

#### Stage 3: Production Dependencies
```dockerfile
FROM node:18.20-alpine AS prod-dependencies
RUN npm ci --omit=dev --ignore-scripts
```
- **Purpose:** Clean install of production deps only
- **Why:** Removes 100+ MB of devDependencies (webpack, eslint, etc.)
- **Result:** Smaller final image

#### Stage 4: Runtime
```dockerfile
FROM node:18.20-alpine AS runtime
USER nodejs  # Non-root for security
HEALTHCHECK --interval=30s ...
CMD ["node", "src/index.mjs"]
```
- **Purpose:** Final production image
- **Security:** Runs as non-root user (nodejs:nodejs)
- **Health:** Built-in Docker health check
- **Entrypoint:** dumb-init for proper signal handling

---

## Multi-Stage Build Benefits

### Image Size Comparison

| Build Type | Size | Contains |
|------------|------|----------|
| Single-stage (no optimization) | ~1.2 GB | Source + deps + devDeps + build tools |
| Multi-stage (optimized) | ~350 MB | Source + prod deps + built assets |
| **Reduction** | **~71% smaller** | |

### Layer Caching Strategy

Docker caches each layer - ordered by change frequency:

```dockerfile
# Layer 1: Base image (changes rarely)
FROM node:18.20-alpine AS dependencies

# Layer 2: System dependencies (changes rarely)
RUN apk add --no-cache python3 make g++

# Layer 3: Package files (changes occasionally)
COPY package.json package-lock.json ./

# Layer 4: Node dependencies (changes occasionally)
RUN npm ci

# Layer 5: Source code (changes frequently)
COPY . .

# Layer 6: Build output (changes frequently)
RUN npm run build:js
```

**Build time optimization:**
- First build: ~5-8 minutes (installs all dependencies)
- Subsequent builds (code change only): ~30-60 seconds (reuses cached layers)
- Dependency change: ~2-3 minutes (rebuilds from layer 4)

---

## Health Check Endpoints

### Current Implementation Analysis

The application already has health check endpoints in `src/services/web/server/routes/health.js`:

#### Liveness Probe (`/api/health/live`)
```javascript
router.get('/live', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
  });
});
```
- **Purpose:** "Is the process running?"
- **Use:** Docker/ECS restarts container if this fails
- **Checks:** Only that Node.js process is responsive
- **Failure action:** Kill and restart container

#### Readiness Probe (`/api/health/ready`)
```javascript
router.get('/ready', async (req, res) => {
  const checks = {
    database: { healthy: false, latency: null },
    ai: { healthy: false },
  };
  
  // Check database connection
  await db.command({ ping: 1 });
  checks.database.healthy = true;
  
  // Check AI service availability
  checks.ai.healthy = !!(unifiedAIService || aiService);
  
  const healthy = checks.database.healthy && checks.ai.healthy;
  const statusCode = healthy ? 200 : 503;
  
  res.status(statusCode).json({
    status: healthy ? 'ready' : 'not_ready',
    checks,
    timestamp: new Date().toISOString(),
  });
});
```
- **Purpose:** "Can the application serve traffic?"
- **Use:** Load balancer routes traffic only to ready instances
- **Checks:** Database connection, AI service availability
- **Failure action:** Remove from load balancer (don't kill container)

### Enhanced Health Checks for Multi-Instance

Add Redis health check for multi-instance deployments:

```javascript
// File: src/services/web/server/routes/health.js
router.get('/ready', async (req, res) => {
  const checks = {
    database: { healthy: false, latency: null },
    ai: { healthy: false },
    redis: { healthy: false, role: null }, // NEW
  };
  
  const startTime = Date.now();

  try {
    // Existing database check
    if (db) {
      const dbStart = Date.now();
      await db.command({ ping: 1 });
      checks.database.healthy = true;
      checks.database.latency = Date.now() - dbStart;
    }

    // Existing AI check
    const { aiService, unifiedAIService } = services;
    const ai = unifiedAIService || aiService;
    checks.ai.healthy = !!ai;
    checks.ai.provider = ai?.activeProvider || 'unknown';

    // NEW: Redis check (if Redis service exists)
    if (services.redisService) {
      try {
        const pingResult = await services.redisService.ping();
        checks.redis.healthy = pingResult === 'PONG';
        checks.redis.role = await services.redisService.getRole(); // 'leader' or 'follower'
      } catch (redisErr) {
        checks.redis.error = redisErr.message;
      }
    } else {
      // Redis not configured yet (single-instance mode)
      checks.redis.healthy = true;
      checks.redis.role = 'not-configured';
    }

    // All critical services must be healthy
    const healthy = checks.database.healthy && 
                    checks.ai.healthy && 
                    checks.redis.healthy;
    
    const statusCode = healthy ? 200 : 503;

    res.status(statusCode).json({
      status: healthy ? 'ready' : 'not_ready',
      checks,
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime,
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      error: error.message,
      checks,
      timestamp: new Date().toISOString(),
    });
  }
});
```

### Health Check Configuration

**Docker Healthcheck:**
```dockerfile
HEALTHCHECK --interval=30s \      # Check every 30 seconds
            --timeout=5s \        # Timeout after 5 seconds
            --start-period=60s \  # Wait 60s before first check (startup time)
            --retries=3 \         # Fail after 3 consecutive failures
  CMD node -e "require('http').get('http://localhost:3000/api/health/live', ...)"
```

**ECS Task Definition:**
```json
{
  "healthCheck": {
    "command": ["CMD-SHELL", "node -e \"require('http').get('http://localhost:3000/api/health/live', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));\""],
    "interval": 30,
    "timeout": 5,
    "retries": 3,
    "startPeriod": 60
  }
}
```

**ALB Target Group Health Check:**
```hcl
resource "aws_lb_target_group" "app" {
  health_check {
    enabled             = true
    path                = "/api/health/ready"  # Use readiness, not liveness
    protocol            = "HTTP"
    port                = "traffic-port"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    matcher             = "200"
  }
}
```

---

## Graceful Shutdown

### Problem: Ungraceful Shutdown

Current `src/index.mjs` has no shutdown handling:

```javascript
// Current: No signal handlers
async function main() {
  const container = await createContainer();
  const webService = container.resolve('webService');
  await webService.start();
  // Application runs... but SIGTERM/SIGINT not handled
}

main();
```

**What happens when Docker sends SIGTERM:**
1. Node.js process receives SIGTERM signal
2. Process exits immediately (default behavior)
3. In-flight HTTP requests aborted (500 errors to users)
4. Discord/Telegram connections dropped (no goodbye message)
5. Database connections closed abruptly
6. Potential data loss in write buffers

### Solution: Graceful Shutdown Handler

Add to `src/index.mjs`:

```javascript
/**
 * Graceful shutdown handler
 * @param {string} signal - Signal name (SIGTERM, SIGINT)
 * @param {Object} container - Awilix container
 */
async function gracefulShutdown(signal, container) {
  console.log(`\n🛑 Received ${signal}, starting graceful shutdown...`);
  
  const startTime = Date.now();
  const SHUTDOWN_TIMEOUT = 30000; // 30 seconds max

  try {
    // Step 1: Stop accepting new requests
    console.log('📴 Stopping web service...');
    const webService = container.resolve('webService');
    await webService.stop(); // Close HTTP server
    
    // Step 2: Disconnect bot services (prevents new messages)
    console.log('🤖 Disconnecting bot services...');
    const discordService = container.resolve('discordService');
    const telegramService = container.resolve('telegramService');
    
    await Promise.race([
      Promise.all([
        discordService?.disconnect?.().catch(err => 
          console.error('Discord disconnect error:', err)
        ),
        telegramService?.stop?.().catch(err => 
          console.error('Telegram disconnect error:', err)
        ),
      ]),
      new Promise(resolve => setTimeout(resolve, 5000)) // 5s timeout for bot disconnects
    ]);
    
    // Step 3: Stop background schedulers
    console.log('⏱️  Stopping schedulers...');
    const schedulerService = container.resolve('schedulerService');
    await schedulerService?.stopAll?.();
    
    // Step 4: Flush in-flight operations
    console.log('💾 Flushing database writes...');
    const databaseService = container.resolve('databaseService');
    // Wait for in-flight operations (MongoDB driver handles this)
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Step 5: Close database connections
    console.log('🔌 Closing database connection...');
    await databaseService?.close?.();
    
    // Step 6: Close Redis connection (if exists)
    const redisService = container.resolve('redisService');
    if (redisService) {
      console.log('🔌 Closing Redis connection...');
      await redisService?.disconnect?.();
    }
    
    const shutdownTime = Date.now() - startTime;
    console.log(`✅ Graceful shutdown completed in ${shutdownTime}ms`);
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error);
    process.exit(1);
  }
}

// Main application
async function main() {
  let container;
  
  try {
    container = await createContainer();
    
    // Register shutdown handlers
    const shutdownHandler = (signal) => gracefulShutdown(signal, container);
    process.on('SIGTERM', () => shutdownHandler('SIGTERM')); // Docker/ECS sends SIGTERM
    process.on('SIGINT', () => shutdownHandler('SIGINT'));   // Ctrl+C in terminal
    
    // Start services
    const webService = container.resolve('webService');
    await webService.start();
    
    console.log('✅ Application started successfully');
    console.log('📡 Health check: http://localhost:3000/api/health/live');
    console.log('🔍 Readiness check: http://localhost:3000/api/health/ready');
    
  } catch (error) {
    console.error('❌ Failed to start application:', error);
    process.exit(1);
  }
}

main();
```

### Implement Stop Methods in Services

#### WebService
```javascript
// File: src/services/web/webService.mjs
export class WebService {
  constructor({ logger, ... }) {
    this.server = null; // Store HTTP server instance
  }
  
  async start() {
    const app = initializeApp({ ... });
    this.server = app.listen(this.port, () => {
      this.logger.info(`WebService listening on port ${this.port}`);
    });
  }
  
  async stop() {
    if (!this.server) return;
    
    return new Promise((resolve, reject) => {
      // Stop accepting new connections
      this.server.close((err) => {
        if (err) {
          this.logger.error('Error closing HTTP server:', err);
          reject(err);
        } else {
          this.logger.info('HTTP server closed');
          resolve();
        }
      });
      
      // Force close after 10 seconds
      setTimeout(() => {
        this.logger.warn('Forcing server close after timeout');
        resolve();
      }, 10000);
    });
  }
}
```

#### DatabaseService
```javascript
// File: src/services/foundation/databaseService.mjs
export class DatabaseService {
  async close() {
    if (this.dbClient) {
      await this.dbClient.close();
      this.logger.info('MongoDB connection closed');
    }
  }
}
```

---

## docker-compose for Local Development

Create `docker-compose.yml` in project root:

```yaml
version: '3.8'

services:
  # ============================================================================
  # MongoDB Database
  # ============================================================================
  mongodb:
    image: mongo:7.0
    container_name: cosyworld-mongodb
    ports:
      - "27017:27017"
    environment:
      MONGO_INITDB_ROOT_USERNAME: admin
      MONGO_INITDB_ROOT_PASSWORD: password123
      MONGO_INITDB_DATABASE: cosyworld8
    volumes:
      - mongodb_data:/data/db
      - ./scripts/mongo-init.js:/docker-entrypoint-initdb.d/mongo-init.js:ro
    networks:
      - cosyworld-network
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ============================================================================
  # Redis Cache (for multi-instance coordination)
  # ============================================================================
  redis:
    image: redis:7.2-alpine
    container_name: cosyworld-redis
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    networks:
      - cosyworld-network
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  # ============================================================================
  # CosyWorld Application
  # ============================================================================
  app:
    build:
      context: .
      dockerfile: Dockerfile
      target: runtime
    container_name: cosyworld-app
    ports:
      - "3000:3000"
    environment:
      # Core
      NODE_ENV: development
      WEB_PORT: 3000
      
      # Database
      MONGO_URI: mongodb://admin:password123@mongodb:27017/cosyworld8?authSource=admin
      MONGO_DB_NAME: cosyworld8
      
      # Redis (optional, for testing multi-instance features)
      REDIS_URL: redis://redis:6379
      
      # Secrets (use .env file for real values)
      DISCORD_BOT_TOKEN: ${DISCORD_BOT_TOKEN}
      DISCORD_CLIENT_ID: ${DISCORD_CLIENT_ID}
      OPENROUTER_API_KEY: ${OPENROUTER_API_KEY}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      
      # Optional services
      GOOGLE_AI_API_KEY: ${GOOGLE_AI_API_KEY:-}
      HELIUS_API_KEY: ${HELIUS_API_KEY:-}
      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN:-}
      
      # Feature flags
      ENABLE_LLM_TOOL_CALLING: ${ENABLE_LLM_TOOL_CALLING:-true}
      TOOL_USE_META_PROMPTING: ${TOOL_USE_META_PROMPTING:-true}
      MAX_RESPONSES_PER_MESSAGE: ${MAX_RESPONSES_PER_MESSAGE:-1}
      
    env_file:
      - .env  # Load from .env file (git-ignored)
    depends_on:
      mongodb:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      # Mount source code for development (hot reload with nodemon)
      - ./src:/app/src:ro
      - ./public:/app/public:ro
      # Logs directory (optional)
      - ./logs:/app/logs
    networks:
      - cosyworld-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/api/health/live', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 60s

# ============================================================================
# Networks
# ============================================================================
networks:
  cosyworld-network:
    driver: bridge

# ============================================================================
# Volumes (persist data across restarts)
# ============================================================================
volumes:
  mongodb_data:
    driver: local
  redis_data:
    driver: local
```

### MongoDB Initialization Script

Create `scripts/mongo-init.js`:

```javascript
// MongoDB initialization script
// Creates database and default user
db = db.getSiblingDB('cosyworld8');

// Create application user with read/write permissions
db.createUser({
  user: 'cosyworld',
  pwd: 'cosyworld_password',
  roles: [
    {
      role: 'readWrite',
      db: 'cosyworld8'
    }
  ]
});

// Create initial collections
db.createCollection('avatars');
db.createCollection('messages');
db.createCollection('users');
db.createCollection('setup_status');

print('MongoDB initialized successfully for CosyWorld');
```

### Environment Variables (.env)

Create `.env.example`:

```bash
# ============================================================================
# CosyWorld Environment Configuration
# ============================================================================

# Core
NODE_ENV=development
WEB_PORT=3000

# Database (use docker-compose service names)
MONGO_URI=mongodb://admin:password123@mongodb:27017/cosyworld8?authSource=admin
MONGO_DB_NAME=cosyworld8

# Redis (optional for local dev)
REDIS_URL=redis://redis:6379

# Discord (REQUIRED)
DISCORD_BOT_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_discord_client_id_here

# Encryption (REQUIRED - generate with: openssl rand -base64 32)
ENCRYPTION_KEY=your_base64_encryption_key_here

# AI Services (at least one REQUIRED)
OPENROUTER_API_KEY=your_openrouter_api_key_here
GOOGLE_AI_API_KEY=your_google_ai_api_key_here

# Optional Services
HELIUS_API_KEY=
TELEGRAM_BOT_TOKEN=
REPLICATE_API_TOKEN=
TWITTER_BEARER_TOKEN=

# Feature Flags
ENABLE_LLM_TOOL_CALLING=true
TOOL_USE_META_PROMPTING=true
MAX_RESPONSES_PER_MESSAGE=1
STICKY_AFFINITY_EXCLUSIVE=true
TURN_BASED_MODE=true

# S3 (optional)
S3_API_ENDPOINT=
S3_API_KEY=
S3_API_SECRET=
S3_BUCKET_NAME=
```

Copy to `.env` and fill in real values:
```bash
cp .env.example .env
# Edit .env with your actual credentials
```

---

## Testing & Validation

### Local Testing Procedure

#### 1. Build Docker Image
```bash
# Build the production image
docker build -t cosyworld:local .

# Verify image size
docker images cosyworld:local
# Expected: ~350 MB

# Inspect image layers
docker history cosyworld:local
```

#### 2. Run with docker-compose
```bash
# Start all services (MongoDB + Redis + App)
docker-compose up -d

# Watch logs
docker-compose logs -f app

# Verify all services are healthy
docker-compose ps
# All should show "healthy" status
```

#### 3. Health Check Validation
```bash
# Test liveness probe (should return 200)
curl http://localhost:3000/api/health/live

# Expected response:
# {
#   "status": "ok",
#   "timestamp": "2025-11-13T10:30:00.000Z",
#   "uptime": 42
# }

# Test readiness probe (should return 200)
curl http://localhost:3000/api/health/ready

# Expected response:
# {
#   "status": "ready",
#   "checks": {
#     "database": { "healthy": true, "latency": 12 },
#     "ai": { "healthy": true, "provider": "openrouter" },
#     "redis": { "healthy": true, "role": "not-configured" }
#   },
#   "timestamp": "2025-11-13T10:30:00.000Z",
#   "responseTime": 15
# }
```

#### 4. Graceful Shutdown Test
```bash
# Send SIGTERM to container
docker-compose stop app

# Watch logs for graceful shutdown sequence
docker-compose logs app | tail -20

# Expected log output:
# 🛑 Received SIGTERM, starting graceful shutdown...
# 📴 Stopping web service...
# 🤖 Disconnecting bot services...
# ⏱️  Stopping schedulers...
# 💾 Flushing database writes...
# 🔌 Closing database connection...
# ✅ Graceful shutdown completed in 3456ms
```

#### 5. Application Functionality Test
```bash
# Test web UI
open http://localhost:3000

# Test API endpoints
curl http://localhost:3000/api/avatars

# Test Discord bot connection (check logs)
docker-compose logs app | grep -i discord
# Should see: "Discord bot logged in as YourBot#1234"
```

#### 6. Multi-Container Test
```bash
# Start 2 instances of the app (requires Redis coordination)
docker-compose up -d --scale app=2

# Verify both containers are healthy
docker-compose ps
# Should show app_1 and app_2 both healthy

# Check leader election (only 1 should be leader)
curl http://localhost:3000/api/health/ready | jq '.checks.redis.role'
# One returns "leader", other returns "follower"
```

### Validation Checklist

#### Build Validation
- ✅ Docker image builds successfully without errors
- ✅ Image size < 400 MB
- ✅ Multi-stage build uses layer caching
- ✅ `dist/` directory contains webpack bundle
- ✅ `node_modules/` contains only production dependencies

#### Runtime Validation
- ✅ Container starts within 60 seconds
- ✅ All 70+ services initialize without errors
- ✅ `/api/health/live` returns 200 OK
- ✅ `/api/health/ready` returns 200 OK with all checks healthy
- ✅ Web UI accessible on http://localhost:3000
- ✅ Discord bot connects successfully (check logs)
- ✅ MongoDB connection established
- ✅ Redis connection established (if configured)

#### Shutdown Validation
- ✅ SIGTERM triggers graceful shutdown
- ✅ HTTP server stops accepting new connections
- ✅ Bot services disconnect cleanly
- ✅ Database connections close properly
- ✅ Container exits within 30 seconds
- ✅ No "killed" or "force stop" messages

#### Security Validation
- ✅ Container runs as non-root user (nodejs)
- ✅ No secrets in image layers (check with `docker history`)
- ✅ Environment variables loaded from `.env` file
- ✅ Sensitive files excluded via `.dockerignore`

---

## Build Optimization

### .dockerignore File

Create `.dockerignore` to exclude unnecessary files:

```
# Git
.git
.gitignore

# Node
node_modules
npm-debug.log

# Build artifacts
dist
docs
webpack-stats.json
webpack-stats.txt

# Tests
test
coverage
*.test.mjs
*.test.js

# Development
.env
.env.local
.env.*.local
.replit
replit.nix

# Documentation
*.md
!README.md

# IDE
.vscode
.idea
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
logs
*.log

# Temporary
tmp
temp

# Database dumps
*.dump
*.bson

# Archives
*.zip
*.tar.gz
```

### Build Performance Tips

#### 1. Use BuildKit
```bash
# Enable BuildKit for faster builds
export DOCKER_BUILDKIT=1

# Build with BuildKit
docker build -t cosyworld:latest .
```

**Benefits:**
- Parallel layer building
- Better caching
- Build secrets (for private npm packages)
- Faster `COPY` operations

#### 2. Optimize Layer Order
```dockerfile
# ❌ BAD: Invalidates cache on every code change
COPY . .
RUN npm ci

# ✅ GOOD: Cache dependencies separately
COPY package*.json ./
RUN npm ci
COPY . .
```

#### 3. Use Cache Mounts (BuildKit)
```dockerfile
# Cache npm packages across builds
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev
```

#### 4. Multi-Architecture Builds
```bash
# Build for both AMD64 (x86) and ARM64 (Mac M1/M2, AWS Graviton)
docker buildx build --platform linux/amd64,linux/arm64 -t cosyworld:latest .
```

---

## Security Hardening

### 1. Non-Root User

Already implemented in Dockerfile:

```dockerfile
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001
    
USER nodejs  # Run as non-root
```

**Why:** Prevents privilege escalation if container is compromised

### 2. Read-Only Root Filesystem

Add to docker-compose.yml or ECS task definition:

```yaml
services:
  app:
    read_only: true  # Make root filesystem read-only
    tmpfs:
      - /tmp  # Allow writes to /tmp only
      - /app/logs  # If you need to write logs locally
```

### 3. Minimal Base Image

```dockerfile
# ✅ Alpine-based (5 MB base)
FROM node:18.20-alpine

# ❌ Debian-based (100+ MB base)
FROM node:18.20
```

### 4. Scan for Vulnerabilities

```bash
# Scan image with Trivy
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy image cosyworld:latest

# Scan image with Snyk
snyk container test cosyworld:latest
```

### 5. Secrets Management

**❌ DON'T:**
```dockerfile
# BAD: Secrets in environment variables in Dockerfile
ENV DISCORD_BOT_TOKEN=MTk... 
```

**✅ DO:**
```yaml
# GOOD: Secrets from environment or secrets manager
services:
  app:
    environment:
      DISCORD_BOT_TOKEN: ${DISCORD_BOT_TOKEN}  # From .env file
```

**✅ PRODUCTION:**
```json
// ECS Task Definition with Secrets Manager
{
  "secrets": [
    {
      "name": "DISCORD_BOT_TOKEN",
      "valueFrom": "arn:aws:secretsmanager:region:account:secret:cosyworld/discord-token"
    }
  ]
}
```

---

## Implementation Checklist

### Pre-Implementation
- [ ] Review this document completely
- [ ] Install Docker Desktop (Mac/Windows) or Docker Engine (Linux)
- [ ] Verify Docker version >= 20.10: `docker --version`
- [ ] Verify Docker Compose version >= 2.0: `docker compose version`

### Dockerfile Creation
- [ ] Create `Dockerfile` in project root
- [ ] Implement multi-stage build (4 stages)
- [ ] Add HEALTHCHECK instruction
- [ ] Configure non-root user (nodejs)
- [ ] Set NODE_ENV=production
- [ ] Add dumb-init for signal handling

### Code Changes
- [ ] Add graceful shutdown handler to `src/index.mjs`
- [ ] Implement `webService.stop()` method
- [ ] Implement `databaseService.close()` method
- [ ] Add Redis health check to `/api/health/ready` (if using Redis)
- [ ] Test signal handlers locally (Ctrl+C should trigger graceful shutdown)

### docker-compose Setup
- [ ] Create `docker-compose.yml` with 3 services (app, mongodb, redis)
- [ ] Create `scripts/mongo-init.js` for MongoDB initialization
- [ ] Create `.env.example` with all required variables
- [ ] Copy `.env.example` to `.env` and fill in real values
- [ ] Add `.env` to `.gitignore`

### Build Optimization
- [ ] Create `.dockerignore` file
- [ ] Enable Docker BuildKit: `export DOCKER_BUILDKIT=1`
- [ ] Verify layer caching works (rebuild after code change < 1 min)

### Testing
- [ ] Build image: `docker build -t cosyworld:local .`
- [ ] Verify image size < 400 MB
- [ ] Start stack: `docker-compose up -d`
- [ ] Check health: `curl http://localhost:3000/api/health/live`
- [ ] Check readiness: `curl http://localhost:3000/api/health/ready`
- [ ] Test web UI: Open http://localhost:3000
- [ ] Test graceful shutdown: `docker-compose stop app` (watch logs)
- [ ] Test restart: `docker-compose restart app`

### Documentation
- [ ] Document build process in README
- [ ] Document environment variables in `.env.example`
- [ ] Add troubleshooting section for common issues
- [ ] Document docker-compose commands for team

### Next Steps
- [ ] Review [Report 02 - Infrastructure as Code](./02_INFRASTRUCTURE_AS_CODE.md)
- [ ] Plan AWS ECR repository setup
- [ ] Prepare for Terraform infrastructure implementation

---

## Troubleshooting

### Issue: Docker build fails on `npm ci`

**Error:**
```
npm ERR! code ENOTFOUND
npm ERR! errno ENOTFOUND
```

**Solution:**
- Check Docker DNS settings
- Build with `--network=host` flag:
  ```bash
  docker build --network=host -t cosyworld:local .
  ```

---

### Issue: Health check always fails

**Error:**
```
Health check failed: connection refused
```

**Solution:**
- Ensure app binds to `0.0.0.0` not `localhost`:
  ```javascript
  // ❌ BAD
  app.listen(3000, 'localhost');
  
  // ✅ GOOD
  app.listen(3000, '0.0.0.0');
  ```

---

### Issue: Permission denied errors in container

**Error:**
```
EACCES: permission denied, mkdir '/app/logs'
```

**Solution:**
- Directory must be owned by `nodejs` user:
  ```dockerfile
  RUN mkdir -p /app/logs && chown nodejs:nodejs /app/logs
  ```

---

### Issue: Container killed before graceful shutdown

**Error:**
```
SIGKILL received, force stopping
```

**Solution:**
- Increase shutdown grace period in docker-compose:
  ```yaml
  services:
    app:
      stop_grace_period: 30s  # Give 30 seconds before SIGKILL
  ```

---

## Summary

### What We Built
- ✅ **Production Dockerfile** with multi-stage build (350 MB optimized image)
- ✅ **Health check endpoints** for liveness and readiness probes
- ✅ **Graceful shutdown** handlers for clean termination
- ✅ **docker-compose stack** for local development (app + MongoDB + Redis)
- ✅ **Security hardening** (non-root user, minimal base image)

### Key Benefits
- 🚀 **Portable:** Runs identically on local dev, ECS, EKS, any Docker host
- 🔒 **Secure:** Non-root user, no secrets in image, read-only filesystem
- 📊 **Observable:** Health checks for monitoring and auto-healing
- 🛡️ **Resilient:** Graceful shutdown prevents data loss
- ⚡ **Efficient:** Multi-stage build, layer caching, optimized size

### Validation Criteria
Before proceeding to Report 02:
- ✅ Image builds successfully in < 10 minutes (first build)
- ✅ Health checks return 200 OK
- ✅ Graceful shutdown completes cleanly
- ✅ Application fully functional in container
- ✅ docker-compose stack runs all services

### Next Phase
Proceed to **[Report 02 - Infrastructure as Code](./02_INFRASTRUCTURE_AS_CODE.md)** to deploy containers to AWS ECS Fargate.

---

*Implementation Guide Version: 1.0*  
*Last Updated: November 13, 2025*  
*Estimated Completion: 1-2 days*
