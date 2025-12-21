// Wait for admin bootstrap to be ready
let api, ui;

function initGlobals() {
  api = window.AdminAPI;
  ui = window.AdminUI;
}

async function fetchSecrets() {
  return api.apiFetch('/api/secrets');
}

function renderItem(item) {
  const wrapper = document.createElement('div');
  wrapper.className = 'p-4 border rounded flex items-center justify-between';
  wrapper.innerHTML = `
    <div>
      <div class="text-sm font-medium text-gray-800">${item.key}</div>
      <div class="text-xs text-gray-500">${item.value ?? '—'}</div>
    </div>
    <div class="flex items-center gap-2">
      <input type="text" placeholder="new value" class="px-2 py-1 border rounded text-sm" />
      <button class="px-2 py-1 bg-indigo-600 text-white rounded text-sm">Update</button>
      <button class="px-2 py-1 bg-gray-100 rounded text-sm">Clear</button>
    </div>
  `;
  const [input, updateBtn, clearBtn] = wrapper.querySelectorAll('input,button');
  updateBtn.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const value = input.value.trim();
    if (!value) return;
    await ui.withButtonLoading(btn, async () => {
      try {
        await api.apiFetch(`/api/secrets/${encodeURIComponent(item.key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) });
        input.value = '';
        ui.success(`Updated ${item.key}`);
        await load();
      } catch (err) {
        ui.error(err.message || 'Update failed');
      }
    });
  });
  clearBtn.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    await ui.withButtonLoading(btn, async () => {
      try {
        await api.apiFetch(`/api/secrets/${encodeURIComponent(item.key)}/rotate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ }) });
        ui.success(`Cleared ${item.key}`);
        await load();
      } catch (err) {
        ui.error(err.message || 'Clear failed');
      }
    });
  });
  return wrapper;
}

// Secret key categories for organized display
const SECRET_CATEGORIES = {
  'API Keys': [
    'OPENROUTER_API_KEY',
    'OPENROUTER_API_TOKEN',
    'GOOGLE_API_KEY',
    'GOOGLE_AI_API_KEY',
    'REPLICATE_API_TOKEN'
  ],
  'OAuth 2.0 Credentials': [
    'X_CLIENT_ID',
    'X_CLIENT_SECRET',
    'DISCORD_CLIENT_ID',
    'DISCORD_CLIENT_SECRET',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REFRESH_TOKEN'
  ],
  'Bot Tokens': [
    'DISCORD_BOT_TOKEN',
    'TELEGRAM_BOT_TOKEN'
  ],
  'Infrastructure': [
    'MONGO_URI',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'ENCRYPTION_KEY'
  ]
};

// All known keys flattened for lookup
const ALL_KNOWN_KEYS = Object.values(SECRET_CATEGORIES).flat();

function renderCategorySection(categoryName, items) {
  const section = document.createElement('div');
  section.className = 'mb-6';
  
  const header = document.createElement('h3');
  header.className = 'text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2';
  header.innerHTML = `
    <span class="w-2 h-2 rounded-full ${getCategoryColor(categoryName)}"></span>
    ${categoryName}
  `;
  section.appendChild(header);
  
  const list = document.createElement('div');
  list.className = 'space-y-3';
  items.forEach(item => list.appendChild(renderItem(item)));
  section.appendChild(list);
  
  return section;
}

function getCategoryColor(category) {
  const colors = {
    'API Keys': 'bg-blue-500',
    'OAuth 2.0 Credentials': 'bg-purple-500',
    'Bot Tokens': 'bg-green-500',
    'Infrastructure': 'bg-orange-500'
  };
  return colors[category] || 'bg-gray-500';
}

async function load() {
  const container = document.getElementById('secrets-list');
  container.innerHTML = '<div class="text-sm text-gray-500">Loading…</div>';
  try {
    const data = await fetchSecrets();
    container.innerHTML = '';
    
    // Merge known keys with those currently in cache
    const existing = new Set((data.items || []).map(i => i.key));
    for (const k of ALL_KNOWN_KEYS) {
      if (!existing.has(k)) data.items.push({ key: k, value: null });
    }
    
    // Create a map for quick lookup
    const itemMap = new Map(data.items.map(i => [i.key, i]));
    
    // Render by category
    for (const [category, keys] of Object.entries(SECRET_CATEGORIES)) {
      const categoryItems = keys.map(k => itemMap.get(k)).filter(Boolean);
      if (categoryItems.length > 0) {
        container.appendChild(renderCategorySection(category, categoryItems));
      }
    }
    
    // Render any uncategorized keys
    const categorizedKeys = new Set(ALL_KNOWN_KEYS);
    const uncategorizedItems = data.items.filter(i => !categorizedKeys.has(i.key));
    if (uncategorizedItems.length > 0) {
      container.appendChild(renderCategorySection('Other', uncategorizedItems));
    }
  } catch (e) {
    container.innerHTML = `<div class="text-sm text-red-600">${e.message}</div>`;
    ui?.error?.(e.message || 'Failed to load secrets');
  }
}

function init() {
  initGlobals();
  
  if (!api || !ui) {
    console.error('[admin-secrets] AdminAPI or AdminUI not available');
    const container = document.getElementById('secrets-list');
    if (container) {
      container.innerHTML = '<div class="text-sm text-red-600">Admin modules not loaded. Please refresh the page.</div>';
    }
    return;
  }
  
  document.getElementById('refresh')?.addEventListener('click', load);
  
  // Import .env handler
  document.getElementById('importEnv')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const ta = document.getElementById('envText');
    const status = document.getElementById('importStatus');
    await ui.withButtonLoading(btn, async () => {
      status.textContent = 'Importing...';
      try {
        const data = await api.apiFetch('/api/secrets/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ envText: ta.value || '' })
        });
        status.textContent = `Imported ${data.imported} keys.`;
        ui.success(`Imported ${data.imported} secrets`);
        ta.value = '';
        await load();
      } catch (err) {
        status.textContent = err.message;
        ui.error(err.message || 'Import failed');
      }
    });
  });
  
  load();
}

// Wait for bootstrap to be ready
if (window.AdminAPI && window.AdminUI) {
  // Already available
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
} else {
  // Wait for bootstrap event
  window.addEventListener('admin:bootstrapReady', () => {
    init();
  }, { once: true });
  
  // Fallback: also try DOMContentLoaded in case we missed the event
  document.addEventListener('DOMContentLoaded', () => {
    if (!api) {
      setTimeout(init, 100); // Small delay for globals to be set
    }
  });
}
