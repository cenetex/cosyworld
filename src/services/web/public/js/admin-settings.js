// Refactored to use shared AdminAPI/AdminUI wrappers
// NOTE: Converted previously absolute /js/admin/* imports to relative paths for bundler compatibility
import { apiFetch } from './admin/admin-api.js';
import { success, error as toastError, withButtonLoading } from './admin/admin-ui.js';
import { ensureWallet } from './admin/admin-auth.js';
import { escapeHtml } from './utils/dom.js';

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

const DEFAULT_WALLET_AVATAR_PREFS = {
  createFullAvatar: false,
  minBalanceForFullAvatar: 0,
  autoActivate: false,
  sendIntro: false
};

let walletAvatarPrefsState = null;
let walletAvatarEditorOriginalSymbol = null;

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
  
  if (config.apiKeySecret) {
    const secret = config.apiKeySecret.trim();
    
    // Check if it's Ed25519 format (base64, ends with ==)
    const isEd25519 = /^[A-Za-z0-9+/]+==$/.test(secret) && secret.length > 80;
    
    // Check if it's ECDSA PEM format
    const isECDSA = secret.includes('-----BEGIN EC PRIVATE KEY-----') && 
                    secret.includes('-----END EC PRIVATE KEY-----');
    
    if (!isEd25519 && !isECDSA) {
      toastError('CDP API Key Secret must be either:\n' +
                 '1. Ed25519 format (base64 string ending with ==)\n' +
                 '2. ECDSA PEM format (BEGIN EC PRIVATE KEY)\n\n' +
                 'Copy the COMPLETE secret from your CDP portal.');
      return;
    }
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

function normalizeWalletAvatarDefaults(raw = {}) {
  const numericValue = Number(raw.minBalanceForFullAvatar);
  const sanitizedBalance = Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : 0;
  return {
    createFullAvatar: !!raw.createFullAvatar,
    minBalanceForFullAvatar: sanitizedBalance,
    autoActivate: !!raw.autoActivate,
    sendIntro: !!raw.sendIntro
  };
}

function normalizeWalletAvatarOverride(raw = {}) {
  const aliasSource = Array.isArray(raw.aliasSymbols)
    ? raw.aliasSymbols
    : Array.isArray(raw.symbols)
      ? raw.symbols
      : [];
  const aliasSeen = new Set();
  const aliasSymbols = aliasSource
    .map(alias => (typeof alias === 'string' ? alias.trim().toUpperCase() : ''))
    .filter(alias => {
      if (!alias) return false;
      if (aliasSeen.has(alias)) return false;
      aliasSeen.add(alias);
      return true;
    });
  const addressesSource = Array.isArray(raw.addresses) ? raw.addresses : [];
  const addressSeen = new Set();
  const addresses = addressesSource
    .map(addr => (addr ? String(addr).trim().toLowerCase() : ''))
    .filter(addr => {
      if (!addr) return false;
      if (addressSeen.has(addr)) return false;
      addressSeen.add(addr);
      return true;
    });
  return {
    symbol: typeof raw.symbol === 'string' ? raw.symbol.trim().toUpperCase() : '',
    displayEmoji: raw.displayEmoji ?? null,
    aliasSymbols,
    addresses,
    walletAvatar: normalizeWalletAvatarDefaults(raw.walletAvatar || {})
  };
}

function getWalletAvatarDefaultsState() {
  if (!walletAvatarPrefsState?.defaults?.walletAvatar) {
    return { ...DEFAULT_WALLET_AVATAR_PREFS };
  }
  const normalized = normalizeWalletAvatarDefaults(walletAvatarPrefsState.defaults.walletAvatar);
  return { ...DEFAULT_WALLET_AVATAR_PREFS, ...normalized };
}

function showWalletAvatarPreferencesStatus(message, type = 'info') {
  const statusEl = document.getElementById('walletAvatarStatus');
  const statusDiv = statusEl?.querySelector('div');
  if (!statusDiv) return;
  const palette = {
    success: 'bg-green-50 border border-green-200 text-green-800',
    error: 'bg-red-50 border border-red-200 text-red-800',
    info: 'bg-blue-50 border border-blue-200 text-blue-800'
  };
  statusDiv.className = `p-2 rounded text-sm ${palette[type] || palette.info}`;
  statusDiv.textContent = message;
  statusEl.classList.remove('hidden');
  setTimeout(() => statusEl.classList.add('hidden'), 5000);
}

function renderWalletAvatarDefaults() {
  const container = document.getElementById('walletAvatarDefaults');
  if (!container) return;
  const defaults = getWalletAvatarDefaultsState();

  container.innerHTML = `
    <div class="bg-white border rounded-lg p-4">
      <div class="flex items-center justify-between mb-3">
        <h5 class="text-sm font-semibold text-gray-800">Global Defaults</h5>
        <span class="text-xs text-gray-500">Applied when no token override exists</span>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label class="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" id="walletAvatarDefaultCreateFull" class="rounded" />
          Generate full avatars by default
        </label>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1" for="walletAvatarDefaultMinBalance">Minimum Balance</label>
          <input type="number" id="walletAvatarDefaultMinBalance" min="0" step="0.0001" class="w-full px-3 py-2 border rounded text-sm" />
          <p class="text-xs text-gray-500 mt-1">Token balance required before generating a full avatar.</p>
        </div>
        <label class="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" id="walletAvatarDefaultAutoActivate" class="rounded" />
          Auto-activate avatars in Discord
        </label>
        <label class="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" id="walletAvatarDefaultSendIntro" class="rounded" />
          Send introduction message on creation
        </label>
      </div>
      <div class="flex justify-end gap-2 mt-4">
        <button type="button" id="walletAvatarDefaultsReset" class="px-3 py-1 bg-gray-200 text-gray-700 rounded text-sm hover:bg-gray-300">Revert</button>
        <button type="button" id="walletAvatarDefaultsSave" class="px-3 py-1 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700">Save Defaults</button>
      </div>
    </div>
  `;

  container.querySelector('#walletAvatarDefaultCreateFull').checked = !!defaults.createFullAvatar;
  container.querySelector('#walletAvatarDefaultMinBalance').value = defaults.minBalanceForFullAvatar ?? 0;
  container.querySelector('#walletAvatarDefaultAutoActivate').checked = !!defaults.autoActivate;
  container.querySelector('#walletAvatarDefaultSendIntro').checked = !!defaults.sendIntro;

  container.querySelector('#walletAvatarDefaultsReset')?.addEventListener('click', () => renderWalletAvatarDefaults());

  const saveBtn = container.querySelector('#walletAvatarDefaultsSave');
  saveBtn?.addEventListener('click', withButtonLoading(saveBtn, async () => {
    const minBalanceInput = container.querySelector('#walletAvatarDefaultMinBalance');
    const minBalance = Number(minBalanceInput.value);
    if (!Number.isFinite(minBalance) || minBalance < 0) {
      toastError('Minimum balance must be a non-negative number');
      minBalanceInput.focus();
      return;
    }

    const walletStatus = await ensureWallet();
    if (!walletStatus?.ok) {
      const msg = walletStatus?.error?.message || 'Connect your wallet before saving defaults';
      toastError(msg);
      return;
    }

    const payload = {
      walletAvatar: {
        createFullAvatar: container.querySelector('#walletAvatarDefaultCreateFull').checked,
        minBalanceForFullAvatar: minBalance,
        autoActivate: container.querySelector('#walletAvatarDefaultAutoActivate').checked,
        sendIntro: container.querySelector('#walletAvatarDefaultSendIntro').checked
      }
    };

    try {
      await apiFetch('/api/admin/token-preferences/defaults', {
        method: 'PUT',
        body: payload,
        requireCsrf: true,
        sign: true
      });
      showWalletAvatarPreferencesStatus('Wallet avatar defaults saved', 'success');
      await loadWalletAvatarPreferences();
    } catch (error) {
      console.error('Failed to save wallet avatar defaults:', error);
      toastError(error.message || 'Failed to save defaults');
      showWalletAvatarPreferencesStatus(error.message || 'Failed to save defaults', 'error');
    }
  }));
}

function renderWalletAvatarOverrides() {
  const container = document.getElementById('walletAvatarOverrides');
  if (!container) return;
  const overrides = Array.isArray(walletAvatarPrefsState?.overrides)
    ? walletAvatarPrefsState.overrides.slice().sort((a, b) => a.symbol.localeCompare(b.symbol))
    : [];

  if (!overrides.length) {
    container.innerHTML = '<div class="text-sm text-gray-500">No token overrides configured. Use "Add Token Override" to customize behaviour for specific tokens.</div>';
    return;
  }

  container.innerHTML = '';
  overrides.forEach(override => {
    const card = document.createElement('div');
    card.className = 'bg-white border rounded-lg p-4';
    const { symbol, displayEmoji, aliasSymbols, addresses, walletAvatar } = override;
    const safeSymbol = escapeHtml(symbol || '');
    const safeEmoji = escapeHtml(displayEmoji || '🪙');
    const aliasText = aliasSymbols && aliasSymbols.length ? aliasSymbols.map(val => escapeHtml(val)).join(', ') : '';
    const addressesText = addresses && addresses.length ? addresses.map(val => escapeHtml(val)).join(', ') : '';
    const minBalanceValue = Number(walletAvatar.minBalanceForFullAvatar);
    const minBalanceSanitized = Number.isFinite(minBalanceValue) && minBalanceValue >= 0 ? minBalanceValue : 0;
    const minBalanceDisplay = minBalanceSanitized.toLocaleString(undefined, { maximumFractionDigits: 4 });
    const summary = [
      `Min balance: ${minBalanceDisplay}`,
      `Full avatars: ${walletAvatar.createFullAvatar ? 'Enabled' : 'Disabled'}`,
      `Auto-activate: ${walletAvatar.autoActivate ? 'Yes' : 'No'}`,
      `Intro: ${walletAvatar.sendIntro ? 'Yes' : 'No'}`
    ].join(' • ');

    card.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div class="space-y-2">
          <div class="flex items-center gap-2 text-gray-900 font-medium">
            <span class="text-lg">${safeEmoji}</span>
            <span>${safeSymbol}</span>
          </div>
          <div class="text-xs text-gray-500">${summary}</div>
          ${aliasText ? `<div class="text-xs text-gray-500">Aliases: ${aliasText}</div>` : ''}
          ${addressesText ? `<div class="text-xs text-gray-500">Addresses: ${addressesText}</div>` : ''}
        </div>
        <div class="flex gap-2 shrink-0">
          <button type="button" class="wallet-avatar-edit px-3 py-1 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200">Edit</button>
          <button type="button" class="wallet-avatar-delete px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700">Delete</button>
        </div>
      </div>
    `;

    const editBtn = card.querySelector('.wallet-avatar-edit');
    if (editBtn) {
      editBtn.dataset.symbol = symbol;
      editBtn.addEventListener('click', () => openWalletAvatarEditor(symbol));
    }
    const deleteBtn = card.querySelector('.wallet-avatar-delete');
    deleteBtn?.addEventListener('click', withButtonLoading(deleteBtn, async () => {
      await deleteWalletAvatarOverride(symbol);
    }));
    if (deleteBtn) deleteBtn.dataset.symbol = symbol;

    container.appendChild(card);
  });
}

function closeWalletAvatarEditor() {
  const editor = document.getElementById('walletAvatarEditor');
  if (!editor) return;
  editor.classList.add('hidden');
  editor.innerHTML = '';
  walletAvatarEditorOriginalSymbol = null;
}

function parseListInput(value, { toLower = false } = {}) {
  if (!value) return [];
  return value
    .split(/[,\n\s]+/)
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => (toLower ? entry.toLowerCase() : entry))
    .filter((entry, index, self) => self.indexOf(entry) === index);
}

function getRegisteredTokenOptions() {
  const map = new Map();
  if (!walletAvatarPrefsState) return [];

  const addToken = (input = {}) => {
    const symbol = typeof input.symbol === 'string' ? input.symbol.trim().toUpperCase() : '';
    const aliasSource = Array.isArray(input.aliasSymbols)
      ? input.aliasSymbols
      : Array.isArray(input.symbols)
        ? input.symbols
        : [];
    const aliasSymbols = aliasSource
      .map(alias => (typeof alias === 'string' ? alias.trim().toUpperCase() : ''))
      .filter(Boolean);
    const addressesSource = Array.isArray(input.addresses) ? input.addresses : [];
    const addresses = addressesSource
      .map(addr => (addr ? String(addr).trim().toLowerCase() : ''))
      .filter(Boolean);
    const primaryAddress = input.primaryAddress ? String(input.primaryAddress).trim().toLowerCase() : (addresses[0] || '');
    const key = symbol || primaryAddress;
    if (!key) return;

    if (!map.has(key)) {
      map.set(key, {
        key,
        symbol,
        name: typeof input.name === 'string' ? input.name : '',
        addresses: new Set(),
        aliasSymbols: new Set(),
        displayEmoji: typeof input.displayEmoji === 'string' ? input.displayEmoji : '',
        sources: new Set(),
        primaryAddress: primaryAddress || ''
      });
    }
    const entry = map.get(key);
    if (symbol) entry.symbol = symbol;
    if (input.name && !entry.name) entry.name = input.name;
    if (input.displayEmoji && !entry.displayEmoji) entry.displayEmoji = input.displayEmoji;
    if (primaryAddress) entry.primaryAddress = primaryAddress;
    addresses.forEach(addr => entry.addresses.add(addr));
    aliasSymbols.forEach(alias => {
      if (alias && alias !== entry.symbol) entry.aliasSymbols.add(alias);
    });
    const sources = Array.isArray(input.sources)
      ? input.sources
      : typeof input.source === 'string'
        ? [input.source]
        : [];
    sources.forEach(source => {
      if (source) entry.sources.add(source);
    });
  };

  const registeredTokens = Array.isArray(walletAvatarPrefsState.registeredTokens)
    ? walletAvatarPrefsState.registeredTokens
    : [];
  registeredTokens.forEach(token => addToken(token));

  const overrides = Array.isArray(walletAvatarPrefsState.overrides)
    ? walletAvatarPrefsState.overrides
    : [];
  overrides.forEach(override => {
    addToken({
      symbol: override.symbol,
      aliasSymbols: override.aliasSymbols,
      addresses: override.addresses,
      displayEmoji: override.displayEmoji,
      source: 'override'
    });
  });

  const prioritySymbols = Array.isArray(walletAvatarPrefsState.prioritySymbols)
    ? walletAvatarPrefsState.prioritySymbols
    : [];
  prioritySymbols.forEach(symbol => addToken({ symbol, source: 'priority' }));

  return Array.from(map.values()).map(entry => {
    const addresses = Array.from(entry.addresses);
    const aliasSymbols = Array.from(entry.aliasSymbols);
    const sources = Array.from(entry.sources);
    const parts = [];
    if (entry.displayEmoji) parts.push(entry.displayEmoji);
    const primaryLabel = entry.symbol || entry.primaryAddress || addresses[0] || entry.key;
    if (primaryLabel) parts.push(primaryLabel);
    const nameLabel = entry.name ? `- ${entry.name}` : '';
    const label = nameLabel ? `${parts.join(' ')} ${nameLabel}` : parts.join(' ');
    return {
      key: entry.key,
      symbol: entry.symbol,
      name: entry.name,
      addresses,
      aliasSymbols,
      displayEmoji: entry.displayEmoji,
      sources,
      primaryAddress: entry.primaryAddress,
      label: label || entry.key
    };
  }).sort((a, b) => {
    const aKey = a.symbol || a.primaryAddress || a.label;
    const bKey = b.symbol || b.primaryAddress || b.label;
    return aKey.localeCompare(bKey);
  });
}

function renderWalletAvatarTokenPicker(editor, formState) {
  const picker = editor.querySelector('#walletAvatarTokenPicker');
  if (!picker) return;
  const options = getRegisteredTokenOptions();
  if (!options.length) {
    picker.innerHTML = '<p class="text-xs text-gray-500">No registered tokens discovered yet. Configure tracked tokens or priority symbols to enable quick selection.</p>';
    return;
  }

  picker.innerHTML = `
    <label class="block text-sm font-medium text-gray-700 mb-1" for="walletAvatarTokenSelect">Registered Token</label>
    <div class="flex flex-col md:flex-row gap-2 md:items-center">
      <select id="walletAvatarTokenSelect" class="w-full md:w-auto border rounded px-3 py-2 text-sm">
        <option value="">Select registered token</option>
      </select>
      <button type="button" id="walletAvatarTokenApply" class="px-3 py-1 bg-gray-100 text-gray-700 rounded text-sm hover:bg-gray-200">Apply Token Details</button>
    </div>
    <p class="text-xs text-gray-500 mt-1">Applying fills symbol, aliases, addresses, and emoji when available.</p>
  `;

  const select = picker.querySelector('#walletAvatarTokenSelect');
  options.forEach(option => {
    const opt = document.createElement('option');
    opt.value = option.key;
    opt.textContent = option.label;
    select.appendChild(opt);
  });

  const initialSymbol = formState.symbol ? formState.symbol.trim().toUpperCase() : '';
  const initialAddresses = Array.isArray(formState.addresses)
    ? formState.addresses.map(addr => (addr ? String(addr).trim().toLowerCase() : '')).filter(Boolean)
    : [];
  let initialOption = options.find(option => option.symbol === initialSymbol);
  if (!initialOption && initialAddresses.length) {
    initialOption = options.find(option => option.addresses.some(addr => initialAddresses.includes(addr)));
  }
  if (initialOption) select.value = initialOption.key;

  const applyBtn = picker.querySelector('#walletAvatarTokenApply');
  applyBtn?.addEventListener('click', () => {
    if (!select.value) {
      toastError('Select a registered token first');
      return;
    }
    const chosen = options.find(option => option.key === select.value);
    if (!chosen) return;
    const symbolInput = editor.querySelector('#walletAvatarSymbol');
    const emojiInput = editor.querySelector('#walletAvatarEmoji');
    const aliasesInput = editor.querySelector('#walletAvatarAliases');
    const addressesInput = editor.querySelector('#walletAvatarAddresses');
    if (symbolInput && chosen.symbol) {
      symbolInput.value = chosen.symbol;
    }
    if (emojiInput) {
      emojiInput.value = chosen.displayEmoji || '';
    }
    if (aliasesInput) {
      aliasesInput.value = chosen.aliasSymbols.length ? chosen.aliasSymbols.join(', ') : '';
    }
    if (addressesInput) {
      addressesInput.value = chosen.addresses.length ? chosen.addresses.join(', ') : '';
    }
    showWalletAvatarPreferencesStatus('Token details applied from registry', 'info');
  });
}

function openWalletAvatarEditor(symbol = null) {
  const editor = document.getElementById('walletAvatarEditor');
  if (!editor) return;

  const existing = symbol ? walletAvatarPrefsState?.overrides?.find(o => o.symbol === symbol) : null;
  walletAvatarEditorOriginalSymbol = existing?.symbol || null;
  const formState = existing
    ? { ...existing, walletAvatar: normalizeWalletAvatarDefaults(existing.walletAvatar) }
    : {
        symbol: '',
        displayEmoji: '',
        aliasSymbols: [],
        addresses: [],
        walletAvatar: { ...DEFAULT_WALLET_AVATAR_PREFS }
      };

  const safeSymbol = escapeHtml(formState.symbol || '');
  const safeEmoji = escapeHtml(formState.displayEmoji || '');
  const safeAliases = escapeHtml(formState.aliasSymbols.join(', '));
  const safeAddresses = escapeHtml(formState.addresses.join(', '));

  editor.className = 'border rounded-lg bg-white p-4';
  editor.classList.remove('hidden');

  editor.innerHTML = `
    <div class="flex items-center justify-between mb-3">
      <h5 class="text-sm font-semibold text-gray-800">${existing ? `Edit ${existing.symbol}` : 'Add Token Override'}</h5>
      <button type="button" id="walletAvatarEditorClose" class="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div id="walletAvatarTokenPicker" class="md:col-span-2"></div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="walletAvatarSymbol">Token Symbol</label>
        <input id="walletAvatarSymbol" type="text" class="w-full px-3 py-2 border rounded text-sm uppercase" placeholder="e.g. PROJECT89" value="${safeSymbol}" />
        <p class="text-xs text-gray-500 mt-1">Primary symbol (stored in uppercase).</p>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="walletAvatarEmoji">Display Emoji</label>
        <input id="walletAvatarEmoji" type="text" maxlength="10" class="w-full px-3 py-2 border rounded text-sm" placeholder="Optional" value="${safeEmoji}" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="walletAvatarAliases">Alias Symbols</label>
        <input id="walletAvatarAliases" type="text" class="w-full px-3 py-2 border rounded text-sm" placeholder="RATi,$RATi" value="${safeAliases}" />
        <p class="text-xs text-gray-500 mt-1">Comma or space separated alternate symbols.</p>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="walletAvatarAddresses">Token Addresses</label>
        <input id="walletAvatarAddresses" type="text" class="w-full px-3 py-2 border rounded text-sm" placeholder="Optional mint addresses" value="${safeAddresses}" />
        <p class="text-xs text-gray-500 mt-1">Comma or space separated list (stored in lowercase).</p>
      </div>
    </div>
    <div class="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
      <label class="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" id="walletAvatarCreateFull" class="rounded" ${formState.walletAvatar.createFullAvatar ? 'checked' : ''} />
        Generate full avatars
      </label>
      <label class="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" id="walletAvatarAutoActivate" class="rounded" ${formState.walletAvatar.autoActivate ? 'checked' : ''} />
        Auto-activate in Discord
      </label>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="walletAvatarMinBalance">Minimum Balance</label>
        <input type="number" id="walletAvatarMinBalance" min="0" step="0.0001" class="w-full px-3 py-2 border rounded text-sm" value="${formState.walletAvatar.minBalanceForFullAvatar}" />
      </div>
      <label class="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" id="walletAvatarSendIntro" class="rounded" ${formState.walletAvatar.sendIntro ? 'checked' : ''} />
        Send introduction message
      </label>
    </div>
    <div class="flex justify-end gap-2 mt-4">
      <button type="button" id="walletAvatarEditorCancel" class="px-3 py-1 bg-gray-200 text-gray-700 rounded text-sm hover:bg-gray-300">Cancel</button>
      <button type="button" id="walletAvatarEditorSave" class="px-3 py-1 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700">Save Override</button>
    </div>
  `;

  editor.querySelector('#walletAvatarEditorClose')?.addEventListener('click', closeWalletAvatarEditor);
  editor.querySelector('#walletAvatarEditorCancel')?.addEventListener('click', closeWalletAvatarEditor);

  renderWalletAvatarTokenPicker(editor, formState);

  const saveBtn = editor.querySelector('#walletAvatarEditorSave');
  saveBtn?.addEventListener('click', withButtonLoading(saveBtn, async () => {
    await submitWalletAvatarOverride(editor);
  }));
}

async function submitWalletAvatarOverride(editor) {
  const symbolInput = editor.querySelector('#walletAvatarSymbol');
  const minBalanceInput = editor.querySelector('#walletAvatarMinBalance');
  if (!symbolInput) return;

  const symbol = symbolInput.value.trim();
  if (!symbol) {
    toastError('Token symbol is required');
    symbolInput.focus();
    return;
  }

  const normalizedSymbol = symbol.toUpperCase();

  const minBalance = Number(minBalanceInput?.value ?? 0);
  if (!Number.isFinite(minBalance) || minBalance < 0) {
    toastError('Minimum balance must be a non-negative number');
    minBalanceInput.focus();
    return;
  }

  const payload = {
    symbol: normalizedSymbol,
    originalSymbol: walletAvatarEditorOriginalSymbol,
    displayEmoji: editor.querySelector('#walletAvatarEmoji')?.value.trim() || null,
    aliasSymbols: parseListInput(editor.querySelector('#walletAvatarAliases')?.value || '').map(val => val.toUpperCase()),
    addresses: parseListInput(editor.querySelector('#walletAvatarAddresses')?.value || '', { toLower: true }),
    walletAvatar: {
      createFullAvatar: editor.querySelector('#walletAvatarCreateFull')?.checked || false,
      minBalanceForFullAvatar: minBalance,
      autoActivate: editor.querySelector('#walletAvatarAutoActivate')?.checked || false,
      sendIntro: editor.querySelector('#walletAvatarSendIntro')?.checked || false
    }
  };

  try {
    const walletStatus = await ensureWallet();
    if (!walletStatus?.ok) {
      const msg = walletStatus?.error?.message || 'Connect your wallet before saving overrides';
      toastError(msg);
      return;
    }

    await apiFetch('/api/admin/token-preferences', {
      method: 'PUT',
      body: payload,
      requireCsrf: true,
      sign: true
    });
  showWalletAvatarPreferencesStatus(`Token override saved for ${payload.symbol}`, 'success');
    closeWalletAvatarEditor();
    await loadWalletAvatarPreferences();
  } catch (error) {
    console.error('Failed to save token override:', error);
    toastError(error.message || 'Failed to save token override');
    showWalletAvatarPreferencesStatus(error.message || 'Failed to save token override', 'error');
  }
}

async function deleteWalletAvatarOverride(symbol) {
  if (!symbol) return;
  if (!confirm(`Delete wallet avatar override for ${symbol}?`)) return;
  try {
    const walletStatus = await ensureWallet();
    if (!walletStatus?.ok) {
      const msg = walletStatus?.error?.message || 'Connect your wallet before deleting overrides';
      toastError(msg);
      return;
    }

    await apiFetch(`/api/admin/token-preferences/${encodeURIComponent(symbol)}`, {
      method: 'DELETE',
      requireCsrf: true,
      sign: true
    });
    showWalletAvatarPreferencesStatus(`Override removed for ${symbol}`, 'success');
    await loadWalletAvatarPreferences();
  } catch (error) {
    console.error('Failed to delete token override:', error);
    toastError(error.message || 'Failed to delete override');
    showWalletAvatarPreferencesStatus(error.message || 'Failed to delete override', 'error');
  }
}

async function loadWalletAvatarPreferences() {
  try {
    const data = await apiFetch('/api/admin/token-preferences');
    walletAvatarPrefsState = {
      defaults: data?.defaults || { walletAvatar: { ...DEFAULT_WALLET_AVATAR_PREFS } },
      overrides: Array.isArray(data?.overrides) ? data.overrides.map(normalizeWalletAvatarOverride) : [],
      prioritySymbols: Array.isArray(data?.prioritySymbols)
        ? data.prioritySymbols.map(symbol => (typeof symbol === 'string' ? symbol.trim().toUpperCase() : symbol)).filter(Boolean)
        : [],
      registeredTokens: Array.isArray(data?.registeredTokens) ? data.registeredTokens : []
    };
    renderWalletAvatarDefaults();
    renderWalletAvatarOverrides();
    closeWalletAvatarEditor();
  } catch (error) {
    console.error('Failed to load token preferences:', error);
    toastError('Failed to load wallet avatar preferences');
  }
}

function initWalletAvatarPreferenceHandlers() {
  document.getElementById('addWalletAvatarOverride')?.addEventListener('click', () => openWalletAvatarEditor());
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
  tabSettings?.addEventListener('click', () => {
    activate(tabSettings);
    loadWalletAvatarPreferences();
  });
  tabPayments?.addEventListener('click', () => {
    activate(tabPayments);
    loadPaymentConfig();
  });
  tabSecrets?.addEventListener('click', () => activate(tabSecrets));
  activate(tabPrompts);

  // Payment configuration handlers
  initPaymentConfigHandlers();

  // Wallet avatar preference handlers
  initWalletAvatarPreferenceHandlers();

  // Preload wallet avatar preferences for initial render
  await loadWalletAvatarPreferences();
});
