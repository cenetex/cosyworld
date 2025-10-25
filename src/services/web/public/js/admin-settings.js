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

async function updateDetectedServersCount() {
  try {
    const res = await fetch('/api/guilds/detected');
    if (!res.ok) return;
    const data = await res.json();
    const count = Array.isArray(data) ? data.length : 0;
    const span = document.getElementById('detectedServersCount');
    if (span) span.textContent = count ? `(${count})` : '';
  } catch {}
}

// Detected guilds moved to /admin/servers

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
    updateDetectedServersCount();
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

// Payment Configuration Functions
async function loadPaymentConfig() {
  try {
    const response = await fetchJSON('/api/payment/config');
    if (response) {
      // x402 Configuration
      document.getElementById('cdpApiKeyId').value = response.apiKeyId || '';
      document.getElementById('cdpApiKeySecret').value = response.apiKeySecret || '';
      document.getElementById('sellerAddress').value = response.sellerAddress || '';
      document.getElementById('defaultNetwork').value = response.defaultNetwork || 'base-sepolia';
      document.getElementById('enableTestnet').checked = response.enableTestnet !== false;
      
      // Agent Wallet Configuration
      document.getElementById('walletEncryptionKey').value = response.walletEncryptionKey || '';
      document.getElementById('defaultDailyLimit').value = response.defaultDailyLimit 
        ? (response.defaultDailyLimit / 1e6).toFixed(2) 
        : '100.00';
      
      // Update status
      updatePaymentStatus(response);
    }
  } catch (error) {
    console.error('Failed to load payment config:', error);
    toastError('Failed to load payment configuration');
  }
}

function updatePaymentStatus(config) {
  const statusEl = document.getElementById('x402-status');
  if (!statusEl) return;
  
  const hasApiKey = config.apiKeyId && config.apiKeySecret;
  const hasSellerAddress = config.sellerAddress && config.sellerAddress.startsWith('0x');
  const hasEncryptionKey = config.walletEncryptionKey && config.walletEncryptionKey.length >= 32;
  
  if (hasApiKey && hasSellerAddress && hasEncryptionKey) {
    statusEl.className = 'text-xs px-2 py-1 rounded bg-green-100 text-green-800';
    statusEl.textContent = 'Configured';
  } else if (hasApiKey || hasSellerAddress || hasEncryptionKey) {
    statusEl.className = 'text-xs px-2 py-1 rounded bg-yellow-100 text-yellow-800';
    statusEl.textContent = 'Partial';
  } else {
    statusEl.className = 'text-xs px-2 py-1 rounded bg-gray-200 text-gray-700';
    statusEl.textContent = 'Not Configured';
  }
}

async function savePaymentConfig() {
  const config = {
    apiKeyId: document.getElementById('cdpApiKeyId').value.trim(),
    apiKeySecret: document.getElementById('cdpApiKeySecret').value.trim(),
    sellerAddress: document.getElementById('sellerAddress').value.trim(),
    defaultNetwork: document.getElementById('defaultNetwork').value,
    enableTestnet: document.getElementById('enableTestnet').checked,
    walletEncryptionKey: document.getElementById('walletEncryptionKey').value.trim(),
    defaultDailyLimit: parseFloat(document.getElementById('defaultDailyLimit').value) * 1e6, // Convert USDC to 6 decimals
  };
  
  // Validation
  if (config.apiKeyId && !config.apiKeyId.trim()) {
    toastError('CDP API Key ID is required');
    return;
  }
  
  if (config.apiKeySecret && config.apiKeySecret.length < 20) {
    toastError('CDP API Key Secret appears invalid (too short)');
    return;
  }
  
  if (config.sellerAddress && !config.sellerAddress.startsWith('0x')) {
    toastError('Seller address must start with 0x');
    return;
  }
  
  if (config.walletEncryptionKey && config.walletEncryptionKey.length < 32) {
    toastError('Encryption key must be at least 32 characters');
    return;
  }
  
  try {
    const response = await fetchJSON('/api/payment/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    
    updatePaymentStatus(config);
    success('Payment configuration saved successfully');
    showPaymentStatus('Configuration saved and will be used by payment services.', 'success');
  } catch (error) {
    console.error('Failed to save payment config:', error);
    toastError('Failed to save payment configuration: ' + (error.message || 'Unknown error'));
    showPaymentStatus('Failed to save configuration: ' + (error.message || 'Unknown error'), 'error');
  }
}

async function testX402Connection() {
  const btn = document.getElementById('testX402Connection');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Testing...';
  
  try {
    const response = await fetchJSON('/api/payment/test-connection');
    if (response.success) {
      success('x402 connection successful');
      showPaymentStatus(`Connected to CDP API. Supported networks: ${response.networks?.length || 0}`, 'success');
    } else {
      toastError('Connection test failed: ' + (response.error || 'Unknown error'));
      showPaymentStatus('Connection test failed: ' + (response.error || 'Unknown error'), 'error');
    }
  } catch (error) {
    console.error('Connection test failed:', error);
    toastError('Connection test failed: ' + (error.message || 'Unknown error'));
    showPaymentStatus('Connection test failed: ' + (error.message || 'Unknown error'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function generateEncryptionKey() {
  // Generate a random 64-character hex string (32 bytes)
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const key = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  document.getElementById('walletEncryptionKey').value = key;
  success('Encryption key generated');
}

function toggleEncryptionKeyVisibility() {
  const input = document.getElementById('walletEncryptionKey');
  const btn = document.getElementById('toggleEncryptionKeyVisibility');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = 'Hide';
  } else {
    input.type = 'password';
    btn.textContent = 'Show';
  }
}

function showPaymentStatus(message, type = 'info') {
  const statusEl = document.getElementById('paymentConfigStatus');
  const statusDiv = statusEl?.querySelector('div');
  if (!statusDiv) return;
  
  const colors = {
    success: 'bg-green-50 border-green-200 text-green-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800',
  };
  
  statusDiv.className = `p-3 rounded border ${colors[type] || colors.info}`;
  statusDiv.textContent = message;
  statusEl.classList.remove('hidden');
  
  setTimeout(() => {
    statusEl.classList.add('hidden');
  }, 5000);
}

function resetPaymentConfig() {
  if (!confirm('Reset payment configuration to defaults?')) return;
  
  document.getElementById('cdpApiKeyId').value = '';
  document.getElementById('cdpApiKeySecret').value = '';
  document.getElementById('sellerAddress').value = '';
  document.getElementById('defaultNetwork').value = 'base-sepolia';
  document.getElementById('enableTestnet').checked = true;
  document.getElementById('walletEncryptionKey').value = '';
  document.getElementById('defaultDailyLimit').value = '100.00';
  
  updatePaymentStatus({});
}

function initPaymentConfigHandlers() {
  document.getElementById('savePaymentConfig')?.addEventListener('click', 
    withButtonLoading(document.getElementById('savePaymentConfig'), savePaymentConfig)
  );
  
  document.getElementById('resetPaymentConfig')?.addEventListener('click', resetPaymentConfig);
  
  document.getElementById('testX402Connection')?.addEventListener('click', testX402Connection);
  
  document.getElementById('generateEncryptionKey')?.addEventListener('click', generateEncryptionKey);
  
  document.getElementById('toggleEncryptionKeyVisibility')?.addEventListener('click', toggleEncryptionKeyVisibility);
}

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
  // detected guilds removed from settings page
  // Tab wiring (default Prompts active)
  const tabPrompts = document.getElementById('tabPrompts');
  const tabSettings = document.getElementById('tabSettings');
  const tabPayments = document.getElementById('tabPayments');
  const tabSecrets = document.getElementById('tabSecrets');
  const panelPrompts = document.getElementById('panelPrompts');
  const panelSettings = document.getElementById('panelSettings');
  const panelPayments = document.getElementById('panelPayments');
  const panelSecrets = document.getElementById('panelSecrets');
  function activate(tab) {
    // styles
    [tabPrompts, tabSettings, tabPayments, tabSecrets].forEach(b => b && b.classList.remove('bg-gray-200', 'font-medium'));
    if (tab) tab.classList.add('bg-gray-200', 'font-medium');
    // panels
    panelPrompts?.classList.add('hidden');
    panelSettings?.classList.add('hidden');
    panelPayments?.classList.add('hidden');
    panelSecrets?.classList.add('hidden');
    if (tab === tabPrompts) panelPrompts?.classList.remove('hidden');
    if (tab === tabSettings) panelSettings?.classList.remove('hidden');
    if (tab === tabPayments) panelPayments?.classList.remove('hidden');
    if (tab === tabSecrets) panelSecrets?.classList.remove('hidden');
  }
  tabPrompts?.addEventListener('click', () => activate(tabPrompts));
  tabSettings?.addEventListener('click', () => activate(tabSettings));
  tabPayments?.addEventListener('click', () => {
    activate(tabPayments);
    loadPaymentConfig();
  });
  tabSecrets?.addEventListener('click', () => activate(tabSecrets));
  activate(tabPrompts);

  // Payment configuration handlers
  initPaymentConfigHandlers();
});
