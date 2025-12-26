/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { describe, it, expect } from 'vitest';
import { stripUrls, extractUrls, containsUrl } from '../../src/utils/contentFilter.mjs';

describe('contentFilter', () => {
  describe('stripUrls', () => {
    it('should strip plain URLs', () => {
      const text = 'Check out https://example.com for more info';
      const result = stripUrls(text);
      expect(result).toBe('Check out for more info');
    });

    it('should preserve markdown links with media file extensions', () => {
      const text = '-# [ 📸 [Snapshot taken.](https://cdn.example.com/image.png) ]';
      const result = stripUrls(text);
      expect(result).toBe('-# [ 📸 [Snapshot taken.](https://cdn.example.com/image.png) ]');
    });

    it('should preserve markdown links to cloudfront CDN', () => {
      const text = '[View image](https://d1234.cloudfront.net/images/selfie_123.png)';
      const result = stripUrls(text, { allowedDomains: ['cloudfront.net'] });
      expect(result).toBe('[View image](https://d1234.cloudfront.net/images/selfie_123.png)');
    });

    it('should preserve markdown links to S3', () => {
      const text = '[Photo](https://bucket.s3.amazonaws.com/photo.jpg)';
      const result = stripUrls(text, { allowedDomains: ['amazonaws.com'] });
      expect(result).toBe('[Photo](https://bucket.s3.amazonaws.com/photo.jpg)');
    });

    it('should strip non-media markdown links when URL is not allowed', () => {
      const text = '[Click here](https://malicious-site.com/page)';
      const result = stripUrls(text);
      expect(result).toBe('Click here');
    });

    it('should handle mixed content correctly', () => {
      const text = 'Check https://bad.com [image](https://cdn.cloudfront.net/pic.png) more text';
      const result = stripUrls(text, { allowedDomains: ['cloudfront.net'] });
      expect(result).toBe('Check [image](https://cdn.cloudfront.net/pic.png) more text');
    });

    it('should strip URLs but preserve allowed domain URLs outside markdown', () => {
      const text = 'Bad: https://evil.com Good: https://mycdn.cloudfront.net/img.png';
      const result = stripUrls(text, { allowedDomains: ['cloudfront.net'] });
      expect(result).toBe('Bad: Good: https://mycdn.cloudfront.net/img.png');
    });

    it('should preserve jpeg/gif/webp extensions in markdown links', () => {
      const testCases = [
        { ext: 'jpeg', text: '[img](https://example.com/test.jpeg)' },
        { ext: 'gif', text: '[img](https://example.com/test.gif)' },
        { ext: 'webp', text: '[img](https://example.com/test.webp)' },
        { ext: 'mp4', text: '[video](https://example.com/test.mp4)' },
      ];
      
      for (const tc of testCases) {
        const result = stripUrls(tc.text);
        expect(result).toBe(tc.text);
      }
    });

    it('should not break the selfie tool output format', () => {
      const selfieTool = '-# [ 📸 [Snapshot taken.](https://d123abc.cloudfront.net/selfies/avatar_123456.png) ]';
      const result = stripUrls(selfieTool, { 
        allowedDomains: ['cloudfront.net', 'amazonaws.com'],
        preserveMarkdownLinks: true 
      });
      expect(result).toBe(selfieTool);
    });
  });

  describe('containsUrl', () => {
    it('should detect https URLs', () => {
      expect(containsUrl('Visit https://example.com')).toBe(true);
    });

    it('should detect http URLs', () => {
      expect(containsUrl('Visit http://example.com')).toBe(true);
    });

    it('should return false for text without URLs', () => {
      expect(containsUrl('No links here')).toBe(false);
    });
  });

  describe('extractUrls', () => {
    it('should extract all URLs from text', () => {
      const text = 'Check https://a.com and https://b.com for info';
      const urls = extractUrls(text);
      expect(urls).toContain('https://a.com');
      expect(urls).toContain('https://b.com');
    });
  });
});
