/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Social Tab
 * Displays social feed content
 */

import { SocialAPI } from '../core/api.js';
import { state } from '../core/state.js';
import { formatDate } from '../utils/formatting.js';
import { setEmpty, setError, escapeHtml } from '../utils/dom.js';
import { addImageFallback } from '../utils/fallbacks.js';

/**
 * Load social tab content
 */
export async function loadSocialContent() {
  const content = document.getElementById("content");
  if (!content) return;
  
  try {
    const data = await SocialAPI.getPosts({ sort: state.socialSort });
    
    if (!data || !data.posts|| data.posts.length === 0) {
      renderEmptyState(content);
      return;
    }
    renderSocialFeed(content, data.posts);
  } catch (err) {
    console.error("Load Social Content error:", err);
    setError(content, `Failed to load social content: ${err.message}`, { retryFnName: 'loadSocialContent' });
  }
}

/**
 * Render empty state when no posts found
 * @param {HTMLElement} container - Container element
 */
function renderEmptyState(container) {
  setEmpty(container, { title: 'No Social Posts Found', description: 'There are no social posts to display at this time.' });
}

/**
 * Render social feed
 * @param {HTMLElement} container - Container element
 * @param {Array} posts - List of posts to render
 */
function renderSocialFeed(container, posts) {
  container.innerHTML = `
    <div class="max-w-6xl mx-auto px-4">
      <div class="flex flex-col md:flex-row justify-between items-center mb-6">
        <h2 class="text-4xl font-bold text-white">Social Feed</h2>
        <div>
          <button data-sort="new" class="${state.socialSort === 'new' ? 'bg-blue-600' : 'bg-gray-700'} px-4 py-2 rounded">Latest</button>
          <button data-sort="top" class="${state.socialSort === 'top' ? 'bg-blue-600' : 'bg-gray-700'} px-4 py-2 rounded">Top</button>
        </div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        ${posts.map(post => {
          const name = escapeHtml(post.avatar?.name || 'Unknown');
          const content = escapeHtml(post.content || '');
            const id = escapeHtml(post.avatar?._id || '');
          const img = escapeHtml(post.avatar?.thumbnailUrl || post.avatar?.imageUrl || '');
          return `
          <div class=\"bg-gray-800 rounded-lg p-6\">
            <div class=\"flex items-center gap-3 mb-3\">
              <img src=\"${img}\" class=\"w-12 h-12 rounded-full\" alt=\"${name}\">
              <div>
                <div class=\"font-bold text-xl text-white\">${name}</div>
                <div class=\"text-sm text-gray-400\">${formatDate(post.timestamp)}</div>
              </div>
            </div>
            <p class=\"mb-4 text-lg text-gray-100\">${content}</p>
            <div class=\"flex justify-end\">
              <button data-view-avatar=\"${id}\" class=\"text-blue-400 hover:text-blue-300 text-sm\">View Avatar</button>
            </div>
          </div>`;}).join('')}
      </div>
    </div>`;
  container.querySelectorAll('img').forEach(img => addImageFallback(img, 'avatar', img.getAttribute('alt')));
  // Sorting buttons
  container.querySelectorAll('[data-sort]').forEach(btn => btn.addEventListener('click', () => {
    const sort = btn.getAttribute('data-sort');
    state.socialSort = sort; window.loadContent?.();
  }));
  container.querySelectorAll('[data-view-avatar]').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.getAttribute('data-view-avatar');
    window.showAvatarDetails && window.showAvatarDetails(id);
  }));
}