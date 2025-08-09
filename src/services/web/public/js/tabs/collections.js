/**
 * Collections Tab
 * Displays NFT collections and their avatars
 */

import { CollectionsAPI } from '../core/api.js';

export async function loadContent() {
  const content = document.getElementById('content');
  if (!content) return;

  content.innerHTML = `
    <div class="max-w-7xl mx-auto px-4">
      <h1 class="text-3xl font-bold mb-6">Collections</h1>
      <div id="collections-grid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8"></div>
      <div id="collection-view" class="hidden">
        <button id="back-to-collections" class="mb-4 px-3 py-1.5 bg-surface-800 rounded hover:bg-surface-700">← Back</button>
        <h2 id="collection-title" class="text-2xl font-semibold mb-2"></h2>
        <p id="collection-desc" class="text-gray-400 mb-4"></p>
        <div id="collection-members" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3"></div>
        <div id="collection-loader" class="text-center py-8 hidden">
          <div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-600 mx-auto"></div>
          <p class="mt-2 text-gray-400">Loading more...</p>
        </div>
      </div>
    </div>`;

  // Load collections list
  const grid = document.getElementById('collections-grid');
  const { collections } = await CollectionsAPI.list({ limit: 60 });
  if (!collections?.length) {
    grid.innerHTML = '<div class="col-span-full text-center text-gray-400">No collections found.</div>';
  } else {
    grid.innerHTML = collections.map(renderCollectionCard).join('');
    grid.querySelectorAll('[data-coll]').forEach(el => {
      el.addEventListener('click', () => openCollection(
        decodeURIComponent(el.dataset.coll),
        el.dataset.name ? decodeURIComponent(el.dataset.name) : undefined,
        el.dataset.desc ? decodeURIComponent(el.dataset.desc) : undefined
      ));
    });
  }

  // Back
  document.getElementById('back-to-collections').addEventListener('click', () => {
    document.getElementById('collection-view').classList.add('hidden');
    grid.classList.remove('hidden');
  });

  async function openCollection(id, name, description) {
    grid.classList.add('hidden');
    const view = document.getElementById('collection-view');
    view.classList.remove('hidden');
    document.getElementById('collection-title').textContent = name || id;
    document.getElementById('collection-desc').textContent = description || '';
    const container = document.getElementById('collection-members');
    const loader = document.getElementById('collection-loader');

    container.innerHTML = '';
    let nextCursor = null; let loading = false; let hasMore = true;

    async function loadMore() {
      if (loading || !hasMore) return; loading = true; loader.classList.remove('hidden');
      try {
        const res = await CollectionsAPI.members(id, { limit: 30, after: nextCursor, thumbs: 1 });
        (res.avatars || []).forEach(av => {
          const div = document.createElement('div');
          div.className = 'cursor-pointer hover:bg-surface-800 rounded p-2';
          div.innerHTML = renderAvatarCard(av);
          div.onclick = () => window.showAvatarDetails && window.showAvatarDetails(av._id);
          container.appendChild(div);
        });
        nextCursor = res.nextCursor;
        hasMore = !!nextCursor;
      } finally {
        loading = false;
        loader.classList.toggle('hidden', !hasMore);
      }
    }

    // Expose and prime
    window.loadMoreCollection = loadMore;
    await loadMore();

    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) loadMore();
    }, { threshold: 0.2 });
    observer.observe(loader);
  }
}

function renderCollectionCard(c) {
  const safeName = (c.name || c.key || c.id).toString();
  const desc = (c.description || '').toString();
  return `
    <div data-coll="${encodeURIComponent(c.id)}" data-name="${encodeURIComponent(safeName)}" data-desc="${encodeURIComponent(desc)}"
         class="flex items-start gap-3 p-3 rounded-lg bg-surface-800 hover:bg-surface-700 cursor-pointer" >
  <img src="${c.thumbnailUrl}" alt="${safeName}" class="w-12 h-12 rounded object-cover border border-surface-700 flex-shrink-0"
       onerror="this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'48\' height=\'48\' viewBox=\'0 0 100 100\'%3E%3Crect fill=\'%23333\' width=\'100\' height=\'100\'/%3E%3Ctext fill=\'%23FFF\' x=\'50\' y=\'50\' font-size=\'40\' text-anchor=\'middle\' dominant-baseline=\'middle\'%3E${safeName.slice(0,1).toUpperCase()}%3C/text%3E%3C/svg%3E';"/>
      <div class="flex-1 min-w-0">
        <div class="font-semibold truncate">${safeName}</div>
        ${desc ? `<div class="text-xs text-gray-400 line-clamp-2">${desc}</div>` : ''}
        <div class="text-xs text-gray-500 mt-1">${c.count} avatars</div>
      </div>
    </div>`;
}

function renderAvatarCard(av) {
  const url = av.thumbnailUrl || av.imageUrl;
  const initial = (av.name || '?').slice(0,1).toUpperCase();
  return `
    <div class="flex flex-col items-center">
      <img src="${url}" alt="${av.name}" class="w-24 h-24 rounded-full object-cover border border-surface-700"
           onerror="this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'100\' height=\'100\' viewBox=\'0 0 100 100\'%3E%3Crect fill=\'%23333\' width=\'100\' height=\'100\'/%3E%3Ctext fill=\'%23FFF\' x=\'50\' y=\'50\' font-size=\'50\' text-anchor=\'middle\' dominant-baseline=\'middle\'%3E${initial}%3C/text%3E%3C/svg%3E';">
      <div class="mt-2 text-sm font-medium truncate w-full text-center" title="${av.name}">${av.name}</div>
    </div>`;
}
