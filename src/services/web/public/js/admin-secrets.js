const api = window.AdminAPI;
const ui = window.AdminUI;

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

async function load() {
  const container = document.getElementById('secrets-list');
  container.innerHTML = '<div class="text-sm text-gray-500">Loading…</div>';
  try {
  const data = await fetchSecrets();
    container.innerHTML = '';
    const keys = [
      'OPENROUTER_API_KEY','OPENROUTER_API_TOKEN','GOOGLE_API_KEY','GOOGLE_AI_API_KEY',
      'REPLICATE_API_TOKEN','MONGO_URI','DISCORD_BOT_TOKEN','DISCORD_CLIENT_ID'
    ];
    // Merge known keys with those currently in cache
    const existing = new Set((data.items || []).map(i => i.key));
    for (const k of keys) if (!existing.has(k)) data.items.push({ key: k, value: null });
    for (const item of data.items) container.appendChild(renderItem(item));
  } catch (e) {
    container.innerHTML = `<div class="text-sm text-red-600">${e.message}</div>`;
    ui.error(e.message || 'Failed to load secrets');
  }
}

document.getElementById('refresh')?.addEventListener('click', load);

document.addEventListener('DOMContentLoaded', load);

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
