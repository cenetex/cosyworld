/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { describe, it, expect } from 'vitest';
import { 
  extractMessageLinks, 
  formatMessageForContext, 
  buildContextSummary 
} from '../../../src/services/discord/messageLinksHelper.mjs';

describe('Discord Message Links Helper', () => {
  describe('extractMessageLinks', () => {
    it('should extract Discord message links from text', () => {
      const text = 'Check this out: https://discord.com/channels/123456789/987654321/111222333';
      const links = extractMessageLinks(text);
      
      expect(links).toHaveLength(1);
      expect(links[0]).toEqual({
        url: 'https://discord.com/channels/123456789/987654321/111222333',
        guildId: '123456789',
        channelId: '987654321',
        messageId: '111222333'
      });
    });

    it('should extract multiple message links', () => {
      const text = `
        First link: https://discord.com/channels/123/456/789
        Second link: https://discord.com/channels/111/222/333
      `;
      const links = extractMessageLinks(text);
      
      expect(links).toHaveLength(2);
      expect(links[0].messageId).toBe('789');
      expect(links[1].messageId).toBe('333');
    });

    it('should handle ptb and canary subdomains', () => {
      const text1 = 'https://ptb.discord.com/channels/123/456/789';
      const text2 = 'https://canary.discord.com/channels/123/456/789';
      
      const links1 = extractMessageLinks(text1);
      const links2 = extractMessageLinks(text2);
      
      expect(links1).toHaveLength(1);
      expect(links2).toHaveLength(1);
    });

    it('should return empty array for text without links', () => {
      const text = 'Just some regular text with no links';
      const links = extractMessageLinks(text);
      
      expect(links).toEqual([]);
    });

    it('should handle null/undefined input', () => {
      expect(extractMessageLinks(null)).toEqual([]);
      expect(extractMessageLinks(undefined)).toEqual([]);
      expect(extractMessageLinks('')).toEqual([]);
    });
  });

  describe('formatMessageForContext', () => {
    it('should format a regular user message', () => {
      const message = {
        author: { username: 'TestUser', bot: false },
        content: 'Hello world!',
        createdAt: new Date('2024-01-01'),
        attachments: new Map()
      };
      
      const formatted = formatMessageForContext(message, false);
      
      expect(formatted).toContain('👤');
      expect(formatted).toContain('TestUser');
      expect(formatted).toContain('Hello world!');
      expect(formatted).not.toContain('⭐');
    });

    it('should mark target messages with star', () => {
      const message = {
        author: { username: 'TestUser' },
        content: 'Target message',
        createdAt: new Date('2024-01-01'),
        attachments: new Map()
      };
      
      const formatted = formatMessageForContext(message, true);
      
      expect(formatted).toContain('⭐');
      expect(formatted).toContain('Target message');
    });

    it('should indicate webhook/bot messages', () => {
      const message = {
        author: { username: 'BotAvatar', bot: true, discriminator: '0000' },
        webhookId: '12345',
        content: 'Bot message',
        createdAt: new Date('2024-01-01'),
        attachments: new Map()
      };
      
      const formatted = formatMessageForContext(message, false);
      
      expect(formatted).toContain('🤖');
      expect(formatted).toContain('BotAvatar');
    });

    it('should note image attachments', () => {
      const attachments = new Map([
        ['1', { contentType: 'image/png' }],
        ['2', { contentType: 'image/jpeg' }]
      ]);
      
      const message = {
        author: { username: 'TestUser' },
        content: 'Check out these images',
        createdAt: new Date('2024-01-01'),
        attachments
      };
      
      const formatted = formatMessageForContext(message, false);
      
      expect(formatted).toContain('[2 images]');
    });

    it('should handle messages with no content', () => {
      const message = {
        author: { username: 'TestUser' },
        content: '',
        createdAt: new Date('2024-01-01'),
        attachments: new Map()
      };
      
      const formatted = formatMessageForContext(message, false);
      
      expect(formatted).toContain('[No text content]');
    });
  });

  describe('buildContextSummary', () => {
    it('should build a complete context summary', () => {
      const link = {
        url: 'https://discord.com/channels/123/456/789',
        guildId: '123',
        channelId: '456',
        messageId: '789'
      };
      
      const context = {
        before: [
          {
            author: { username: 'User1' },
            content: 'Message before',
            createdAt: new Date('2024-01-01'),
            attachments: new Map()
          }
        ],
        target: {
          author: { username: 'User2' },
          content: 'Target message',
          createdAt: new Date('2024-01-01'),
          attachments: new Map()
        },
        after: [
          {
            author: { username: 'User3' },
            content: 'Message after',
            createdAt: new Date('2024-01-01'),
            attachments: new Map()
          }
        ]
      };
      
      const summary = buildContextSummary(context, link);
      
      expect(summary).toContain('Referenced Discord Message');
      expect(summary).toContain(link.url);
      expect(summary).toContain('Context before:');
      expect(summary).toContain('Message before');
      expect(summary).toContain('Referenced message:');
      expect(summary).toContain('Target message');
      expect(summary).toContain('⭐'); // Target marker
      expect(summary).toContain('Context after:');
      expect(summary).toContain('Message after');
      expect(summary).toContain('End Referenced Message');
    });

    it('should handle missing target message', () => {
      const link = {
        url: 'https://discord.com/channels/123/456/789',
        guildId: '123',
        channelId: '456',
        messageId: '789'
      };
      
      const context = {
        before: [],
        target: null,
        after: []
      };
      
      const summary = buildContextSummary(context, link);
      
      expect(summary).toContain('Referenced message not found');
      expect(summary).toContain(link.url);
    });
  });
});
