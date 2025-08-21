/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Tribes Tab
 * Displays tribes and their members
 */

import { TribesAPI } from '../core/api.js';
import { setLoading, setError, setEmpty, escapeHtml } from '../utils/dom.js';
import { generateFallbackAvatar } from '../utils/fallbacks.js';

/**
 * Load tribes tab content
 */
export async function loadContent() {
  const content = document.getElementById("content");
  if (!content) return;
  window.loadContent = loadContent; // expose for retry

  setLoading(content, { message: 'Loading tribes' });

  try {
    // Get tribe counts
    const tribeCounts = await TribesAPI.getCounts();

    if (!tribeCounts || tribeCounts.length === 0) {
      setEmpty(content, { title: 'No Tribes Found', description: 'No tribes are available at this time.' });
      return;
    }

    // Render main tribes view
    content.innerHTML = `
      <div class="max-w-7xl mx-auto px-4">
        <h1 class="text-3xl font-bold mb-6">Tribes</h1>
        <div class="bg-gray-800/50 p-6 rounded-lg mb-8">
          <p class="text-lg">Tribes are groups of avatars that share the same emoji identifier. Each tribe has its own characteristics and traits.</p>
        </div>
        
        <div id="tribes-content">
          <div id="tribes-grid" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"></div>
        </div>
        
        <div id="tribe-details" class="hidden mt-8">
          <button 
            id="back-to-tribes" 
            class="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded mb-6 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to tribes
          </button>
          
          <div class="flex items-center gap-4 mb-6">
            <div id="tribe-emoji" class="text-5xl"></div>
            <h2 class="text-3xl font-bold">Tribe <span id="tribe-name"></span></h2>
          </div>
          
          <div id="tribe-members" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4"></div>
        </div>
      </div>
    `;

    const tribesContent = document.getElementById('tribes-content');
    const tribesGrid = document.getElementById('tribes-grid');
    const tribeDetails = document.getElementById('tribe-details');

    // Render tribe cards
    renderTribesGrid(tribesGrid, tribeCounts);

    // Set up back button handler
    document.getElementById('back-to-tribes').addEventListener('click', () => {
      tribesContent.classList.remove('hidden');
      tribeDetails.classList.add('hidden');
    });

    // Make global function available for showing tribe details
    window.showTribeDetailsContent = showTribeDetailsContent;

  } catch (err) {
    console.error("Load Tribes error:", err);
    setError(content, `Failed to load tribes: ${escapeHtml(err.message)}`, { retryFnName: 'loadContent' });
  }
}

// Empty state handled directly with setEmpty

/**
 * Render tribes grid
 * @param {HTMLElement} container - Container element
 * @param {Array} tribes - List of tribes to render
 */
function renderTribesGrid(container, tribes) {
  container.innerHTML = tribes.map(tribe => `
    <div 
      class="tribe-card bg-gray-800 rounded-lg p-5 flex flex-col items-center hover:bg-gray-700 transition-colors cursor-pointer"
      data-emoji="${escapeHtml(tribe.emoji)}" 
      onclick="showTribeDetailsContent('${escapeHtml(tribe.emoji)}')"
    >
      <div class="text-5xl mb-3">${escapeHtml(tribe.emoji)}</div>
      <div class="text-xl font-bold">Tribe ${escapeHtml(tribe.emoji)}</div>
      <div class="text-gray-400 mt-2">
        ${tribe.count} ${tribe.count === 1 ? 'member' : 'members'}
      </div>
    </div>
  `).join('');
}

/**
 * Show details for a specific tribe
 * @param {string} emoji - Tribe emoji
 */
export async function showTribeDetailsContent(emoji) {
  try {
    const tribesContent = document.getElementById('tribes-content');
    const tribeDetails = document.getElementById('tribe-details');
    const tribeEmoji = document.getElementById('tribe-emoji');
    const tribeName = document.getElementById('tribe-name');
    const tribeMembers = document.getElementById('tribe-members');
    let nextCursor = null;
    const limit = 24;

    // Update UI
    tribesContent.classList.add('hidden');
    tribeDetails.classList.remove('hidden');
    tribeEmoji.textContent = emoji;
    tribeName.textContent = emoji;

    // Show loading state
    setLoading(tribeMembers, { message: 'Loading tribe members' });

    async function fetchPage() {
      const qs = new URLSearchParams({ limit: String(limit), thumbs: '0' });
      if (nextCursor) qs.set('after', nextCursor);
      const tribeData = await TribesAPI.getTribeByEmoji(emoji + `?${qs.toString()}`);
      nextCursor = tribeData?.nextCursor || null;
      return tribeData?.members || [];
    }

    // First page
    const firstMembers = await fetchPage();
    if (!firstMembers || firstMembers.length === 0) {
      setEmpty(tribeMembers, { title: 'No Members Found', description: 'No members found for this tribe' });
      return;
    }

    tribeMembers.innerHTML = '';
    renderTribeMembers(tribeMembers, firstMembers, emoji);

    // Add load more button
    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.className = 'col-span-full mt-4 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded';
    loadMoreBtn.textContent = 'Load more';
    loadMoreBtn.addEventListener('click', async () => {
      loadMoreBtn.disabled = true;
      loadMoreBtn.textContent = 'Loading...';
      try {
        const next = await fetchPage();
        if (next.length) {
          renderTribeMembers(tribeMembers, next, emoji);
          if (nextCursor) {
            loadMoreBtn.textContent = 'Load more';
            loadMoreBtn.disabled = false;
          } else {
            loadMoreBtn.textContent = 'No more members';
          }
        } else {
          loadMoreBtn.textContent = 'No more members';
        }
      } catch (e) {
        console.error(e);
        loadMoreBtn.textContent = 'Load more';
        loadMoreBtn.disabled = false;
      }
    });
    tribeMembers.appendChild(loadMoreBtn);

    // Optional: infinite scroll
    const sentinel = document.createElement('div');
    sentinel.className = 'col-span-full h-6';
    tribeMembers.appendChild(sentinel);
    const io = new IntersectionObserver(async (entries) => {
      const entry = entries[0];
      if (entry.isIntersecting && !loadMoreBtn.disabled) {
        loadMoreBtn.click();
      }
    }, { rootMargin: '200px' });
    io.observe(sentinel);

  } catch (err) {
    console.error("Show Tribe Details error:", err);
    const tribeMembers = document.getElementById('tribe-members');
    if (tribeMembers) {
      setError(tribeMembers, `Failed to load tribe members: ${escapeHtml(err.message)}`, { retryFnName: 'showTribeDetailsContent' });
      window.showTribeDetailsContent = () => showTribeDetailsContent(emoji); // bind emoji for retry
    }
  }
}

/**
 * Render tribe members
 * @param {HTMLElement} container - Container element
 * @param {Array} members - List of members to render
 * @param {string} emoji - Tribe emoji
 */
function renderTribeMembers(container, members, emoji) {
  const memberCards = members.map(member => {
    const safeName = escapeHtml(member.name || 'Unknown');
    const initial = safeName.charAt(0).toUpperCase();
    const imgUrl = member.thumbnailUrl || member.imageUrl;
    const fallbackSrc = generateFallbackAvatar(initial);
    
    return `
      <div 
        class="bg-gray-800 p-3 rounded-lg hover:bg-gray-700 transition-colors cursor-pointer"
        onclick="showAvatarDetails('${member._id}')"
      >
        <div class="flex items-center gap-3">
          ${imgUrl
            ? `<img 
                src="${imgUrl}" 
                alt="${safeName}" 
                class="w-16 h-16 object-cover rounded-full"
                onerror="this.onerror=null; this.src='${fallbackSrc}';"
              >` 
            : `<div class="w-16 h-16 rounded-full bg-gray-700 flex items-center justify-center text-2xl font-bold text-white">
                ${initial}
              </div>` 
          }
          <div class="flex-1 min-w-0">
            <h3 class="text-lg font-semibold truncate">${safeName}</h3>
            <div class="text-xs text-gray-400 mt-1">
              ${member.messageCount || 0} messages
            </div>
          </div>
          <div class="text-xl">${escapeHtml(emoji)}</div>
        </div>
      </div>
    `;
  }).join('');
  
  container.insertAdjacentHTML('beforeend', memberCards);
}