/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Leaderboard Tab
 * Displays avatar rankings
 */

import { LeaderboardAPI, ClaimsAPI } from '../core/api.js';
import { state } from '../core/state.js';
import { setLoading, setError, setEmpty, escapeHtml } from '../utils/dom.js';
import { generateFallbackAvatar } from '../utils/fallbacks.js';

/**
 * Load leaderboard tab content
 */
export async function loadContent() {
  const content = document.getElementById("content");
  if (!content) return;
  
  setLoading(content, { message: 'Loading leaderboard' });
  
  try {
    content.innerHTML = `
      <div class="max-w-7xl mx-auto px-4">
        <div class="mb-6">
          <h1 class="text-4xl font-bold mb-2">Top Avatars</h1>
          <p class="text-gray-400">Discover and claim the most active community members</p>
        </div>
        
        <div class="mb-6 flex gap-3 flex-wrap">
          <input 
            id="lb-filter-collection" 
            class="bg-gray-800 rounded-lg px-4 py-2 flex-1 min-w-[200px] border border-gray-700 focus:border-purple-500 focus:outline-none" 
            placeholder="🔍 Search by collection..." 
          />
          <select 
            id="lb-filter-claimed" 
            class="bg-gray-800 rounded-lg px-4 py-2 border border-gray-700 focus:border-purple-500 focus:outline-none"
          >
            <option value="">All Avatars</option>
            <option value="false">Available Only</option>
            <option value="true">Claimed Only</option>
          </select>
        </div>
        
        <div id="leaderboard-items" class="grid grid-cols-1 lg:grid-cols-2 gap-4"></div>
        
        <div id="leaderboard-loader" class="text-center py-12 hidden">
          <div class="animate-spin rounded-full h-10 w-10 border-4 border-purple-600 border-t-transparent mx-auto"></div>
          <p class="mt-4 text-gray-400">Loading more avatars...</p>
        </div>
      </div>`;

    // Set up window scroll state for infinite scrolling
    if (state.activeTab === "leaderboard") {
      window.scrollState = {
        page: 1,
        loading: false,
        hasMore: true,
        initialized: false,
      };
    } else {
      window.scrollState = window.scrollState || {
        page: 1,
        loading: false,
        hasMore: true,
      };
    }

    // Load initial data
  const filters = getFilters();
  const data = await LeaderboardAPI.getLeaderboard({ page: 1, limit: 12, ...filters });
    const leaderboardItems = document.getElementById("leaderboard-items");
    const loader = document.getElementById("leaderboard-loader");

    if (!data.avatars || data.avatars.length === 0) {
      setEmpty(leaderboardItems, { 
        title: 'No Avatars Found', 
        description: 'Try adjusting your filters or check back later for new avatars.' 
      });
      return;
    }

    // Check claim status for each avatar
    const avatarsWithClaimStatus = await Promise.all(data.avatars.map(async avatar => {
      try {
        const claimStatusRes = await ClaimsAPI.getStatus(avatar._id);
        return {
          ...avatar,
          isClaimed: claimStatusRes.claimed || false,
          claimedBy: claimStatusRes.claimedBy || ''
        };
      } catch (err) {
        console.warn(`Failed to get claim status for avatar ${avatar._id}:`, err);
        return {
          ...avatar,
          isClaimed: false,
          claimedBy: ''
        };
      }
    }));

    renderLeaderboardItems(leaderboardItems, avatarsWithClaimStatus);
  setupFilterHandlers(() => reloadLeaderboard(leaderboardItems, loader));
  setupInfiniteScroll(loader, leaderboardItems);

  } catch (err) {
    console.error("Load Leaderboard error:", err);
    setError(content, `Failed to load leaderboard: ${escapeHtml(err.message)}`, { retryFnName: 'loadContent' });
  }
}

/**
 * Render empty state when no avatars found
 * @param {HTMLElement} container - Container element
 */
function renderEmptyState(container) {
  setEmpty(container, { 
    title: 'No Avatars Found', 
    description: 'Try adjusting your filters or check back later for new avatars.' 
  });
}

/**
 * Render leaderboard items
 * @param {HTMLElement} container - Container element
 * @param {Array} avatars - List of avatars to render
 */
function renderLeaderboardItems(container, avatars) {
  // Try to use AvatarDetails component if available
  const { renderLeaderboardCard } = window.AvatarDetails || {};
  
  // Create HTML for leaderboard items
  const itemsHTML = avatars.map(avatar => `
    <div onclick="showAvatarDetails('${avatar._id}')" class="cursor-pointer">
      ${typeof renderLeaderboardCard === 'function' 
        ? renderLeaderboardCard(avatar, avatar.isClaimed)
        : defaultRenderLeaderboardCard(avatar, avatar.isClaimed)}
    </div>
  `).join('');
  
  // Add to container
  container.innerHTML = itemsHTML;
}

/**
 * Default leaderboard card renderer if AvatarDetails component is not available
 * @param {Object} avatar - Avatar data
 * @param {boolean} isClaimed - Whether the avatar is claimed
 * @returns {string} - Leaderboard card HTML
 */
function defaultRenderLeaderboardCard(avatar, isClaimed) {
  const safeName = escapeHtml(avatar.name || 'Unknown');
  const initial = safeName.charAt(0).toUpperCase();
  const fallbackSrc = generateFallbackAvatar(initial);
  
  // Simplify activity display
  const getActivityBadge = (lastActive) => {
    if (!lastActive) return { text: 'Inactive', color: 'bg-gray-500' };
    const hoursSince = (Date.now() - new Date(lastActive)) / (1000 * 60 * 60);
    if (hoursSince < 1) return { text: 'Active now', color: 'bg-green-500' };
    if (hoursSince < 24) return { text: 'Active today', color: 'bg-blue-500' };
    if (hoursSince < 168) return { text: 'This week', color: 'bg-purple-500' };
    return { text: 'Inactive', color: 'bg-gray-500' };
  };
  
  const activity = getActivityBadge(avatar.lastActiveAt);
  const score = avatar.score || 0;

  return `
    <div class="avatar-card bg-gray-800 p-4 rounded-lg hover:bg-gray-700 transition-all hover:scale-105 ${isClaimed ? 'ring-2 ring-green-500' : ''}">
      <div class="flex gap-4 items-start">
        <div class="relative flex-shrink-0">
          <img 
            src="${avatar.thumbnailUrl || avatar.imageUrl}" 
            alt="${safeName}" 
            class="w-20 h-20 object-cover rounded-full border-2 border-gray-600"
            onerror="this.onerror=null; this.src='${fallbackSrc}';"
          >
          ${isClaimed ? `<div class="absolute -top-1 -right-1 bg-green-500 rounded-full w-6 h-6 flex items-center justify-center text-sm shadow-lg">✓</div>` : ''}
        </div>
        
        <div class="flex-1 min-w-0">
          <div class="flex items-start justify-between gap-2">
            <h3 class="text-lg font-bold truncate">${safeName}</h3>
            <span class="text-2xl font-bold text-purple-400">${score}</span>
          </div>
          
          <div class="flex items-center gap-2 mt-2">
            <span class="px-2 py-1 rounded text-xs font-medium ${activity.color} text-white">
              ${activity.text}
            </span>
            ${isClaimed ? `<span class="px-2 py-1 rounded text-xs font-medium bg-green-900 text-green-300">Claimed</span>` : `<span class="px-2 py-1 rounded text-xs font-medium bg-blue-900 text-blue-300">Available</span>`}
          </div>
          
          ${avatar.personality ? `<p class="text-xs text-gray-400 mt-2 line-clamp-2">${escapeHtml(avatar.personality.substring(0, 80))}...</p>` : ''}
        </div>
      </div>
    </div>
  `;
}

/**
 * Set up infinite scroll for leaderboard
 * @param {HTMLElement} loader - Loader element
 * @param {HTMLElement} container - Container for items
 */
function setupInfiniteScroll(loader, container) {
  if (!loader || !container) return;
  
  // Make loadMore function available globally
  window.loadMoreLeaderboard = async () => {
    if (window.scrollState.loading || !window.scrollState.hasMore) return;

    window.scrollState.loading = true;
    loader.classList.remove("hidden");

    try {
  const nextPage = window.scrollState.page + 1;
  const filters = getFilters();
  const moreData = await LeaderboardAPI.getLeaderboard({ page: nextPage, limit: 12, ...filters });

      if (!moreData.avatars || moreData.avatars.length === 0) {
        window.scrollState.hasMore = false;
        loader.classList.add("hidden");
        return;
      }

      // Check claim status for each avatar
      const avatarsWithClaimStatus = await Promise.all(moreData.avatars.map(async avatar => {
        try {
          const claimStatusRes = await ClaimsAPI.getStatus(avatar._id);
          return {
            ...avatar,
            isClaimed: claimStatusRes.claimed || false,
            claimedBy: claimStatusRes.claimedBy || ''
          };
        } catch (err) {
          console.warn(`Failed to get claim status for avatar ${avatar._id}:`, err);
          return {
            ...avatar,
            isClaimed: false,
            claimedBy: ''
          };
        }
      }));

      // Create document fragment to append new items
      const fragment = document.createDocumentFragment();
      avatarsWithClaimStatus.forEach(avatar => {
        const div = document.createElement("div");
        div.className = "cursor-pointer";
        div.onclick = () => window.showAvatarDetails(avatar._id);
        
        // Try to use AvatarDetails component if available
        const { renderLeaderboardCard } = window.AvatarDetails || {};
        div.innerHTML = typeof renderLeaderboardCard === 'function'
          ? renderLeaderboardCard(avatar, avatar.isClaimed)
          : defaultRenderLeaderboardCard(avatar, avatar.isClaimed);
          
        fragment.appendChild(div);
      });

      container.appendChild(fragment);
      window.scrollState.page = nextPage;

    } catch (err) {
      console.error("Failed to load more leaderboard items:", err);
      const errorDiv = document.createElement("div");
      errorDiv.className = "col-span-full text-center py-4 text-red-500";
      errorDiv.innerHTML = `
        Error loading more items: ${err.message}
        <button class="ml-2 px-3 py-1 bg-blue-600 text-white rounded" onclick="loadMoreLeaderboard()">
          Retry
        </button>
      `;
      container.appendChild(errorDiv);
    } finally {
      window.scrollState.loading = false;
      if (window.scrollState.hasMore) {
        loader.classList.remove("hidden");
      } else {
        loader.classList.add("hidden");
      }
    }
  };

  // Set up intersection observer for infinite scroll
  const observer = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting && !window.scrollState.loading && window.scrollState.hasMore) {
      window.loadMoreLeaderboard();
    }
  }, { threshold: 0.1 });

  observer.observe(loader);
  loader.classList.remove("hidden");
}

function getFilters() {
  const collection = document.getElementById('lb-filter-collection')?.value?.trim();
  const claimed = document.getElementById('lb-filter-claimed')?.value;
  const params = {};
  if (collection) params.collection = collection;
  if (claimed) params.claimed = claimed;
  return params;
}

function setupFilterHandlers(onChange) {
  const ids = ['lb-filter-collection', 'lb-filter-claimed'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', onChange);
    if (el.tagName === 'INPUT') {
      el.addEventListener('keyup', (e) => { if (e.key === 'Enter') onChange(); });
    }
  });
}

async function reloadLeaderboard(container, loader) {
  container.innerHTML = '';
  window.scrollState = { page: 1, loading: false, hasMore: true };
  const filters = getFilters();
  const data = await LeaderboardAPI.getLeaderboard({ page: 1, limit: 12, ...filters });
  if (!data.avatars?.length) {
    renderEmptyState(container); return;
  }
  const avatarsWithClaimStatus = await Promise.all(data.avatars.map(async avatar => {
    try {
      const claimStatusRes = await ClaimsAPI.getStatus(avatar._id);
      return { ...avatar, isClaimed: claimStatusRes.claimed || false, claimedBy: claimStatusRes.claimedBy || '' };
    } catch { return { ...avatar, isClaimed: false, claimedBy: '' }; }
  }));
  renderLeaderboardItems(container, avatarsWithClaimStatus);
  setupInfiniteScroll(loader, container);
}