import { describe, it, expect } from 'vitest';
import { WikiTool } from '../../../src/services/tools/tools/WikiTool.mjs';

describe('WikiTool', () => {
  const mockLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {}
  };

  const createTool = () => {
    return new WikiTool({
      wikiService: {},
      databaseService: {},
      aiService: {},
      unifiedAIService: {},
      memoryService: {},
      discordService: {},
      knowledgeService: {},
      promptService: {},
      logger: mockLogger
    });
  };

  describe('extractTags', () => {
    it('handles string content correctly', () => {
      const tool = createTool();
      const title = 'Test Article';
      const context = {
        participants: ['User1', 'User2'],
        channelName: 'general-chat'
      };
      const content = 'This is a battle and exploration article.';

      const tags = tool.extractTags(title, context, content);
      
      if (!tags.includes('exploration')) {
        throw new Error(`Expected exploration in ${JSON.stringify(tags)}`);
      }
      
      expect(tags).toContain('test');
    });

    it('handles null content gracefully', () => {
      const tool = createTool();
      const title = 'Test Article';
      const context = { participants: [], channelName: 'general' };
      
      // Should not throw
      const tags = tool.extractTags(title, context, null);
      expect(tags).toBeDefined();
    });

    it('handles undefined content gracefully', () => {
      const tool = createTool();
      const title = 'Test Article';
      const context = { participants: [], channelName: 'general' };
      
      // Should not throw
      const tags = tool.extractTags(title, context, undefined);
      expect(tags).toBeDefined();
    });

    it('handles object content gracefully (regression test)', () => {
      const tool = createTool();
      const title = 'Test Article';
      const context = { participants: [], channelName: 'general' };
      const content = { text: 'some text' }; // Object instead of string
      
      // Should not throw "content.toLowerCase is not a function"
      const tags = tool.extractTags(title, context, content);
      expect(tags).toBeDefined();
    });
  });
});
