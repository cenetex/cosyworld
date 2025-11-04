/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import telegramAuthRoutes from '../../../src/services/web/server/routes/telegramauth.js';

function createLoggerMock() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

describe('Telegram Auth Routes (Admin Tools)', () => {
  let app;
  let currentUser;
  let services;
  let telegramService;

  beforeEach(() => {
    currentUser = { isAdmin: true };

    telegramService = {
      listTelegramMembers: vi.fn().mockResolvedValue({
        total: 0,
        limit: 50,
        offset: 0,
        members: [],
      }),
      getTelegramMember: vi.fn().mockResolvedValue({
        member: { userId: '123', trustLevel: 'new' },
        recentMessages: [],
      }),
      updateTelegramMember: vi.fn().mockResolvedValue({
        userId: '123',
        trustLevel: 'trusted',
      }),
      unbanTelegramMember: vi.fn().mockResolvedValue({
        userId: '123',
        trustLevel: 'probation',
      }),
      getTelegramSpamStats: vi.fn().mockResolvedValue({
        channelId: '100',
        totals: { totalMembers: 5 },
        recent24h: { joins: 1, spamStrikes: 0 },
      }),
    };

    services = {
      telegramService,
      databaseService: { getDatabase: vi.fn() },
      configService: { get: vi.fn() },
      secretsService: { getAsync: vi.fn() },
      logger: createLoggerMock(),
    };

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = currentUser;
      next();
    });
    app.use('/api/telegram', telegramAuthRoutes(services));
  });

  describe('Admin gating', () => {
    it('rejects non-admin access', async () => {
      currentUser = {};

      const res = await request(app)
        .get('/api/telegram/members/100');

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Admin access required');
      expect(telegramService.listTelegramMembers).not.toHaveBeenCalled();
    });
  });

  describe('GET /members/:channelId', () => {
    it('returns member list with query filters', async () => {
      const payload = {
        total: 2,
        limit: 10,
        offset: 5,
        members: [{ userId: '1' }, { userId: '2' }],
      };
      telegramService.listTelegramMembers.mockResolvedValueOnce(payload);

      const res = await request(app)
        .get('/api/telegram/members/-1000?limit=10&offset=5&includeLeft=true&search=alice&trustLevel=trusted,suspicious');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(payload);
      expect(telegramService.listTelegramMembers).toHaveBeenCalledWith('-1000', {
        limit: '10',
        offset: '5',
        includeLeft: true,
        search: 'alice',
        trustLevels: ['trusted', 'suspicious'],
      });
    });

    it('returns server error when service rejects', async () => {
      telegramService.listTelegramMembers.mockRejectedValueOnce(new Error('boom'));

      const res = await request(app)
        .get('/api/telegram/members/42');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to list members');
    });
  });

  describe('GET /members/:channelId/:userId', () => {
    it('returns member detail bundle', async () => {
      const res = await request(app)
        .get('/api/telegram/members/200/500?includeMessages=true&messageLimit=5');

      expect(res.status).toBe(200);
      expect(res.body.member.userId).toBe('123');
      expect(telegramService.getTelegramMember).toHaveBeenCalledWith('200', '500', {
        includeMessages: true,
        messageLimit: '5',
      });
    });

    it('returns 404 when member is missing', async () => {
      telegramService.getTelegramMember.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/telegram/members/200/999');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Member not found');
    });

    it('returns server error when service fails', async () => {
      telegramService.getTelegramMember.mockRejectedValueOnce(new Error('db down'));

      const res = await request(app)
        .get('/api/telegram/members/200/321');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to fetch member');
    });
  });

  describe('PATCH /members/:channelId/:userId', () => {
    it('updates member moderation fields', async () => {
      const body = {
        trustLevel: 'trusted',
        permanentlyBlacklisted: false,
        penaltyExpires: '2025-11-04T00:00:00.000Z',
        spamStrikes: 1,
        adminNotes: 'manual override',
        clearPenalty: true,
      };

      const res = await request(app)
        .patch('/api/telegram/members/123/456')
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(telegramService.updateTelegramMember).toHaveBeenCalledWith('123', '456', {
        trustLevel: 'trusted',
        permanentlyBlacklisted: false,
        penaltyExpires: body.penaltyExpires,
        spamStrikes: 1,
        adminNotes: 'manual override',
        clearPenalty: true,
      });
    });

    it('propagates 404 when member not found', async () => {
      telegramService.updateTelegramMember.mockResolvedValueOnce(null);

      const res = await request(app)
        .patch('/api/telegram/members/123/789')
        .send({ trustLevel: 'trusted' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Member not found');
    });

    it('returns 400 when service throws validation error', async () => {
      telegramService.updateTelegramMember.mockRejectedValueOnce(new Error('Invalid trust level'));

      const res = await request(app)
        .patch('/api/telegram/members/123/789')
        .send({ trustLevel: 'INVALID' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid trust level');
    });
  });

  describe('POST /members/:channelId/:userId/unban', () => {
    it('clears permanent ban state', async () => {
      const res = await request(app)
        .post('/api/telegram/members/100/200/unban')
        .send({ trustLevel: 'new', clearStrikes: false });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(telegramService.unbanTelegramMember).toHaveBeenCalledWith('100', '200', {
        trustLevel: 'new',
        clearStrikes: false,
      });
    });

    it('returns 404 when user is not tracked', async () => {
      telegramService.unbanTelegramMember.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/telegram/members/100/404/unban')
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Member not found');
    });

    it('returns 400 for upstream validation errors', async () => {
      telegramService.unbanTelegramMember.mockRejectedValueOnce(new Error('Cannot unban system member'));

      const res = await request(app)
        .post('/api/telegram/members/100/200/unban')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Cannot unban system member');
    });
  });

  describe('GET /spam-stats/:channelId', () => {
    it('returns spam metrics snapshot', async () => {
      const res = await request(app)
        .get('/api/telegram/spam-stats/100');

      expect(res.status).toBe(200);
      expect(res.body.totals.totalMembers).toBe(5);
      expect(telegramService.getTelegramSpamStats).toHaveBeenCalledWith('100');
    });

    it('handles service errors gracefully', async () => {
      telegramService.getTelegramSpamStats.mockRejectedValueOnce(new Error('timeout'));

      const res = await request(app)
        .get('/api/telegram/spam-stats/100');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to fetch spam stats');
    });
  });
});
