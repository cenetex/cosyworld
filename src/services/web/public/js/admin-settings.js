// Refactored to use shared AdminAPI/AdminUI wrappers
// NOTE: Converted previously absolute /js/admin/* imports to relative paths for bundler compatibility
import { apiFetch } from './admin/admin-api.js';
import { success, error as toastError, withButtonLoading } from './admin/admin-ui.js';
import { ensureWallet } from './admin/admin-auth.js';
import { escapeHtml } from './utils/dom.js';
import { signMessage } from './services/wallet.js';

async function fetchJSON(url, opts) {
  // Backward compatibility shim (will migrate all calls to apiFetch gradually)
  return apiFetch(url, { json: true, ...(opts||{}), requireCsrf: !!(opts && opts.method && opts.method !== 'GET') });
}

function scopeLabel(source) {
  if (source === 'guild') return 'Override';
  if (source === 'env') return 'Env';
  return 'Global';
}

function sanitizeNonNegativeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}

function normalizeNotificationPrefs(raw = {}) {
  return {
    onlySwapEvents: !!raw.onlySwapEvents,
    transferAggregationUsdThreshold: sanitizeNonNegativeNumber(raw.transferAggregationUsdThreshold)
  };
}

let selectedGuildId = '';
let guildListData = [];
let selectedGuildMeta = null; // { id, name, authorized, iconUrl }

const DEFAULT_WALLET_AVATAR_PREFS = {
  createFullAvatar: false,
  minBalanceForFullAvatar: 0,
  autoActivate: false,
  sendIntro: false,
  requireClaimedAvatar: false,
  requireCollectionOwnership: false,
  collectionKeys: []
};

const DEFAULT_NOTIFICATION_PREFS = {
  onlySwapEvents: false,
  transferAggregationUsdThreshold: 0
};

const GUILD_TOOL_NAMES = ['summon', 'breed', 'attack', 'defend', 'move', 'remember', 'create', 'x', 'item', 'respond'];

let guildConfigMessageTimer = null;
let guildConfigHandlersBound = false;

function setRateLimitInputsState(enabled) {
  const container = document.getElementById('rate-limit-inputs');
  if (!container) return;
  container.querySelectorAll('input').forEach(input => {
    const el = input;
    el.disabled = !enabled;
    el.classList.toggle('bg-gray-100', !enabled);
    el.classList.toggle('opacity-70', !enabled);
  });
}

function showGuildConfigMessage(message, type = 'info') {
  const el = document.getElementById('guild-config-message');
  if (!el) return;
  if (guildConfigMessageTimer) {
    clearTimeout(guildConfigMessageTimer);
    guildConfigMessageTimer = null;
  }
  const base = 'mb-4 px-3 py-2 rounded text-sm';
  const palette = {
    info: 'bg-blue-50 text-blue-800 border border-blue-200',
    success: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
    error: 'bg-red-50 text-red-800 border border-red-200'
  };
  if (!message) {
    el.className = `hidden ${base}`;
    el.textContent = '';
    return;
  }
  el.className = `${base} ${palette[type] || palette.info}`;
  el.textContent = message;
  if (!el.classList.contains('hidden')) {
    // no-op to appease lint
  }
  el.classList.remove('hidden');
  if (type !== 'info') {
    guildConfigMessageTimer = setTimeout(() => {
      el.className = `hidden ${base}`;
      el.textContent = '';
      guildConfigMessageTimer = null;
    }, 5000);
  }
}

function addAvatarTribeOverride(channelId = '', config = { mode: 'permit', emojis: [] }) {
  const container = document.getElementById('avatar-tribe-restrictions-channels');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'avatar-tribe-override-row flex flex-col gap-2 rounded-md border border-dashed border-gray-300 p-3 sm:flex-row sm:items-end sm:gap-4';
  const emojis = Array.isArray(config?.emojis) ? config.emojis.join(', ') : '';
  row.innerHTML = `
    <div class="sm:flex-1">
      <label class="block text-xs font-medium text-gray-600">Channel ID</label>
      <input type="text" class="avatar-tribe-channel-id mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500" value="${escapeHtml(channelId || '')}" placeholder="Channel ID" />
    </div>
    <div class="sm:w-40">
      <label class="block text-xs font-medium text-gray-600">Mode</label>
      <select class="avatar-tribe-mode-select mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500">
        <option value="permit">Permit listed emojis</option>
        <option value="forbid">Forbid listed emojis</option>
      </select>
    </div>
    <div class="sm:flex-[1.5]">
      <label class="block text-xs font-medium text-gray-600">Emojis</label>
      <input type="text" class="avatar-tribe-exceptions-input mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500" value="${escapeHtml(emojis)}" placeholder="🦄, 🐉" />
    </div>
    <button type="button" class="remove-avatar-tribe-override self-start sm:self-center text-sm text-red-600 hover:text-red-700">Remove</button>
  `;
  const select = row.querySelector('.avatar-tribe-mode-select');
  if (select) select.value = config?.mode === 'forbid' ? 'forbid' : 'permit';
  row.querySelector('.remove-avatar-tribe-override')?.addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function populateGuildForm(guildConfig = {}) {
  const form = document.getElementById('guild-settings-form');
  if (!form) return;
  const resolvedConfig = guildConfig || {};
  const guildIdInput = document.getElementById('guild-id');
  if (guildIdInput) guildIdInput.value = resolvedConfig.guildId || resolvedConfig.id || selectedGuildId || '';
  const guildNameInput = document.getElementById('guild-name');
  if (guildNameInput) guildNameInput.value = resolvedConfig.guildName || resolvedConfig.name || '';
  const summonerRoleInput = document.getElementById('summoner-role');
  if (summonerRoleInput) summonerRoleInput.value = resolvedConfig.summonerRole || '';
  const adminRolesInput = document.getElementById('admin-roles');
  if (adminRolesInput) {
    const roles = Array.isArray(resolvedConfig.adminRoles) ? resolvedConfig.adminRoles : [];
    adminRolesInput.value = roles.join(', ');
  }
  const authorizedCheckbox = document.getElementById('guild-authorized');
  if (authorizedCheckbox) authorizedCheckbox.checked = !!resolvedConfig.authorized;

  const rateLimiting = resolvedConfig.rateLimiting || {};
  const rateMessagesInput = document.getElementById('rate-limit-messages');
  if (rateMessagesInput) rateMessagesInput.value = rateLimiting.messages ?? 5;
  const rateIntervalInput = document.getElementById('rate-limit-interval');
  if (rateIntervalInput) rateIntervalInput.value = rateLimiting.interval ?? 60;
  const rateLimitEnabledCheckbox = document.getElementById('rate-limit-enabled');
  const rateEnabled = rateLimiting.enabled !== false;
  if (rateLimitEnabledCheckbox) rateLimitEnabledCheckbox.checked = rateEnabled;
  setRateLimitInputsState(rateEnabled);

  const toolEmojis = resolvedConfig.toolEmojis || {};
  GUILD_TOOL_NAMES.forEach(name => {
    const input = document.getElementById(`tool-emoji-${name}`);
    if (input) input.value = toolEmojis[name] || '';
  });
  const summonEmojiInput = document.getElementById('tool-emoji-summon');
  if (summonEmojiInput && !summonEmojiInput.value) {
    summonEmojiInput.value = resolvedConfig.summonEmoji || '';
  }

  const features = resolvedConfig.features || {};
  const breedingInput = document.getElementById('feature-breeding');
  if (breedingInput) breedingInput.checked = !!features.breeding;
  const combatInput = document.getElementById('feature-combat');
  if (combatInput) combatInput.checked = !!features.combat;
  const itemInput = document.getElementById('feature-item-creation');
  if (itemInput) itemInput.checked = !!features.itemCreation;
  const moderationInput = document.getElementById('feature-moderation');
  if (moderationInput) moderationInput.checked = features.moderation !== false;
  const viewDetailsInput = document.getElementById('feature-view-details');
  if (viewDetailsInput) viewDetailsInput.checked = resolvedConfig.viewDetailsEnabled !== false;

  const avatarModes = resolvedConfig.avatarModes || {};
  const freeMode = document.getElementById('avatar-mode-free');
  if (freeMode) freeMode.checked = avatarModes.free !== false;
  
  // Backwards compat: if legacy 'wallet' exists, apply to both new modes
  const hasLegacyWallet = avatarModes.wallet !== undefined;
  const onChainMode = document.getElementById('avatar-mode-on-chain');
  if (onChainMode) onChainMode.checked = hasLegacyWallet ? avatarModes.wallet !== false : avatarModes.onChain !== false;
  const collectionMode = document.getElementById('avatar-mode-collection');
  if (collectionMode) collectionMode.checked = hasLegacyWallet ? avatarModes.wallet !== false : avatarModes.collection !== false;
  
  const pureModelMode = document.getElementById('avatar-mode-pure-model');
  if (pureModelMode) pureModelMode.checked = avatarModes.pureModel !== false;

  const prompts = resolvedConfig.prompts || {};
  const introPrompt = document.getElementById('intro-prompt');
  if (introPrompt) introPrompt.value = prompts.intro || '';
  const summonPrompt = document.getElementById('summon-prompt');
  if (summonPrompt) summonPrompt.value = prompts.summon || '';
  const attackPrompt = document.getElementById('attack-prompt');
  if (attackPrompt) attackPrompt.value = prompts.attack || '';
  const defendPrompt = document.getElementById('defend-prompt');
  if (defendPrompt) defendPrompt.value = prompts.defend || '';
  const breedPrompt = document.getElementById('breed-prompt');
  if (breedPrompt) breedPrompt.value = prompts.breed || '';

  const tribeConfig = resolvedConfig.avatarTribeRestrictions || {};
  const defaultRestrictions = tribeConfig.default || {};
  const tribeMode = document.getElementById('avatar-tribe-mode');
  if (tribeMode) tribeMode.value = defaultRestrictions.mode === 'forbid' ? 'forbid' : 'permit';
  const tribeExceptions = document.getElementById('avatar-tribe-exceptions');
  if (tribeExceptions) tribeExceptions.value = Array.isArray(defaultRestrictions.emojis) ? defaultRestrictions.emojis.join(', ') : '';
  const channelsContainer = document.getElementById('avatar-tribe-restrictions-channels');
  if (channelsContainer) {
    channelsContainer.innerHTML = '';
    const channels = Array.isArray(tribeConfig.channels)
      ? tribeConfig.channels
      : Object.entries(tribeConfig.channels || {}).map(([channelId, cfg]) => ({ channelId, ...cfg }));
    channels.forEach(entry => {
      const channelId = entry?.channelId || entry?.id || '';
      if (channelId) {
        addAvatarTribeOverride(channelId, entry);
      }
    });
  }
}

function collectGuildFormData() {
  const guildId = (document.getElementById('guild-id')?.value || '').trim();
  const guildName = (document.getElementById('guild-name')?.value || '').trim();
  const summonerRole = (document.getElementById('summoner-role')?.value || '').trim();
  const summonEmoji = (document.getElementById('tool-emoji-summon')?.value || '').trim();
  const adminRolesRaw = document.getElementById('admin-roles')?.value || '';
  const adminRoles = adminRolesRaw.split(',').map(role => role.trim()).filter(Boolean);
  const rateMessages = parseInt(document.getElementById('rate-limit-messages')?.value ?? '', 10);
  const rateInterval = parseInt(document.getElementById('rate-limit-interval')?.value ?? '', 10);
  const rateLimitEnabled = document.getElementById('rate-limit-enabled')?.checked !== false;
  const rateLimiting = {
    enabled: rateLimitEnabled,
    messages: Number.isFinite(rateMessages) && rateMessages > 0 ? rateMessages : 5,
    interval: Number.isFinite(rateInterval) && rateInterval > 0 ? rateInterval : 60
  };

  const toolEmojis = {};
  GUILD_TOOL_NAMES.forEach(name => {
    const value = document.getElementById(`tool-emoji-${name}`)?.value || '';
    toolEmojis[name] = value.trim();
  });

  const data = {
    guildId,
    name: guildName,
    summonerRole,
    summonEmoji,
    adminRoles,
    authorized: !!document.getElementById('guild-authorized')?.checked,
    whitelisted: !!document.getElementById('guild-authorized')?.checked,
    rateLimiting,
    toolEmojis,
    features: {
      breeding: !!document.getElementById('feature-breeding')?.checked,
      combat: !!document.getElementById('feature-combat')?.checked,
      itemCreation: !!document.getElementById('feature-item-creation')?.checked,
      moderation: !!document.getElementById('feature-moderation')?.checked
    },
    avatarModes: {
      free: !!document.getElementById('avatar-mode-free')?.checked,
      onChain: !!document.getElementById('avatar-mode-on-chain')?.checked,
      collection: !!document.getElementById('avatar-mode-collection')?.checked,
      pureModel: !!document.getElementById('avatar-mode-pure-model')?.checked
    },
    prompts: {
      intro: (document.getElementById('intro-prompt')?.value || '').trim(),
      summon: (document.getElementById('summon-prompt')?.value || '').trim(),
      attack: (document.getElementById('attack-prompt')?.value || '').trim(),
      defend: (document.getElementById('defend-prompt')?.value || '').trim(),
      breed: (document.getElementById('breed-prompt')?.value || '').trim()
    },
    viewDetailsEnabled: !!document.getElementById('feature-view-details')?.checked,
    avatarTribeRestrictions: {
      default: {
        mode: document.getElementById('avatar-tribe-mode')?.value === 'forbid' ? 'forbid' : 'permit',
        emojis: (document.getElementById('avatar-tribe-exceptions')?.value || '')
          .split(',')
          .map(e => e.trim())
          .filter(Boolean)
      },
      channels: {}
    }
  };

  const channelContainer = document.getElementById('avatar-tribe-restrictions-channels');
  if (channelContainer) {
    Array.from(channelContainer.querySelectorAll('.avatar-tribe-override-row')).forEach(row => {
      const channelId = row.querySelector('.avatar-tribe-channel-id')?.value.trim();
      if (!channelId) return;
      const mode = row.querySelector('.avatar-tribe-mode-select')?.value === 'forbid' ? 'forbid' : 'permit';
      const emojis = (row.querySelector('.avatar-tribe-exceptions-input')?.value || '')
        .split(',')
        .map(e => e.trim())
        .filter(Boolean);
      data.avatarTribeRestrictions.channels[channelId] = { mode, emojis };
    });
  }

  return data;
}

async function saveSelectedGuildSettings(event) {
  event?.preventDefault();
  if (!selectedGuildId) {
    showGuildConfigMessage('Select a Discord server before saving.', 'error');
    return;
  }
  const form = document.getElementById('guild-settings-form');
  const submitBtn = form?.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.dataset.originalText = submitBtn.dataset.originalText || submitBtn.textContent || 'Save Settings';
    submitBtn.textContent = 'Requesting signature...';
  }

  try {
    showGuildConfigMessage('Requesting signature to verify changes...', 'info');
    const payload = collectGuildFormData();
    
    // Create a message that includes guild ID and timestamp for signature
    const timestamp = Date.now();
    const message = `Save settings for guild ${selectedGuildId} at ${timestamp}`;
    
    // Request wallet signature
    let signatureData;
    try {
      signatureData = await signMessage(message);
    } catch (signError) {
      // Handle user rejection or wallet not connected
      const errorMsg = signError.message.includes('User rejected') 
        ? 'Signature request was rejected.' 
        : signError.message.includes('Wallet not connected')
        ? 'Please connect your wallet to save settings.'
        : `Signature failed: ${signError.message}`;
      showGuildConfigMessage(errorMsg, 'error');
      return;
    }

    // Update button text after signature obtained
    if (submitBtn) {
      submitBtn.textContent = 'Saving...';
    }

    showGuildConfigMessage('Saving guild settings...', 'info');
    
    // Include signature in payload
    const payloadWithSignature = {
      ...payload,
      _signature: {
        walletAddress: signatureData.walletAddress,
        message: signatureData.message,
        signature: signatureData.signature,
        timestamp
      }
    };
    
    const updated = await fetchJSON(`/api/guilds/${encodeURIComponent(selectedGuildId)}`, {
      method: 'POST',
      body: payloadWithSignature
    });
    showGuildConfigMessage('Guild settings saved successfully.', 'success');
    await refreshGuildList();
    if (updated) populateGuildForm(updated);
    await loadDetectedGuilds();
  } catch (err) {
    console.error('Failed to save guild settings:', err);
    showGuildConfigMessage(err?.message || 'Failed to save guild settings.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = submitBtn.dataset.originalText || 'Save Settings';
    }
  }
}

async function loadGuildConfiguration() {
  const form = document.getElementById('guild-settings-form');
  const emptyState = document.getElementById('guild-config-empty');
  if (!form || !emptyState) return;
  if (!selectedGuildId) {
    form.classList.add('hidden');
    emptyState.classList.remove('hidden');
    emptyState.textContent = 'Select a Discord server from the scope sidebar to edit its configuration.';
    showGuildConfigMessage(null);
    return;
  }
  emptyState.textContent = 'Loading configuration...';
  emptyState.classList.remove('hidden');
  form.classList.add('hidden');
  try {
    const config = await fetchJSON(`/api/guilds/${encodeURIComponent(selectedGuildId)}`);
    populateGuildForm(config || {});
    form.classList.remove('hidden');
    emptyState.classList.add('hidden');
    showGuildConfigMessage(null);
  } catch (err) {
    console.error('Failed to load guild configuration:', err);
    emptyState.textContent = 'Failed to load configuration. Try refreshing or check the server logs.';
    emptyState.classList.remove('hidden');
    form.classList.add('hidden');
    showGuildConfigMessage(err?.message || 'Failed to load guild configuration.', 'error');
  }
}

async function loadDetectedGuilds() {
  const section = document.getElementById('detected-guilds-section');
  const container = document.getElementById('detected-guilds-container');
  const countBadge = document.getElementById('detected-guilds-count');
  const navCount = document.getElementById('detectedServersCount');
  if (!section || !container) return;
  section.classList.remove('hidden');
  container.innerHTML = `
    <div class="flex justify-center py-4">
      <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
    </div>
  `;
  try {
    const res = await fetch('/api/guilds/detected');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const detected = await res.json();
    const unauthorized = Array.isArray(detected) ? detected.filter(g => !g.authorized) : [];
    const countLabel = unauthorized.length.toString();
    if (countBadge) countBadge.textContent = countLabel;
    if (navCount) navCount.textContent = unauthorized.length ? `(${countLabel})` : '';
    container.innerHTML = '';
    if (!unauthorized.length) {
      container.innerHTML = '<p class="text-sm text-gray-500">No unauthorized servers detected. Use the manual form below if you need to add one.</p>';
      return;
    }
    unauthorized
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .forEach(guild => container.appendChild(renderDetectedGuildCard(guild)));
  } catch (err) {
    console.error('Failed to load detected guilds:', err);
    const message = err?.message || 'Failed to load detected servers.';
    container.innerHTML = `<div class="p-4 bg-red-50 text-red-700 rounded-md">${escapeHtml(message)}</div>`;
    showGuildConfigMessage(message, 'error');
  }
}

function renderDetectedGuildCard(guild) {
  const card = document.createElement('div');
  card.className = 'border rounded-md p-4 bg-white shadow-sm flex justify-between items-center gap-4';
  const iconUrl = guild?.icon
    ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`
    : 'https://cdn.discordapp.com/embed/avatars/0.png';
  const detectedAt = guild?.detectedAt ? new Date(guild.detectedAt).toLocaleString() : 'Unknown';
  const memberLine = typeof guild?.memberCount === 'number'
    ? `<p class="text-xs text-gray-400">Members: ${guild.memberCount}</p>`
    : '';
  card.innerHTML = `
    <div class="flex items-center gap-3 min-w-0">
      <img src="${escapeHtml(iconUrl)}" alt="${escapeHtml(guild?.name || 'Guild')}" class="w-10 h-10 rounded-full border border-gray-200 object-cover" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" />
      <div class="min-w-0">
        <h6 class="font-medium text-sm text-gray-900 truncate" title="${escapeHtml(guild?.name || '')}">${escapeHtml(guild?.name || 'Unknown Server')}</h6>
        <p class="text-xs text-gray-500 truncate">ID: ${escapeHtml(String(guild?.id || ''))}</p>
        <p class="text-xs text-gray-400">First detected: ${escapeHtml(detectedAt)}</p>
        ${memberLine}
      </div>
    </div>
    <button class="authorize-guild-btn px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 transition-colors">Authorize</button>
  `;
  const authorizeBtn = card.querySelector('.authorize-guild-btn');
  authorizeBtn?.addEventListener('click', async () => {
    if (!authorizeBtn) return;
    const original = authorizeBtn.textContent;
    authorizeBtn.disabled = true;
    authorizeBtn.textContent = 'Authorizing...';
    authorizeBtn.classList.add('opacity-75');
    try {
      await whitelistDetectedGuild(guild);
      await loadDetectedGuilds();
      await refreshGuildList();
    } catch (err) {
      console.error('Failed to authorize guild:', err);
      showGuildConfigMessage(err?.message || 'Failed to authorize guild.', 'error');
      authorizeBtn.disabled = false;
      authorizeBtn.textContent = original || 'Authorize';
      authorizeBtn.classList.remove('opacity-75');
    }
  });
  return card;
}

async function whitelistDetectedGuild(guild) {
  if (!guild?.id) throw new Error('Missing guild ID');
  const baseConfig = {
    guildId: guild.id,
    name: guild.name,
    icon: guild.icon,
    memberCount: guild.memberCount,
    authorized: true,
    whitelisted: true,
    summonEmoji: '✨',
    adminRoles: [],
    features: { breeding: true, combat: true, itemCreation: true, moderation: true },
    prompts: {
      intro: 'You are now conversing with {avatar_name}, a unique AI character with its own personality and abilities.',
      summon: 'You are {avatar_name}, responding to being summoned by {user_name}.',
      attack: 'You are {avatar_name}, attacking {target_name} with your abilities.',
      defend: 'You are {avatar_name}, defending against an attack.',
      breed: 'You are {avatar_name}, breeding with {target_name} to create a new entity.'
    },
    rateLimiting: { messages: 5, interval: 60 },
    toolEmojis: { summon: '🔮', breed: '🏹', attack: '⚔️', defend: '🛡️' }
  };

  let existingConfig = null;
  try {
    const res = await fetch(`/api/guilds/${encodeURIComponent(guild.id)}`);
    if (res.ok) {
      existingConfig = await res.json();
    }
  } catch (err) {
    console.warn('Unable to lookup existing guild config:', err);
  }

  const payload = existingConfig
    ? { ...existingConfig, ...baseConfig, authorized: true, whitelisted: true, name: guild.name, icon: guild.icon, memberCount: guild.memberCount }
    : baseConfig;

  await fetchJSON('/api/guilds', {
    method: 'POST',
    body: payload
  });
  try {
    await fetchJSON(`/api/guilds/${encodeURIComponent(guild.id)}/clear-cache`, { method: 'POST' });
  } catch (err) {
    console.warn('Failed to clear guild cache:', err);
  }
  showGuildConfigMessage(`Guild "${guild.name}" authorized successfully.`, 'success');
}

async function whitelistGuild(guildId, guildName) {
  await fetchJSON('/api/guilds', {
    method: 'POST',
    body: { guildId, name: guildName, authorized: true, whitelisted: true }
  });
  showGuildConfigMessage(`Guild "${guildName}" authorized successfully.`, 'success');
  await refreshGuildList();
  await loadDetectedGuilds();
}

function setupManualWhitelistButton() {
  const button = document.getElementById('manual-whitelist-button');
  if (!button) return;
  button.addEventListener('click', async event => {
    event.preventDefault();
    const guildIdInput = document.getElementById('manual-guild-id');
    const guildNameInput = document.getElementById('manual-guild-name');
    const guildId = guildIdInput?.value.trim();
    if (!guildId || !/^\d+$/.test(guildId)) {
      showGuildConfigMessage('Please enter a numeric Discord server ID.', 'error');
      return;
    }
    const guildName = guildNameInput?.value.trim() || `Server ${guildId}`;
    const originalText = button.textContent || 'Whitelist Server';
    button.disabled = true;
    button.textContent = 'Whitelisting...';
    try {
      await whitelistGuild(guildId, guildName);
      if (guildIdInput) guildIdInput.value = '';
      if (guildNameInput) guildNameInput.value = '';
    } catch (err) {
      console.error('Failed to whitelist guild manually:', err);
      showGuildConfigMessage(err?.message || 'Failed to whitelist guild.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  });
}

function initGuildConfigHandlers() {
  if (guildConfigHandlersBound) return;
  document.getElementById('guild-settings-form')?.addEventListener('submit', saveSelectedGuildSettings);
  document.getElementById('add-avatar-tribe-override')?.addEventListener('click', () => addAvatarTribeOverride());
  document.getElementById('refreshGuildConfig')?.addEventListener('click', async () => {
    await loadGuildConfiguration();
  });
  document.getElementById('refresh-detected-guilds')?.addEventListener('click', async event => {
    event.preventDefault();
    await loadDetectedGuilds();
  });
  const rateToggle = document.getElementById('rate-limit-enabled');
  if (rateToggle) {
    rateToggle.addEventListener('change', event => {
      const enabled = !!event.target.checked;
      setRateLimitInputsState(enabled);
    });
    setRateLimitInputsState(rateToggle.checked);
  }
  setupManualWhitelistButton();
  guildConfigHandlersBound = true;
}

let walletAvatarPrefsState = null;
let walletAvatarEditorOriginalSymbol = null;
let availableCollections = [];

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
  await loadGuildConfiguration();
  await loadDetectedGuilds();
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

// Replicate configuration state/helpers
const DEFAULT_REPLICATE_SAMPLE_PROMPT = 'A cozy avatar portrait bathed in warm tavern light, painterly watercolor finish.';

let replicateConfigState = {
  tokenConfigured: false,
  tokenMasked: null,
  baseModel: 'black-forest-labs/flux-dev-lora',
  loraWeights: '',
  loraTrigger: ''
};

function hideReplicateSamplePreview() {
  const preview = document.getElementById('replicateSamplePreview');
  const img = document.getElementById('replicateSampleImage');
  const empty = document.getElementById('replicateSampleEmpty');
  if (preview) preview.classList.add('hidden');
  if (img) img.src = '';
  if (empty) empty.classList.remove('hidden');
}

function showReplicateStatus(message, type = 'info') {
  const wrapper = document.getElementById('replicateConfigStatus');
  const box = wrapper?.querySelector('div');
  if (!box) return;
  const palette = {
    success: 'bg-green-50 border border-green-200 text-green-800',
    error: 'bg-red-50 border border-red-200 text-red-800',
    info: 'bg-blue-50 border border-blue-200 text-blue-800'
  };
  box.className = `p-2 rounded text-sm ${palette[type] || palette.info}`;
  box.textContent = message;
  wrapper.classList.remove('hidden');
  setTimeout(() => wrapper.classList.add('hidden'), 5000);
}

function showReplicateSampleStatus(message, type = 'info') {
  const wrapper = document.getElementById('replicateSampleStatus');
  const box = wrapper?.querySelector('div');
  if (!box) return;
  const palette = {
    success: 'bg-green-50 border border-green-200 text-green-800',
    error: 'bg-red-50 border border-red-200 text-red-800',
    info: 'bg-blue-50 border border-blue-200 text-blue-800'
  };
  box.className = `p-2 rounded text-sm ${palette[type] || palette.info}`;
  box.textContent = message;
  wrapper.classList.remove('hidden');
  setTimeout(() => wrapper.classList.add('hidden'), 5000);
}

function populateReplicateForm(state) {
  const tokenInput = document.getElementById('replicateTokenInput');
  const tokenStatus = document.getElementById('replicateTokenStatus');
  const baseInput = document.getElementById('replicateBaseModelInput');
  const weightsInput = document.getElementById('replicateLoraWeightsInput');
  const triggerInput = document.getElementById('replicateLoraTriggerInput');
  const promptInput = document.getElementById('replicateSamplePromptInput');
  const aspectInput = document.getElementById('replicateSampleAspectInput');
  if (tokenInput) tokenInput.value = '';
  if (tokenStatus) {
    if (state.tokenConfigured) {
      const masked = state.tokenMasked ? ` (${state.tokenMasked})` : '';
      tokenStatus.textContent = `Token configured${masked}. Enter a new token to rotate or use Clear to remove.`;
    } else {
      tokenStatus.textContent = 'Token not configured. Add a token to enable Replicate image generation.';
    }
  }
  if (baseInput) baseInput.value = state.baseModel || '';
  if (weightsInput) weightsInput.value = state.loraWeights || '';
  if (triggerInput) triggerInput.value = state.loraTrigger || '';
  if (promptInput) promptInput.value = DEFAULT_REPLICATE_SAMPLE_PROMPT;
  if (aspectInput) aspectInput.value = aspectInput.value || '1:1';
  hideReplicateSamplePreview();
}

async function loadReplicateConfig() {
  try {
    const data = await apiFetch('/api/admin/replicate/config');
    replicateConfigState = {
      tokenConfigured: !!data?.tokenConfigured,
      tokenMasked: data?.tokenMasked || null,
      baseModel: data?.baseModel || 'black-forest-labs/flux-dev-lora',
      loraWeights: data?.loraWeights || '',
      loraTrigger: data?.loraTrigger || ''
    };
    populateReplicateForm(replicateConfigState);
  } catch (err) {
    console.error('Failed to load Replicate configuration:', err);
    toastError(err.message || 'Failed to load Replicate configuration');
  }
}

async function saveReplicateConfig() {
  const baseInput = document.getElementById('replicateBaseModelInput');
  const weightsInput = document.getElementById('replicateLoraWeightsInput');
  const triggerInput = document.getElementById('replicateLoraTriggerInput');
  const tokenInput = document.getElementById('replicateTokenInput');

  const payload = {
    baseModel: (baseInput?.value || '').trim(),
    loraWeights: (weightsInput?.value || '').trim(),
    loraTrigger: (triggerInput?.value || '').trim()
  };

  if (tokenInput) {
    const tokenValue = tokenInput.value.trim();
    if (tokenValue) {
      payload.apiToken = tokenValue;
    }
  }

  try {
    await apiFetch('/api/admin/replicate/config', {
      method: 'POST',
      body: payload,
      requireCsrf: true
    });
    success('Replicate configuration saved');
    showReplicateStatus('Replicate configuration saved successfully.', 'success');
    await loadReplicateConfig();
  } catch (err) {
    console.error('Failed to save Replicate configuration:', err);
    toastError(err.message || 'Failed to save Replicate configuration');
    showReplicateStatus(err.message || 'Failed to save Replicate configuration', 'error');
  } finally {
    if (tokenInput) tokenInput.value = '';
  }
}

async function clearReplicateToken() {
  if (!confirm('Clear the stored Replicate API token?')) return;
  try {
    await apiFetch('/api/admin/replicate/config', {
      method: 'POST',
      body: { apiToken: '' },
      requireCsrf: true
    });
    success('Replicate token cleared');
    showReplicateStatus('Replicate token cleared. Save a new token to re-enable.', 'info');
    await loadReplicateConfig();
  } catch (err) {
    console.error('Failed to clear Replicate token:', err);
    toastError(err.message || 'Failed to clear token');
    showReplicateStatus(err.message || 'Failed to clear token', 'error');
  }
}

async function generateReplicateSample() {
  const baseInput = document.getElementById('replicateBaseModelInput');
  const weightsInput = document.getElementById('replicateLoraWeightsInput');
  const triggerInput = document.getElementById('replicateLoraTriggerInput');
  const tokenInput = document.getElementById('replicateTokenInput');
  const promptInput = document.getElementById('replicateSamplePromptInput');
  const aspectInput = document.getElementById('replicateSampleAspectInput');
  const preview = document.getElementById('replicateSamplePreview');
  const image = document.getElementById('replicateSampleImage');
  const empty = document.getElementById('replicateSampleEmpty');

  const payload = {
    baseModel: (baseInput?.value || '').trim(),
    loraWeights: (weightsInput?.value || '').trim(),
    loraTrigger: (triggerInput?.value || '').trim(),
    prompt: promptInput?.value?.trim() || DEFAULT_REPLICATE_SAMPLE_PROMPT,
    aspectRatio: aspectInput?.value?.trim() || '1:1'
  };

  if (tokenInput) {
    const tokenValue = tokenInput.value.trim();
    if (tokenValue) {
      payload.apiToken = tokenValue;
    }
  }

  showReplicateSampleStatus('Generating sample image...', 'info');
  if (preview) preview.classList.add('hidden');
  if (empty) empty.classList.add('hidden');

  try {
    const result = await apiFetch('/api/admin/replicate/sample', {
      method: 'POST',
      body: payload,
      requireCsrf: true
    });
    if (image && result?.imageUrl) {
      image.src = result.imageUrl;
      image.alt = 'Replicate sample preview';
      preview?.classList.remove('hidden');
    } else {
      if (preview) preview.classList.add('hidden');
      if (image) image.src = '';
      empty?.classList.remove('hidden');
    }
    showReplicateSampleStatus('Sample generated successfully.', 'success');
  } catch (err) {
    console.error('Replicate sample generation failed:', err);
    showReplicateSampleStatus(err.message || 'Failed to generate sample image.', 'error');
    if (preview) preview.classList.add('hidden');
    if (image) image.src = '';
    if (empty) empty.classList.remove('hidden');
  }
}

function resetReplicateConfigForm() {
  document.getElementById('replicateConfigStatus')?.classList.add('hidden');
  document.getElementById('replicateSampleStatus')?.classList.add('hidden');
  populateReplicateForm(replicateConfigState);
}

function initReplicateConfigHandlers() {
  const saveBtn = document.getElementById('saveReplicateConfig');
  if (saveBtn) {
    saveBtn.addEventListener('click', withButtonLoading(saveBtn, saveReplicateConfig));
  }
  document.getElementById('resetReplicateConfig')?.addEventListener('click', resetReplicateConfigForm);
  const clearBtn = document.getElementById('clearReplicateToken');
  if (clearBtn) {
    clearBtn.addEventListener('click', withButtonLoading(clearBtn, clearReplicateToken));
  }
  const sampleBtn = document.getElementById('generateReplicateSample');
  if (sampleBtn) {
    sampleBtn.addEventListener('click', withButtonLoading(sampleBtn, generateReplicateSample));
  }
}

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
  if (!Number.isFinite(config.defaultDailyLimit) || config.defaultDailyLimit < 0) {
    config.defaultDailyLimit = 100 * 1e6;
  }

  try {
    await apiFetch('/api/payment/config', {
      method: 'POST',
      body: config,
      requireCsrf: true
    });
    success('Payment configuration saved successfully');
    showPaymentStatus('Configuration saved and will be used by payment services.', 'success');
    await loadPaymentConfig();
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
  const collectionKeys = Array.isArray(raw.collectionKeys) 
    ? raw.collectionKeys.filter(k => typeof k === 'string' && k.trim()).map(k => k.trim())
    : [];
  return {
    createFullAvatar: !!raw.createFullAvatar,
    minBalanceForFullAvatar: sanitizedBalance,
    autoActivate: !!raw.autoActivate,
    sendIntro: !!raw.sendIntro,
    requireClaimedAvatar: !!raw.requireClaimedAvatar,
    requireCollectionOwnership: !!raw.requireCollectionOwnership,
    collectionKeys
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
    walletAvatar: normalizeWalletAvatarDefaults(raw.walletAvatar || {}),
    notifications: normalizeNotificationPrefs(raw.notifications || {})
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
        <label class="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" id="walletAvatarDefaultRequireCollection" class="rounded" />
          Only respond for wallets that hold collection NFTs
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
  container.querySelector('#walletAvatarDefaultRequireCollection').checked = !!defaults.requireCollectionOwnership;

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
          sendIntro: container.querySelector('#walletAvatarDefaultSendIntro').checked,
          requireCollectionOwnership: container.querySelector('#walletAvatarDefaultRequireCollection').checked
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
    const { symbol, displayEmoji, aliasSymbols, addresses, walletAvatar, notifications } = override;
    const safeSymbol = escapeHtml(symbol || '');
    const safeEmoji = escapeHtml(displayEmoji || '🪙');
    const aliasText = aliasSymbols && aliasSymbols.length ? aliasSymbols.map(val => escapeHtml(val)).join(', ') : '';
    const addressesText = addresses && addresses.length ? addresses.map(val => escapeHtml(val)).join(', ') : '';
    const minBalanceValue = Number(walletAvatar.minBalanceForFullAvatar);
    const minBalanceSanitized = Number.isFinite(minBalanceValue) && minBalanceValue >= 0 ? minBalanceValue : 0;
    const minBalanceDisplay = minBalanceSanitized.toLocaleString(undefined, { maximumFractionDigits: 4 });

    const transferThresholdValue = sanitizeNonNegativeNumber(notifications?.transferAggregationUsdThreshold);
    const transferThresholdDisplay = transferThresholdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    
    const collectionKeys = Array.isArray(walletAvatar.collectionKeys) ? walletAvatar.collectionKeys : [];
    const collectionsText = collectionKeys.length 
      ? collectionKeys.map(key => {
          const coll = availableCollections.find(c => {
            const comparisonKey = typeof c?.key === 'string' ? c.key.trim() : String(c?.key || '');
            return comparisonKey === key;
          });
          const label = coll
            ? (typeof coll.displayName === 'string' && coll.displayName.trim() ? coll.displayName.trim() : coll.key || key)
            : `${key} (not configured)`;
          return escapeHtml(label);
        }).join(', ')
      : '';
    
    const summaryParts = [
      `Min balance: ${minBalanceDisplay}`,
      `Full avatars: ${walletAvatar.createFullAvatar ? 'Enabled' : 'Disabled'}`,
      `Auto-activate: ${walletAvatar.autoActivate ? 'Yes' : 'No'}`,
      `Intro: ${walletAvatar.sendIntro ? 'Yes' : 'No'}`
    ];
    if (walletAvatar.requireClaimedAvatar) {
      summaryParts.push('Claimed NFTs only');
    }
    if (walletAvatar.requireCollectionOwnership) {
      summaryParts.push('Collection NFTs required');
    }
    summaryParts.push(
      transferThresholdValue > 0
        ? `Discord transfer summary at $${transferThresholdDisplay}`
        : 'Discord transfer summary disabled'
    );
    const summary = summaryParts.join(' • ');

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
          ${collectionsText ? `<div class="text-xs text-gray-500">Collections: ${collectionsText}</div>` : ''}
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
  delete editor.__tokenFormState;
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
    ? {
        ...existing,
        walletAvatar: normalizeWalletAvatarDefaults(existing.walletAvatar),
        notifications: normalizeNotificationPrefs(existing.notifications || {})
      }
    : {
        symbol: '',
        displayEmoji: '',
        aliasSymbols: [],
        addresses: [],
        walletAvatar: { ...DEFAULT_WALLET_AVATAR_PREFS },
        notifications: { ...DEFAULT_NOTIFICATION_PREFS }
      };

  const safeSymbol = escapeHtml(formState.symbol || '');
  const safeEmoji = escapeHtml(formState.displayEmoji || '');
  const safeAliases = escapeHtml(formState.aliasSymbols.join(', '));
  const safeAddresses = escapeHtml(formState.addresses.join(', '));
  const transferThresholdValue = sanitizeNonNegativeNumber(formState.notifications?.transferAggregationUsdThreshold);
  const safeTransferThreshold = transferThresholdValue.toString();

  const collectionKeys = Array.isArray(formState.walletAvatar?.collectionKeys)
    ? formState.walletAvatar.collectionKeys
        .map(key => (typeof key === 'string' ? key.trim() : ''))
        .filter(Boolean)
    : [];
  const selectedCollectionKeys = new Set(collectionKeys);

  const renderedCollectionCheckboxes = availableCollections
    .map(coll => {
      const normalizedKey = typeof coll?.key === 'string' ? coll.key.trim() : String(coll?.key || '');
      if (!normalizedKey) return '';
      const checked = selectedCollectionKeys.has(normalizedKey) ? 'checked' : '';
      const primaryLabel = typeof coll?.displayName === 'string' && coll.displayName.trim()
        ? coll.displayName.trim()
        : normalizedKey;
      const metaLabelParts = [];
      if (coll?.chain) metaLabelParts.push(escapeHtml(String(coll.chain).toUpperCase()));
      if (coll?.provider) metaLabelParts.push(escapeHtml(String(coll.provider)));
      const metaSuffix = metaLabelParts.length ? ` <span class="text-xs text-gray-400">(${metaLabelParts.join(' • ')})</span>` : '';
      return `
        <label class="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" class="wallet-avatar-collection rounded mt-1" value="${escapeHtml(normalizedKey)}" ${checked} />
          <span>
            <span class="font-medium">${escapeHtml(primaryLabel)}</span>
            <span class="block text-xs text-gray-500">${escapeHtml(normalizedKey)}${metaSuffix}</span>
          </span>
        </label>
      `;
    })
    .filter(Boolean)
    .join('');

  const missingCollectionKeys = [...selectedCollectionKeys].filter(key => !availableCollections.some(coll => {
    const comparisonKey = typeof coll?.key === 'string' ? coll.key.trim() : String(coll?.key || '');
    return comparisonKey === key;
  }));
  const missingCollectionCheckboxes = missingCollectionKeys
    .map(key => `
        <label class="flex items-start gap-2 text-sm text-yellow-700">
          <input type="checkbox" class="wallet-avatar-collection rounded mt-1" value="${escapeHtml(key)}" checked />
          <span>
            <span class="font-medium">${escapeHtml(key)}</span>
            <span class="block text-xs text-yellow-600">No matching collection configuration found</span>
          </span>
        </label>
      `)
    .join('');

  const collectionsSectionContent = (renderedCollectionCheckboxes || missingCollectionCheckboxes)
    ? `<div id="walletAvatarCollections" class="flex flex-col gap-2 max-h-52 overflow-y-auto border border-gray-200 rounded px-3 py-2 bg-gray-50">${renderedCollectionCheckboxes}${missingCollectionCheckboxes}</div>`
    : `<div id="walletAvatarCollections" class="text-xs text-gray-500 border border-dashed border-gray-300 rounded px-3 py-2 bg-gray-50">No NFT collections configured yet. Add collections from the Collections admin page.</div>`;

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
      <fieldset class="md:col-span-2">
        <legend class="block text-sm font-medium text-gray-700 mb-1">NFT Collections</legend>
        ${collectionsSectionContent}
        <p class="text-xs text-gray-500 mt-1">Check the collections that should trigger wallet avatars for this token. Leave all unchecked to allow any registered collection.</p>
      </fieldset>
    </div>
    <div class="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
      <label class="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" id="walletAvatarRequireClaimed" class="rounded" ${formState.walletAvatar.requireClaimedAvatar ? 'checked' : ''} />
        Only allow claimed NFT avatars
      </label>
      <label class="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" id="walletAvatarRequireCollection" class="rounded" ${formState.walletAvatar.requireCollectionOwnership ? 'checked' : ''} />
        Only respond for wallets that hold collection NFTs
      </label>
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
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="walletAvatarTransferThreshold">Discord Transfer Threshold (USD)</label>
        <input type="number" id="walletAvatarTransferThreshold" min="0" step="0.01" class="w-full px-3 py-2 border rounded text-sm" value="${safeTransferThreshold}" />
        <p class="text-xs text-gray-500 mt-1">Transfers below this USD amount are batched until cumulative volume between the same wallets passes the threshold.</p>
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

  editor.__tokenFormState = {
    ...formState,
    aliasSymbols: [...formState.aliasSymbols],
    addresses: [...formState.addresses],
    walletAvatar: {
      ...formState.walletAvatar,
      collectionKeys: [...selectedCollectionKeys]
    },
    notifications: { ...formState.notifications }
  };

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
  const transferThresholdInput = editor.querySelector('#walletAvatarTransferThreshold');
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

  const transferThresholdRaw = transferThresholdInput?.value ?? '';
  const transferThresholdNumber = Number(transferThresholdRaw);
  if (transferThresholdRaw && (!Number.isFinite(transferThresholdNumber) || transferThresholdNumber < 0)) {
    toastError('Discord transfer threshold must be a non-negative number');
    transferThresholdInput?.focus();
    return;
  }

  const currentFormState = editor.__tokenFormState || {};
  const baseNotifications = normalizeNotificationPrefs(currentFormState.notifications || {});
  const notifications = {
    ...baseNotifications,
    transferAggregationUsdThreshold: sanitizeNonNegativeNumber(transferThresholdRaw, 0)
  };

  // Extract selected collections from checkbox list
  const selectedCollections = Array.from(
    editor.querySelectorAll('.wallet-avatar-collection:checked'),
    input => (typeof input.value === 'string' ? input.value.trim() : '')
  ).filter(Boolean);
  const uniqueCollectionKeys = Array.from(new Set(selectedCollections));

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
      sendIntro: editor.querySelector('#walletAvatarSendIntro')?.checked || false,
      requireClaimedAvatar: editor.querySelector('#walletAvatarRequireClaimed')?.checked || false,
      requireCollectionOwnership: editor.querySelector('#walletAvatarRequireCollection')?.checked || false,
      collectionKeys: uniqueCollectionKeys
    },
    notifications
  };

  editor.__tokenFormState = {
    ...currentFormState,
    ...payload,
    aliasSymbols: [...payload.aliasSymbols],
    addresses: [...payload.addresses],
    walletAvatar: { ...payload.walletAvatar, collectionKeys: [...uniqueCollectionKeys] },
    notifications: { ...notifications }
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

async function loadCollections() {
  try {
    const response = await apiFetch('/api/admin/collections/configs');
    availableCollections = Array.isArray(response?.data) ? response.data : [];
  } catch (error) {
    console.error('Failed to load collections:', error);
    availableCollections = [];
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
  initGuildConfigHandlers();
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
  tabSettings?.addEventListener('click', async () => {
    activate(tabSettings);
    await loadGuildConfiguration();
    await loadDetectedGuilds();
    await loadReplicateConfig();
    await loadCollections();
    await loadWalletAvatarPreferences();
  });
  tabPayments?.addEventListener('click', () => {
    activate(tabPayments);
    loadPaymentConfig();
  });
  tabSecrets?.addEventListener('click', () => activate(tabSecrets));
  activate(tabPrompts);

  // Payment configuration handlers
  initReplicateConfigHandlers();
  initPaymentConfigHandlers();

  // Wallet avatar preference handlers
  initWalletAvatarPreferenceHandlers();

  // Preload wallet avatar preferences and collections for initial render
  await loadReplicateConfig();
  await loadCollections();
  await loadWalletAvatarPreferences();
});
