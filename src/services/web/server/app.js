/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import process from 'process';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import { attachUserFromCookie, ensureAuthenticated, ensureAdmin, requireSignedWrite } from './middleware/authCookie.js';

async function initializeApp(services) {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    const staticDir = process.env.NODE_ENV === 'production'
      ? path.join(__dirname,'../../../..', 'dist')
      : path.join(__dirname, '..', 'public');

    const app = express();
  const serverCfg = services.configService?.config?.server || {};
  const PORT = serverCfg.port || process.env.WEB_PORT || 3000;
    const logger = services.logger;

    // Middleware setup
  const corsCfg = serverCfg.cors || { enabled: true, origin: '*', credentials: false };
  const allowedOrigins = Array.isArray(corsCfg.origin) ? corsCfg.origin : String(corsCfg.origin || '*');
  app.use(cors({ origin: allowedOrigins, credentials: !!corsCfg.credentials }));
  // Optional basic rate limit
  const rl = serverCfg.rateLimit || { enabled: false, windowMs: 60_000, max: 100 };
  if (rl.enabled) {
    app.use(rateLimit({ windowMs: Number(rl.windowMs) || 60_000, max: Number(rl.max) || 100, standardHeaders: true, legacyHeaders: false }));
  }
    app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(attachUserFromCookie);
    app.use((req, res, next) => {
      logger.info(`Request: ${req.method} ${req.path}`);
      res.setHeader('Cache-Control', 'no-cache');
      next();
    });

    // Gate all /admin paths behind wallet login (except the login page itself)
  app.use('/admin', (req, res, next) => {
      const p = req.path || '';
      // Allow the login page without auth
      if (p === '/login' || p === '/login.html') return next();
      if (req.user) return next();
      if (req.accepts('html')) return res.redirect('/admin/login');
      return res.status(401).json({ error: 'Unauthorized' });
    });

    // Static files (optional, only if needed)
    app.use(express.static(staticDir, { maxAge: '1h', etag: false }));

    // Serve generated thumbnails regardless of environment
    const thumbsDir = process.env.NODE_ENV === 'production'
      ? path.join(staticDir, 'thumbnails')
      : path.join(__dirname, '..', 'public', 'thumbnails');
    app.use('/thumbnails', express.static(thumbsDir, { maxAge: '7d', etag: false }));

  // Serve images from both root-level /images and bundled public/images
  const rootImagesDir = path.join(process.cwd(), 'images');
  app.use('/images', express.static(rootImagesDir, { maxAge: '7d', etag: false }));
  const publicImagesDir = path.join(staticDir, 'images');
  app.use('/images', express.static(publicImagesDir, { maxAge: '7d', etag: false }));

    // Core services
    app.locals.services = services;
  // Reuse existing DB connection; do not force re-connect if already connected
  const db = await services.databaseService.getDatabase();
  logger.info('Web server using existing database connection');

    // Ensure SecretsService is attached to DB for persistence
    try {
      if (!services.secretsService.db) {
        await services.secretsService.attachDB(db, { collectionName: 'secrets' });
      }
    } catch (e) {
      logger.error('Failed to attach SecretsService to DB:', e);
    }

    // Routes
    app.get('/test', (req, res) => res.json({ message: 'Test route working' }));
  app.use('/api/leaderboard', (await import('./routes/leaderboard.js')).default(db));
    app.use('/api/dungeon', (await import('./routes/dungeon.js')).default(db));
    app.use('/api/health', (await import('./routes/health.js')).default(db));
    app.use('/api/avatars', (await import('./routes/avatars.js')).default(db));
    app.use('/api/tokens', (await import('./routes/tokens.js')).default(db));
    app.use('/api/tribes', (await import('./routes/tribes.js')).default(db));
    app.use('/api/xauth', (await import('./routes/xauth.js')).default(services));
    app.use('/api/wiki', (await import('./routes/wiki.js')).default(db));
    app.use('/api/social', (await import('./routes/social.js')).default(db));
    app.use('/api/claims', (await import('./routes/claims.js')).default(db));
  app.use('/api/link', (await import('./routes/link.js')).default(db));
    app.use('/api/guilds', (await import('./routes/guilds.js')).default(db, services.discordService.client, services.configService));
  // Protect admin API
  // Mount specific collections router first to prevent shadowing by the generic /api/admin router
  app.use('/api/admin/collections', ensureAdmin, requireSignedWrite, (await import('./routes/admin.collections.js')).default(db));
  // /api/admin/video-jobs removed: inline video generation active
  // Admin API: allow reads with session; require signed message for writes
  app.use('/api/admin', ensureAdmin, requireSignedWrite, (await import('./routes/admin.js')).default(db, services));
  app.use('/api/secrets', (await import('./routes/secrets.js')).default(services));
  app.use('/api/settings', (await import('./routes/settings.js')).default(services));
    app.use('/api/rati', (await import('./routes/rati.js')).default(db));
    app.use('/api/models', (await import('./routes/models.js')).default(db));
  app.use('/api/collections', (await import('./routes/collections.js')).default(db));
  app.use('/api/auth', (await import('./routes/auth.js')).default(db));
  app.use('/api/memory', ensureAdmin, (await import('./routes/memory.js')).default(db));

    // Custom route
    app.post('/api/claims/renounce', async (req, res) => {
      const { avatarId, walletAddress } = req.body;
      try {
        const result = await db.avatar_claims.deleteOne({ avatarId, walletAddress });
        if (result.deletedCount === 0) {
          return res.status(404).json({ error: 'Claim not found' });
        }
        res.status(200).json({ message: 'Claim renounced successfully' });
      } catch (error) {
        logger.error('Error renouncing claim:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Version endpoint
    app.get('/api/version', (req, res) => {
      res.json({
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        buildDate: new Date().toISOString(),
      });
    });

    // Admin pages (serve clean URLs for static admin HTML)
    app.get('/admin/login', (req, res, next) => {
      if (req.user) return res.redirect('/admin');
      res.sendFile(path.join(staticDir, 'admin', 'login.html'), (err) => {
        if (err) next(err);
      });
    });
    app.get('/admin', ensureAuthenticated, (req, res, next) => {
      res.sendFile(path.join(staticDir, 'admin', 'index.html'), (err) => {
        if (err) next(err);
      });
    });
    app.get('/admin/guild-settings', ensureAdmin, (req, res) => {
      // Consolidated into /admin/settings
      res.redirect('/admin/settings');
    });
    // Backward compat: redirect old Avatar Management to Entity Management
    app.get('/admin/avatar-management', ensureAdmin, (req, res) => {
      res.redirect('/admin/entity-management');
    });
    app.get('/admin/entity-management', ensureAdmin, (req, res, next) => {
      res.sendFile(path.join(staticDir, 'admin', 'entity-management.html'), (err) => {
        if (err) next(err);
      });
    });
    app.get('/admin/secrets', ensureAdmin, (req, res, next) => {
      res.sendFile(path.join(staticDir, 'admin', 'secrets.html'), (err) => {
        if (err) next(err);
      });
    });
    app.get('/admin/collections', ensureAdmin, (req, res, next) => {
      res.sendFile(path.join(staticDir, 'admin', 'collections.html'), (err) => {
        if (err) next(err);
      });
    });
    app.get('/admin/x-accounts', ensureAdmin, (req, res, next) => {
      res.sendFile(path.join(staticDir, 'admin', 'x-accounts.html'), (err) => {
        if (err) next(err);
      });
    });
    app.get('/admin/settings', ensureAdmin, (req, res, next) => {
      res.sendFile(path.join(staticDir, 'admin', 'settings.html'), (err) => {
        if (err) next(err);
      });
    });

    // SPA fallback (only if serving a frontend)
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || path.extname(req.path)) {
        return next();
      }
      res.sendFile('index.html', { root: staticDir }, (err) => {
        if (err) next(err);
      });
    });

    // Global error handler
    app.use((err, req, res, next) => {
      logger.error('Express error:', err);
      const statusCode = err.statusCode || 500;
      const errorResponse = {
        error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message,
      };
      if (process.env.NODE_ENV !== 'production' && err.stack) {
        errorResponse.stack = err.stack;
      }
      res.status(statusCode).json(errorResponse);
    });

    // Start server on the configured port; if it's taken we fail fast (no auto-increment)
    const server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Server running in ${process.env.NODE_ENV || 'development'} mode at http://0.0.0.0:${PORT}`);
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down...');
  // Attempt to close underlying server if available
  try { server?.close?.(); } catch {}
      await services.databaseService.close();
      if (services.discordService.client) await services.discordService.client.destroy();
      process.exit(0);
    });

    return app;
  } catch (error) {
    services.logger.error('Failed to initialize server:', error);
    process.exit(1);
  }
}

export default initializeApp;