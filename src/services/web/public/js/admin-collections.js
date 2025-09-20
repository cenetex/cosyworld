import { initializeWallet, signWriteHeaders } from './services/wallet.js'; // initialize still used for wallet readiness
const polling = window.AdminPolling; // may be undefined very early; bootstrap loads before this

// Integrate with shared AdminAPI/AdminUI (loaded by admin-bootstrap.js)
// We keep a small adapter so we can still add wallet signature headers for signed writes.
const api = window.AdminAPI;
const ui = window.AdminUI;

// signedApiFetch deprecated in favor of apiFetch({ sign:true })

async function saveConfig(ev) {
  ev.preventDefault();
  const status = document.getElementById('status');
  const btn = document.querySelector('#cfgForm button[type="submit"]');
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
  await ui.withButtonLoading(btn, async () => {
    try {
      await api.apiFetch('/api/admin/collections/configs', {
        method: 'POST',
        sign: true,
        signMeta: { op: 'create_collection_config', key: payload.key },
        body: JSON.stringify(payload),
        requireCsrf: true
      });
      status.textContent = 'Saved';
      ui.success('Collection configuration saved');
      await loadConfigs();
    } catch (e) {
      status.textContent = e.message;
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
    </div>`;
  // hide progress by default until we have data
  const prog = div.querySelector('[data-prog]');
  prog.style.display = 'none';
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
    const ok = confirm(`Sync ${cfg.key} now?`);
    if (!ok) return;
    const btn = e.currentTarget;
    startCardProgress(div, cfg.key);
    await ui.withButtonLoading(btn, async () => {
      try {
  const r = await api.apiFetch(`/api/admin/collections/${encodeURIComponent(cfg.key)}/sync`, { method: 'POST', sign: true, signMeta: { op: 'sync_collection', key: cfg.key }, body: JSON.stringify({ force: true }), requireCsrf: true });
        stopCardProgress(div, true);
        const processed = r.result?.processed || 0;
        const okCt = r.result?.success || 0;
        const failCt = r.result?.failures || 0;
        ui.success(`Processed ${processed} (ok ${okCt}, fail ${failCt})`);
      } catch (err) {
        stopCardProgress(div, false);
        ui.error(err.message || 'Sync failed');
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

document.getElementById('cfgForm')?.addEventListener('submit', saveConfig);
document.getElementById('refresh')?.addEventListener('click', loadConfigs);

document.addEventListener('DOMContentLoaded', () => {
  try { initializeWallet(); } catch {}
  loadConfigs();
  const btn = document.getElementById('toggleForm');
  const form = document.getElementById('cfgForm');
  btn?.addEventListener('click', (e) => {
    e.preventDefault();
    if (form?.classList.contains('hidden')) form.classList.remove('hidden');
    else form?.classList.add('hidden');
  });
  // hydrate progress bars on page load
  hydrateProgressBars();
});

// --- Inline card progress bars ---
const pollers = new Map(); // key: container -> poller.stop()
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
