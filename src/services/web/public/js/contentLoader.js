/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { loadSquad } from './tabs/squad.js';
import { loadActionLog } from './tabs/actions.js';
import { loadLeaderboard } from './tabs/leaderboard.js';
import { loadTribes } from './tabs/tribes.js';
import { loadSocialContent } from './tabs/social.js';
import { loadCollections } from './tabs/collections.js';

export function initializeContentLoader() {
  window.loadContent = async function () {
    const content = document.getElementById("content");
    const activeAtStart = (window.state?.activeTab) || 'unknown';
    const cacheKey = activeAtStart;
    const now = Date.now();
    window.__tabCache = window.__tabCache || new Map();
    window.__tabLoadSeq = (window.__tabLoadSeq || 0) + 1;
    const mySeq = window.__tabLoadSeq;
    const cached = window.__tabCache.get(cacheKey);
    const TTL = 15_000; // 15s reuse
    if (cached && (now - cached.when) < TTL) {
      // Prevent stale render if tab changed after scheduling
      if (activeAtStart === window.state?.activeTab && mySeq === window.__tabLoadSeq) {
        content.innerHTML = cached.html;
      }
      return; // Serve from cache
    }
    const safeLabel = activeAtStart.replace(/[^a-z0-9_-]/gi,'');
    content.innerHTML = `<div class="text-center py-12">Loading ${safeLabel}...</div>`;
    const state = window.state || {};
    try {
      switch (state.activeTab) {
        case "squad":
          await loadSquad();
          break;
        case "actions":
          await loadActionLog();
          break;
        case "leaderboard":
          await loadLeaderboard();
          break;
        case "tribes":
          await loadTribes();
          break;
        case "social":
          await loadSocialContent();
          break;
        case "collections":
          await loadCollections();
          break;
        default:
          content.innerHTML = `<div class="text-center py-12 text-red-500">Unknown tab: ${state.activeTab}</div>`;
      }
      // Only commit & cache if still the latest load and tab unchanged
      if (mySeq === window.__tabLoadSeq && activeAtStart === window.state?.activeTab) {
        window.__tabCache.set(cacheKey, { when: now, html: content.innerHTML });
      }
    } catch (err) {
      console.error("Content load error:", err);
      if (mySeq === window.__tabLoadSeq && activeAtStart === window.state?.activeTab) {
        content.innerHTML = `<div class="text-center py-12 text-red-500">${err.message}</div>`;
      }
    }
  };
}
