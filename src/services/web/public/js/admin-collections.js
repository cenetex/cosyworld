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
    </div>
    <div class="flex gap-2 justify-end">
      <button class="px-2 py-1 rounded bg-gray-100 text-sm" data-act="status">Status</button>
      <button class="px-2 py-1 rounded bg-indigo-600 text-white text-sm" data-act="sync">Sync</button>
    </div>`;
  div.querySelector('[data-act="status"]').addEventListener('click', async () => {
    const r = await fetchJSON(`/api/admin/collections/${encodeURIComponent(cfg.key)}/status`);
    alert(`${cfg.key}: ${r.count} avatars, lastSync: ${r.lastSyncAt || '—'}`);
  });
  div.querySelector('[data-act="sync"]').addEventListener('click', async () => {
    const ok = confirm(`Sync ${cfg.key} now?`);
    if (!ok) return;
    const sig = await signWriteHeaders();
    const r = await fetchJSON(`/api/admin/collections/${encodeURIComponent(cfg.key)}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...sig }, body: JSON.stringify({ force: true }) });
    alert(`Processed ${r.result?.processed || 0} (ok ${r.result?.success || 0}, fail ${r.result?.failures || 0})`);
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
  } catch (e) {
    list.textContent = e.message;
  }
}

document.getElementById('cfgForm')?.addEventListener('submit', saveConfig);
document.getElementById('refresh')?.addEventListener('click', loadConfigs);

document.addEventListener('DOMContentLoaded', () => {
  try { initializeWallet(); } catch {}
  loadConfigs();
});
