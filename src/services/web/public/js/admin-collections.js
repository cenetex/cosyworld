import { initializeWallet, signWriteHeaders } from './services/wallet.js'; // initialize still used for wallet readiness
// Defer grabbing globals until bootstrap ready to avoid race conditions.
let polling = window.AdminPolling;
let api = window.AdminAPI;
let ui = window.AdminUI;

function ensureGlobals() {
  if (!api || !ui) {
    api = window.AdminAPI;
    ui = window.AdminUI;
  }
  if (!polling) polling = window.AdminPolling;
  return !!api && !!ui;
}

// signedApiFetch deprecated in favor of apiFetch({ sign:true })

async function saveConfig(ev) {
  ev.preventDefault();
  if (!ensureGlobals()) {
    ui?.error?.('Admin system not ready. Please refresh the page.');
    return;
  }
  
  const status = document.getElementById('status');
  const btn = document.querySelector('#cfgForm button[type="submit"]');
  
  if (!status || !btn) {
    console.error('[admin-collections] Form elements not found');
    return;
  }
  
  status.textContent = 'Saving...';
  const payload = {
    key: document.getElementById('key').value.trim(),
    type: document.getElementById('type').value,
    provider: document.getElementById('provider').value.trim(),
    chain: (document.getElementById('chain').value || '').toLowerCase(),
    displayName: document.getElementById('displayName').value.trim() || undefined,
    image: document.getElementById('image').value.trim() || undefined,
    claimPolicy: document.getElementById('claimPolicy').value,
    gateTarget: document.getElementById('gateTarget').value.trim() || undefined,
    sync: {
      source: document.getElementById('fileSource').value ? 'file' : undefined,
      fileSource: document.getElementById('fileSource').value || undefined
    }
  };
  
  if (!payload.key) {
    status.textContent = 'Error: Collection key is required';
    ui.error('Collection key is required');
    return;
  }
  
  await ui.withButtonLoading(btn, async () => {
    try {
      console.log('[admin-collections] Saving collection config:', payload.key);
      await api.apiFetch('/api/admin/collections/configs', {
        method: 'POST',
        sign: true,
        signMeta: { op: 'create_collection_config', key: payload.key },
        body: payload,
        requireCsrf: true
      });
      status.textContent = 'Saved';
      ui.success('Collection configuration saved');
      await loadConfigs();
    } catch (e) {
      console.error('[admin-collections] Save failed:', e);
      status.textContent = e.message || 'Save failed';
      ui.error(e.message || 'Failed to save collection');
    }
  });
}

function renderItem(cfg) {
  const div = document.createElement('div');
  div.className = 'border rounded p-3 grid md:grid-cols-[1fr_auto] gap-2 items-center';
  const meta = [cfg.type || 'avatar', cfg.chain || 'eth', cfg.provider || '-'].join(' • ');
  div.innerHTML = `
    <div>
      <div class="font-mono text-sm">${cfg.key}</div>
      <div class="text-xs text-gray-600">${meta}</div>
      <div class="text-xs text-gray-600">policy: ${cfg.claimPolicy || 'strictTokenOwner'}${cfg.gateTarget ? ' → ' + cfg.gateTarget : ''}</div>
      <div class="text-xs text-gray-600">lastSync: ${cfg.lastSyncAt ? new Date(cfg.lastSyncAt).toLocaleString() : '—'}</div>
      <div class="text-xs text-gray-600" data-count>avatars: <span data-count-value>loading...</span></div>
      <div class="mt-2" data-prog>
        <div class="h-2 w-full bg-gray-200 rounded overflow-hidden">
          <div class="h-full bg-indigo-600" style="width:0%" data-bar></div>
        </div>
        <div class="text-xs text-gray-600 mt-1" data-prog-meta></div>
      </div>
    </div>
    <div class="flex gap-2 justify-end">
      <button class="px-2 py-1 rounded bg-gray-100 text-sm" data-act="status">Status</button>
      <button class="px-2 py-1 rounded bg-indigo-600 text-white text-sm" data-act="sync">Sync</button>
      <button class="px-2 py-1 rounded bg-red-600 text-white text-sm" data-act="delete">Delete</button>
    </div>`;
  // hide progress by default until we have data
  const prog = div.querySelector('[data-prog]');
  prog.style.display = 'none';
  
  // Fetch and display avatar count
  (async () => {
    try {
      const r = await api.apiFetch(`/api/admin/collections/${encodeURIComponent(cfg.key)}/status`);
      const countValue = div.querySelector('[data-count-value]');
      if (countValue) countValue.textContent = r.count || 0;
    } catch (e) {
      const countValue = div.querySelector('[data-count-value]');
      if (countValue) countValue.textContent = 'error';
    }
  })();
  
  div.querySelector('[data-act="status"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    await ui.withButtonLoading(btn, async () => {
      try {
        const r = await api.apiFetch(`/api/admin/collections/${encodeURIComponent(cfg.key)}/status`);
        ui.success(`${cfg.key}: ${r.count} avatars${r.lastSyncAt ? ' • last ' + new Date(r.lastSyncAt).toLocaleString() : ''}`);
      } catch (err) {
        ui.error(err.message || 'Failed to fetch status');
      }
    });
  });
  div.querySelector('[data-act="sync"]').addEventListener('click', async (e) => {
    const ok = confirm(`Sync ${cfg.key} now?\n\nThis will update avatar metadata while preserving existing data (channelId, status, lives).`);
    if (!ok) return;
    const btn = e.currentTarget;
    startCardProgress(div, cfg.key);
    await ui.withButtonLoading(btn, async () => {
      try {
  const r = await api.apiFetch(`/api/admin/collections/${encodeURIComponent(cfg.key)}/sync`, {
    method: 'POST',
    sign: true,
    signMeta: { op: 'sync_collection', key: cfg.key },
    body: { force: false },
    requireCsrf: true
  });
        stopCardProgress(div, true);
        const processed = r.result?.processed || 0;
        const okCt = r.result?.success || 0;
        const failCt = r.result?.failures || 0;
        ui.success(`Processed ${processed} (ok ${okCt}, fail ${failCt})`);
        // Reload configs to update UI with new lastSyncAt timestamp
        await loadConfigs();
      } catch (err) {
        stopCardProgress(div, false);
        ui.error(err.message || 'Sync failed');
      }
    });
  });
  div.querySelector('[data-act="delete"]').addEventListener('click', async (e) => {
    const ok = confirm(`Delete collection config "${cfg.key}"?\n\nThis will remove the configuration but NOT delete existing avatars from the database.`);
    if (!ok) return;
    const btn = e.currentTarget;
    await ui.withButtonLoading(btn, async () => {
      try {
        console.log('[admin-collections] Deleting collection config:', cfg.key);
        await api.apiFetch(`/api/admin/collections/${encodeURIComponent(cfg.key)}`, { 
          method: 'DELETE', 
          sign: true, 
          signMeta: { op: 'delete_collection_config', key: cfg.key }, 
          requireCsrf: true 
        });
        ui.success(`Deleted collection config: ${cfg.key}`);
        await loadConfigs();
      } catch (err) {
        console.error('[admin-collections] Delete failed:', err);
        ui.error(err.message || 'Delete failed');
      }
    });
  });
  return div;
}

async function loadConfigs() {
  const list = document.getElementById('list');
  list.textContent = 'Loading...';
  try {
  const r = await api.apiFetch('/api/admin/collections/configs');
    list.innerHTML = '';
  (r.data || []).forEach(cfg => list.appendChild(renderItem(cfg)));
  // after rendering, hydrate any existing progress
  await hydrateProgressBars();
  } catch (e) {
    list.textContent = e.message;
    ui.error(e.message || 'Failed to load configs');
  }
}

function initPage() {
  if (!ensureGlobals()) {
    // If still not ready, wait for event
    return;
  }
  
  // Initialize wallet for signing operations
  try { 
    console.log('[admin-collections] Initializing wallet...');
    initializeWallet(); 
  } catch (e) {
    console.error('[admin-collections] Wallet initialization failed:', e);
  }
  
  // Attach event listeners after DOM is ready
  const cfgForm = document.getElementById('cfgForm');
  const refreshBtn = document.getElementById('refresh');
  const toggleBtn = document.getElementById('toggleForm');
  
  if (cfgForm) {
    console.log('[admin-collections] Attaching form submit handler');
    cfgForm.addEventListener('submit', saveConfig);
  } else {
    console.warn('[admin-collections] Form element #cfgForm not found');
  }
  
  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadConfigs);
  }
  
  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (cfgForm?.classList.contains('hidden')) {
        cfgForm.classList.remove('hidden');
      } else {
        cfgForm?.classList.add('hidden');
      }
    });
  }
  
  loadConfigs();
  hydrateProgressBars();
}

document.addEventListener('DOMContentLoaded', () => {
  if (ensureGlobals()) {
    initPage();
  } else {
    // Wait for bootstrap readiness event
    const onReady = () => { window.removeEventListener('admin:bootstrapReady', onReady); initPage(); };
    window.addEventListener('admin:bootstrapReady', onReady);
  }
  
  // Cleanup pollers when leaving collections page
  // This provides an extra safety net, but the main check is in startCardProgress
  const checkTab = () => {
    if (window.state?.activeTab !== 'collections') {
      stopAllPollers();
    }
  };
  // Check every few seconds as a fallback
  setInterval(checkTab, 5000);
});

// --- Inline card progress bars ---
const pollers = new Map(); // key: container -> poller.stop()

// Stop all pollers when leaving the collections page
function stopAllPollers() {
  pollers.forEach((stop, container) => {
    try { stop(); } catch {}
  });
  pollers.clear();
}

function renderCardProgress(container, doc) {
  const prog = container.querySelector('[data-prog]');
  const bar = container.querySelector('[data-bar]');
  const meta = container.querySelector('[data-prog-meta]');
  if (!prog || !bar || !meta) return;
  prog.style.display = 'block';
  const total = doc.total || 0;
  const processed = doc.processed || 0;
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  bar.style.width = `${pct}%`;
  meta.textContent = `${pct}% • processed ${processed} / ${total || '—'} • ok ${doc.success || 0} • fail ${doc.failures || 0}${doc.done ? ' • done' : ''}`;
}
async function startCardProgress(container, key) {
  stopCardProgress(container, false);
  if (!polling || !polling.createPoller) {
    // fallback to legacy interval if polling util missing
    const legacy = setInterval(async () => {
      // Stop polling if we're no longer on the collections tab
      if (window.state?.activeTab !== 'collections') {
        clearInterval(legacy);
        pollers.delete(container);
        return;
      }
      try {
        const doc = await api.apiFetch(`/api/admin/collections/${encodeURIComponent(key)}/sync/progress`);
        renderCardProgress(container, doc);
        if (doc.done) stopCardProgress(container, true);
      } catch {}
    }, 1000);
    pollers.set(container, () => clearInterval(legacy));
    return;
  }
  const controller = polling.createPoller(async () => {
    // Stop polling if we're no longer on the collections tab
    if (window.state?.activeTab !== 'collections') {
      stopCardProgress(container, false);
      return;
    }
    const doc = await api.apiFetch(`/api/admin/collections/${encodeURIComponent(key)}/sync/progress`);
    renderCardProgress(container, doc);
    if (doc.done) stopCardProgress(container, true);
  }, { interval: 1000, immediate: true });
  pollers.set(container, controller.stop);
}
function stopCardProgress(container, _success) {
  const stop = pollers.get(container);
  if (stop) { try { stop(); } catch {} pollers.delete(container); }
}
async function hydrateProgressBars() {
  try {
  const r = await api.apiFetch('/api/admin/collections/progress/all');
    const map = new Map((r.data || []).map(d => [d.key, d]));
    document.querySelectorAll('#list > div').forEach(card => {
      const key = card.querySelector('.font-mono')?.textContent;
      if (!key) return;
      const doc = map.get(key);
      if (doc && (!doc.done || (doc.processed && doc.processed < (doc.total || Infinity)))) {
        renderCardProgress(card, doc);
        startCardProgress(card, key);
      } else if (doc && doc.done) {
        renderCardProgress(card, doc);
      }
    });
  } catch {}
}
