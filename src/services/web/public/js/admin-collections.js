import { initializeWallet, signWriteHeaders } from './services/wallet.js';
async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function saveConfig(ev) {
  ev.preventDefault();
  const status = document.getElementById('status');
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
  try {
    const sig = await signWriteHeaders();
    await fetchJSON('/api/admin/collections/configs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sig },
      body: JSON.stringify(payload)
    });
    status.textContent = 'Saved';
    await loadConfigs();
  } catch (e) {
    status.textContent = e.message;
  }
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
  div.querySelector('[data-act="status"]').addEventListener('click', async () => {
    const r = await fetchJSON(`/api/admin/collections/${encodeURIComponent(cfg.key)}/status`);
    alert(`${cfg.key}: ${r.count} avatars, lastSync: ${r.lastSyncAt || '—'}`);
  });
  div.querySelector('[data-act="sync"]').addEventListener('click', async () => {
    const ok = confirm(`Sync ${cfg.key} now?`);
    if (!ok) return;
    // show bar and start polling this key
    startCardProgress(div, cfg.key);
    const sig = await signWriteHeaders();
    try {
      const r = await fetchJSON(`/api/admin/collections/${encodeURIComponent(cfg.key)}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...sig }, body: JSON.stringify({ force: true }) });
      stopCardProgress(div, true);
      alert(`Processed ${r.result?.processed || 0} (ok ${r.result?.success || 0}, fail ${r.result?.failures || 0})`);
    } catch (e) {
      stopCardProgress(div, false);
      alert(e.message);
    }
  });
  return div;
}

async function loadConfigs() {
  const list = document.getElementById('list');
  list.textContent = 'Loading...';
  try {
    const r = await fetchJSON('/api/admin/collections/configs');
    list.innerHTML = '';
  (r.data || []).forEach(cfg => list.appendChild(renderItem(cfg)));
  // after rendering, hydrate any existing progress
  await hydrateProgressBars();
  } catch (e) {
    list.textContent = e.message;
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
const pollers = new Map();
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
  const tick = async () => {
    try {
      const doc = await fetchJSON(`/api/admin/collections/${encodeURIComponent(key)}/sync/progress`);
      renderCardProgress(container, doc);
      if (doc.done) stopCardProgress(container, true);
    } catch {}
  };
  stopCardProgress(container, false);
  const id = setInterval(tick, 1000);
  pollers.set(container, id);
  tick();
}
function stopCardProgress(container, _success) {
  const id = pollers.get(container);
  if (id) { clearInterval(id); pollers.delete(container); }
}
async function hydrateProgressBars() {
  try {
    const r = await fetchJSON('/api/admin/collections/progress/all');
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
