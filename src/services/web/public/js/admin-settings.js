// Refactored to use shared AdminAPI/AdminUI wrappers
// NOTE: Converted previously absolute /js/admin/* imports to relative paths for bundler compatibility
import { apiFetch, safeApi } from './admin/admin-api.js';
import { success, error as toastError, withButtonLoading } from './admin/admin-ui.js';

async function fetchJSON(url, opts) {
  // Backward compatibility shim (will migrate all calls to apiFetch gradually)
  return apiFetch(url, { json: true, ...(opts||{}), requireCsrf: !!(opts && opts.method && opts.method !== 'GET') });
}

function scopeLabel(source) {
  if (source === 'guild') return 'Override';
  if (source === 'env') return 'Env';
  return 'Global';
}

let selectedGuildId = '';
let guildListData = [];
let selectedGuildMeta = null; // { id, name, authorized, iconUrl }

function getGuildMetaById(id) {
  if (!id) return { id: '', name: 'Global Defaults', authorized: true };
  const idStr = String(id);
  const found = guildListData.find(g => String(g.id) === idStr || String(g.guildId) === idStr);
  if (!found) return { id: idStr, name: idStr, authorized: false };
  return {
    id: found.guildId || found.id,
    name: found.guildName || found.name || (found.guildId || found.id),
    authorized: !!found.authorized,
    iconUrl: found.iconUrl
  };
}

function setActiveGuild(id) {
  selectedGuildId = id || '';
  selectedGuildMeta = getGuildMetaById(selectedGuildId);
  const list = document.getElementById('guildList');
  if (!list) return;
  Array.from(list.children).forEach(el => {
    el.classList.remove('bg-gray-200', 'font-medium');
    if (el.dataset.guildId === selectedGuildId) {
      el.classList.add('bg-gray-200', 'font-medium');
    }
    if (!selectedGuildId && el.dataset.guildId === '') {
      el.classList.add('bg-gray-200', 'font-medium');
    }
  });
  updateSelectedGuildCard();
}

async function loadGuildOptions() {
  // Populate sidebar guild list with Global Defaults and guilds
  const list = document.getElementById('guildList');
  if (!list) return;
  list.innerHTML = '';
  const makeItem = (id, label) => {
    const a = document.createElement('button');
    a.type = 'button';
    a.dataset.guildId = id || '';
    a.className = 'text-left px-2 py-1 rounded text-sm cursor-pointer hover:bg-gray-100';
    a.textContent = label;
    a.addEventListener('click', async () => {
      setActiveGuild(id || '');
      await load();
    });
    return a;
  };
  // Global first
  list.appendChild(makeItem('', 'Global Defaults'));
  try {
    const res = await fetch('/api/guilds');
    if (res.ok) {
      const guilds = await res.json();
      guildListData = guilds.map(g => ({
        id: g.guildId || g.id,
        guildId: g.guildId || g.id,
        name: g.guildName || g.name || (g.guildId || g.id),
        guildName: g.guildName || g.name || (g.guildId || g.id),
        authorized: !!g.authorized,
        iconUrl: g.iconUrl
      }));
      for (const g of guildListData) {
        const id = g.guildId || g.id;
        const name = g.guildName || g.name || id;
        list.appendChild(makeItem(id, name));
      }
    }
  } catch {}
  setActiveGuild(selectedGuildId);
}

// Selected guild header card controls
function updateSelectedGuildCard() {
  const card = document.getElementById('selectedGuildCard');
  if (!card) return;
  if (!selectedGuildId) {
    card.classList.add('hidden');
    return;
  }
  const meta = selectedGuildMeta || getGuildMetaById(selectedGuildId);
  card.classList.remove('hidden');
  const icon = document.getElementById('selectedGuildIcon');
  const nameEl = document.getElementById('selectedGuildName');
  const idEl = document.getElementById('selectedGuildId');
  const statusEl = document.getElementById('selectedGuildStatus');
  if (icon) icon.src = meta.iconUrl || 'https://cdn.discordapp.com/embed/avatars/0.png';
  if (nameEl) nameEl.textContent = meta.name || 'Guild';
  if (idEl) idEl.textContent = meta.id || selectedGuildId;
  if (statusEl) statusEl.textContent = meta.authorized ? 'Authorized' : 'Not authorized';
  const btnAuth = document.getElementById('btnAuthorizeGuild');
  const btnDeauth = document.getElementById('btnDeauthorizeGuild');
  btnAuth?.classList.toggle('hidden', !!meta.authorized);
  btnDeauth?.classList.toggle('hidden', !meta.authorized);
}

async function setGuildAuthorized(guildId, value) {
  if (!guildId) return;
  if (value) {
  await fetchJSON(`/api/guilds/${encodeURIComponent(guildId)}/authorize`, { method: 'POST' });
  } else {
    await fetchJSON(`/api/guilds/${encodeURIComponent(guildId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authorized: false, whitelisted: false })
    });
    await fetchJSON(`/api/guilds/${encodeURIComponent(guildId)}/clear-cache`, { method: 'POST' });
  }
  await refreshGuildList();
}

async function clearGuildCache(guildId) {
  if (!guildId) return;
  await fetchJSON(`/api/guilds/${encodeURIComponent(guildId)}/clear-cache`, { method: 'POST' });
}

async function deleteGuildConfig(guildId) {
  if (!guildId) return;
  if (!confirm('Delete this guild configuration?')) return;
  await fetchJSON(`/api/guilds/${encodeURIComponent(guildId)}`, { method: 'DELETE' });
  if (selectedGuildId === guildId) {
    selectedGuildId = '';
    selectedGuildMeta = null;
  }
  await refreshGuildList();
}

async function refreshGuildList() {
  const prev = selectedGuildId;
  await loadGuildOptions();
  setActiveGuild(prev);
  await load();
}

// Detected guilds rendering
async function loadDetectedGuilds() {
  const section = document.getElementById('detectedGuildsSection');
  const countEl = document.getElementById('detectedCount');
  const container = document.getElementById('detectedGuildsContainer');
  if (!section || !container) return;
  try {
    const list = await fetchJSON('/api/guilds/detected');
    const items = Array.isArray(list) ? list : [];
    if (items.length) section.classList.remove('hidden'); else section.classList.add('hidden');
    if (countEl) countEl.textContent = items.length ? `(${items.length})` : '';
    container.innerHTML = '';
    for (const g of items) {
      const id = g.id || g.guildId;
      const name = g.name || g.guildName || id;
      const card = document.createElement('div');
      card.className = 'flex items-center justify-between p-2 border rounded bg-white';
      const left = document.createElement('div');
      left.className = 'flex items-center gap-3';
      const img = document.createElement('img');
      img.src = g.iconUrl || 'https://cdn.discordapp.com/embed/avatars/0.png';
      img.className = 'w-8 h-8 rounded bg-gray-200 border';
      const nameBox = document.createElement('div');
      nameBox.innerHTML = `<div class="font-medium">${name}</div><div class="text-xs text-gray-500">ID: ${id}</div>`;
      left.append(img, nameBox);
      const right = document.createElement('div');
      right.className = 'flex items-center gap-2';
      const authBtn = document.createElement('button');
      authBtn.className = 'px-3 py-1 bg-green-600 text-white rounded text-sm';
      authBtn.textContent = 'Authorize';
      authBtn.addEventListener('click', withButtonLoading(authBtn, async () => {
        try {
          await fetchJSON(`/api/guilds/${encodeURIComponent(id)}/authorize`, { method: 'POST' });
          success('Guild authorized');
          await Promise.all([loadDetectedGuilds(), refreshGuildList()]);
        } catch (e) {
          toastError(e.message || 'Failed to authorize');
        }
      }));
      right.appendChild(authBtn);
      card.append(left, right);
      container.appendChild(card);
    }
  } catch (e) {
    console.error('Failed to load detected guilds', e);
  }
}

function renderSettingRow(item, guildId) {
  const wrap = document.createElement('div');
  wrap.className = 'p-3 border rounded grid grid-cols-[1fr_auto] items-center gap-3 overflow-hidden';
  wrap.innerHTML = `
    <div class="min-w-0">
      <div class="text-sm font-medium text-gray-800 truncate font-mono" title="${item.key}">${item.key}</div>
      <div class="text-xs text-gray-500">Scope: ${scopeLabel(item.source)} • ${item.value ?? '—'}</div>
    </div>
    <div class="flex items-center gap-2 shrink-0">
      <input type="text" placeholder="new value" class="px-2 py-1 border rounded text-sm w-40 md:w-56 lg:w-64" />
      <button class="px-2 py-1 bg-indigo-600 text-white rounded text-sm whitespace-nowrap shrink-0">Set</button>
      <button class="px-2 py-1 bg-gray-100 rounded text-sm whitespace-nowrap shrink-0">Clear</button>
    </div>
  `;
  const [input, setBtn, clearBtn] = wrap.querySelectorAll('input,button');
  setBtn.addEventListener('click', withButtonLoading(setBtn, async () => {
    const value = input.value.trim();
    if (!value) return;
    const qs = guildId ? `?guildId=${encodeURIComponent(guildId)}` : '';
    try {
      await fetchJSON(`/api/settings/set/${encodeURIComponent(item.key)}${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value })
      });
      input.value = '';
      success('Setting updated');
      await load();
    } catch (e) { toastError(e.message || 'Failed to set'); }
  }));
  clearBtn.addEventListener('click', withButtonLoading(clearBtn, async () => {
    const qs = guildId ? `?guildId=${encodeURIComponent(guildId)}` : '';
    try {
      await fetchJSON(`/api/settings/clear/${encodeURIComponent(item.key)}${qs}`, { method: 'POST' });
      success('Cleared');
      await load();
    } catch (e) { toastError(e.message || 'Failed to clear'); }
  }));
  return wrap;
}

function renderSecretRow(item, guildId) {
  const wrap = document.createElement('div');
  wrap.className = 'p-3 border rounded grid grid-cols-[1fr_auto] items-center gap-3 overflow-hidden';
  wrap.innerHTML = `
    <div class="min-w-0">
      <div class="text-sm font-medium text-gray-800 truncate font-mono" title="${item.key}">${item.key}</div>
      <div class="text-xs text-gray-500">Scope: ${scopeLabel(item.source)} • ${item.value ?? '—'}</div>
    </div>
    <div class="flex items-center gap-2 shrink-0">
      <input type="text" placeholder="new value" class="px-2 py-1 border rounded text-sm w-40 md:w-56 lg:w-64" />
      <button class="px-2 py-1 bg-indigo-600 text-white rounded text-sm whitespace-nowrap shrink-0">Set</button>
      <button class="px-2 py-1 bg-gray-100 rounded text-sm whitespace-nowrap shrink-0">Clear</button>
    </div>
  `;
  const [input, setBtn, clearBtn] = wrap.querySelectorAll('input,button');
  setBtn.addEventListener('click', withButtonLoading(setBtn, async () => {
    const value = input.value.trim();
    if (!value) return;
    const qs = guildId ? `?guildId=${encodeURIComponent(guildId)}` : '';
    try {
      await fetchJSON(`/api/secrets/${encodeURIComponent(item.key)}${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value })
      });
      input.value = '';
      success('Secret updated');
      await load();
    } catch (e) { toastError(e.message || 'Failed to set secret'); }
  }));
  clearBtn.addEventListener('click', withButtonLoading(clearBtn, async () => {
    const qs = guildId ? `?guildId=${encodeURIComponent(guildId)}` : '';
    try {
      await fetchJSON(`/api/secrets/${encodeURIComponent(item.key)}/rotate${qs}`, { method: 'POST' });
      success('Secret rotated');
      await load();
    } catch (e) { toastError(e.message || 'Failed to rotate secret'); }
  }));
  return wrap;
}

function renderPromptRow(item, guildId) {
  const wrap = document.createElement('div');
  wrap.className = 'p-3 border rounded grid gap-2';
  wrap.innerHTML = `
    <div class="text-sm font-medium text-gray-800 font-mono truncate" title="${item.key}">${item.key}</div>
    <div class="text-xs text-gray-500">Scope: ${scopeLabel(item.source)}</div>
    <textarea class="w-full border rounded p-2 text-sm" rows="6" placeholder="Enter prompt text..."></textarea>
    <div class="flex items-center gap-2">
      <button class="px-3 py-1 bg-indigo-600 text-white rounded text-sm whitespace-nowrap">Set</button>
      <button class="px-3 py-1 bg-gray-100 rounded text-sm whitespace-nowrap">Clear</button>
    </div>
  `;
  const [textarea, setBtn, clearBtn] = wrap.querySelectorAll('textarea,button');
  textarea.value = (item.value ?? '').toString();
  setBtn.addEventListener('click', withButtonLoading(setBtn, async () => {
    const value = textarea.value.trim();
    if (!value) return;
    const qs = guildId ? `?guildId=${encodeURIComponent(guildId)}` : '';
    try {
      await fetchJSON(`/api/settings/set/${encodeURIComponent(item.key)}${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value })
      });
      textarea.value = '';
      success('Prompt updated');
      await load();
    } catch (e) { toastError(e.message || 'Failed to set prompt'); }
  }));
  clearBtn.addEventListener('click', withButtonLoading(clearBtn, async () => {
    const qs = guildId ? `?guildId=${encodeURIComponent(guildId)}` : '';
    try {
      await fetchJSON(`/api/settings/clear/${encodeURIComponent(item.key)}${qs}`, { method: 'POST' });
      success('Cleared');
      await load();
    } catch (e) { toastError(e.message || 'Failed to clear prompt'); }
  }));
  return wrap;
}

async function load() {
  const guildId = selectedGuildId || '';
  const qs = guildId ? `?guildId=${encodeURIComponent(guildId)}` : '';
  const data = await fetchJSON(`/api/settings${qs}`);
  // Persist page state
  window.__adminSettingsState = { guildId, data };

  const filterText = (document.getElementById('filterText')?.value || '').toLowerCase();
  const onlyOverrides = !!document.getElementById('onlyOverrides')?.checked;

  // Split prompts vs other settings
  const allSettings = data.settings || [];
  const promptsAll = allSettings.filter(it => it.key.startsWith('prompts.'));
  const settingsAll = allSettings.filter(it => !it.key.startsWith('prompts.'));

  // Filter helpers
  const settings = settingsAll.filter(it =>
    (!filterText || it.key.toLowerCase().includes(filterText)) &&
    (!onlyOverrides || it.source === 'guild')
  );
  const prompts = promptsAll.filter(it =>
    (!filterText || it.key.toLowerCase().includes(filterText)) &&
    (!onlyOverrides || it.source === 'guild')
  );
  const secrets = (data.secrets || []).filter(it =>
    (!filterText || it.key.toLowerCase().includes(filterText)) &&
    (!onlyOverrides || it.source === 'guild')
  );

  // Render prompts
  const promptsList = document.getElementById('promptsList');
  if (promptsList) {
    promptsList.innerHTML = '';
    prompts.forEach(s => promptsList.appendChild(renderPromptRow(s, guildId)));
  }
  // Render settings
  const settingsList = document.getElementById('settingsList');
  if (settingsList) {
    settingsList.innerHTML = '';
    settings.forEach(s => settingsList.appendChild(renderSettingRow(s, guildId)));
  }
  // Render secrets
  const secretsList = document.getElementById('secretsList');
  if (secretsList) {
    secretsList.innerHTML = '';
    secrets.forEach(s => secretsList.appendChild(renderSecretRow(s, guildId)));
  }
}

// Events
document.getElementById('refresh')?.addEventListener('click', load);

document.getElementById('importEnv')?.addEventListener('click', withButtonLoading(document.getElementById('importEnv'), async () => {
  const ta = document.getElementById('envText');
  const status = document.getElementById('importStatus');
  const guildId = selectedGuildId || '';
  const qs = guildId ? `?guildId=${encodeURIComponent(guildId)}` : '';
  status.textContent = 'Importing...';
  try {
    await fetchJSON(`/api/secrets/import${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envText: ta.value || '' })
    });
    status.textContent = 'Imported';
    success('Secrets imported');
    ta.value = '';
    await load();
  } catch (e) {
    status.textContent = e.message;
    toastError(e.message || 'Import failed');
  }
}));

// Filters
document.getElementById('filterText')?.addEventListener('input', () => load());
document.getElementById('onlyOverrides')?.addEventListener('change', () => load());

// Export helpers (masked)
function download(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function currentScopeLabel() {
  return selectedGuildId ? `guild-${selectedGuildId}` : 'global';
}

document.getElementById('exportEnv')?.addEventListener('click', () => {
  const st = window.__adminSettingsState;
  if (!st) return;
  const { data } = st;
  const lines = [];
  // Non-secret settings as JSON path comments
  (data.settings || []).forEach(s => {
    lines.push(`# ${s.key} (${s.source}) = ${s.value}`);
  });
  // Secrets masked
  (data.secrets || []).forEach(s => {
    const masked = s.value ?? '';
    lines.push(`${s.key}=${masked}`);
  });
  download(`export-${currentScopeLabel()}.env`, lines.join('\n'));
});

document.getElementById('exportJson')?.addEventListener('click', () => {
  const st = window.__adminSettingsState;
  if (!st) return;
  const { data } = st;
  const out = {
    scope: selectedGuildId ? { guildId: selectedGuildId } : { global: true },
    settings: (data.settings || []).reduce((acc, s) => {
      acc[s.key] = { value: s.value, source: s.source };
      return acc;
    }, {}),
    secrets: (data.secrets || []).reduce((acc, s) => {
      acc[s.key] = { value: s.value, source: s.source, masked: true };
      return acc;
    }, {})
  };
  download(`export-${currentScopeLabel()}.json`, JSON.stringify(out, null, 2));
});

// Init
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadGuildOptions();
  } catch {}
  // default to Global on first load
  setActiveGuild(selectedGuildId);
  await load();
  // wire selected guild header buttons
  document.getElementById('btnAuthorizeGuild')?.addEventListener('click', withButtonLoading(document.getElementById('btnAuthorizeGuild'), async () => {
    if (!selectedGuildId) return;
    await setGuildAuthorized(selectedGuildId, true);
    selectedGuildMeta = { ...(selectedGuildMeta || {}), authorized: true };
    updateSelectedGuildCard();
    success('Guild authorized');
  }));
  document.getElementById('btnDeauthorizeGuild')?.addEventListener('click', withButtonLoading(document.getElementById('btnDeauthorizeGuild'), async () => {
    if (!selectedGuildId) return;
    await setGuildAuthorized(selectedGuildId, false);
    selectedGuildMeta = { ...(selectedGuildMeta || {}), authorized: false };
    updateSelectedGuildCard();
    success('Guild deauthorized');
  }));
  document.getElementById('btnClearGuildCache')?.addEventListener('click', withButtonLoading(document.getElementById('btnClearGuildCache'), async () => {
    if (!selectedGuildId) return;
    await clearGuildCache(selectedGuildId);
    success('Cache cleared');
  }));
  document.getElementById('btnDeleteGuild')?.addEventListener('click', withButtonLoading(document.getElementById('btnDeleteGuild'), async () => {
    if (!selectedGuildId) return;
    await deleteGuildConfig(selectedGuildId);
    success('Guild config deleted');
  }));
  document.getElementById('refreshDetected')?.addEventListener('click', () => loadDetectedGuilds());
  // initial detected guilds load
  loadDetectedGuilds();
  // Tab wiring (default Prompts active)
  const tabPrompts = document.getElementById('tabPrompts');
  const tabSettings = document.getElementById('tabSettings');
  const tabSecrets = document.getElementById('tabSecrets');
  const panelPrompts = document.getElementById('panelPrompts');
  const panelSettings = document.getElementById('panelSettings');
  const panelSecrets = document.getElementById('panelSecrets');
  function activate(tab) {
    // styles
    [tabPrompts, tabSettings, tabSecrets].forEach(b => b && b.classList.remove('bg-gray-200', 'font-medium'));
    if (tab) tab.classList.add('bg-gray-200', 'font-medium');
    // panels
    panelPrompts?.classList.add('hidden');
    panelSettings?.classList.add('hidden');
    panelSecrets?.classList.add('hidden');
    if (tab === tabPrompts) panelPrompts?.classList.remove('hidden');
    if (tab === tabSettings) panelSettings?.classList.remove('hidden');
    if (tab === tabSecrets) panelSecrets?.classList.remove('hidden');
  }
  tabPrompts?.addEventListener('click', () => activate(tabPrompts));
  tabSettings?.addEventListener('click', () => activate(tabSettings));
  tabSecrets?.addEventListener('click', () => activate(tabSecrets));
  activate(tabPrompts);
});
