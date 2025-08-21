/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Content Loader
 * Handles loading content based on active tab
 */

import { state, setLoading } from './state.js';
import { showToast } from '../utils/toast.js';

// In-memory tab HTML cache and sequence guard
const TAB_CACHE_TTL = 15000; // 15 seconds
const tabCache = new Map(); // tab -> { when, html }
let loadSeq = 0;

/**
 * Initialize content loader
 */
export function initializeContentLoader() {
  // Make loadContent available globally for backward compatibility
  window.loadContent = loadContent;
}

/**
 * Load content based on active tab
 */
export async function loadContent() {
  const content = document.getElementById('content');
  if (!content) return;
  const tabAtStart = state.activeTab;
  const seq = ++loadSeq;

  // Cache hit
  const cached = tabCache.get(tabAtStart);
  const now = Date.now();
  if (cached && (now - cached.when) < TAB_CACHE_TTL) {
    content.innerHTML = cached.html;
    return;
  }

  content.innerHTML = `<div class="p-8 flex justify-center items-center"><div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div></div>`;
  setLoading(true);

  try {
    await loadTabContent(tabAtStart);
    if (seq === loadSeq && tabAtStart === state.activeTab) {
      tabCache.set(tabAtStart, { when: Date.now(), html: content.innerHTML });
    }
  } catch (err) {
    if (seq !== loadSeq || tabAtStart !== state.activeTab) return; // stale
    console.error('Content load error:', err);
    content.innerHTML = `<div class=\"text-center py-12 text-red-500\"><p>Failed to load ${tabAtStart}: ${err.message}</p><button class=\"mt-4 px-4 py-2 bg-primary-600 text-white rounded\" onclick=\"loadContent()\">Retry</button></div>`;
    showToast(`Failed to load ${tabAtStart}: ${err.message}`, { type: 'error' });
  } finally {
    if (seq === loadSeq) setLoading(false);
  }
}

/**
 * Load content for a specific tab
 * @param {string} tabName - Name of the tab to load
 */
async function loadTabContent(tabName) {
  try {
    // Import the tab module dynamically
    const module = await import(`../tabs/${tabName}.js`);
    
    // Call the loader function from the module
    if (typeof module.loadContent === 'function') {
      await module.loadContent();
    } else if (typeof module[`load${capitalize(tabName)}`] === 'function') {
      // Backward compatibility for older naming pattern
      await module[`load${capitalize(tabName)}`]();
    } else {
      throw new Error(`No content loader found for tab "${tabName}"`);
    }
  } catch (err) {
    console.error(`Error loading ${tabName} tab:`, err);
    throw err;
  }
}

/**
 * Capitalize the first letter of a string
 * @param {string} str - String to capitalize
 * @returns {string} - Capitalized string
 */
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}