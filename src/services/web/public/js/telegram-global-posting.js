/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Global Telegram Posting Admin Page Script
 */

document.addEventListener('DOMContentLoaded', () => {
  const api = window.AdminAPI || {};
  const ui = window.AdminUI || { success: console.log, error: console.error };
  const auth = window.AdminAuth || {};

  const els = {
    botToken: document.getElementById('bot-token'),
    channelId: document.getElementById('channel-id'),
    saveToken: document.getElementById('save-token'),
    saveChannel: document.getElementById('save-channel'),
    testBot: document.getElementById('test-bot'),
    tokenStatus: document.getElementById('token-status'),
    channelStatus: document.getElementById('channel-status'),
    botConfiguredStatus: document.getElementById('bot-configured-status'),
    enabled: document.getElementById('cfg-enabled'),
    rateHourly: document.getElementById('cfg-rate-hourly'),
    minInterval: document.getElementById('cfg-min-interval'),
    saveConfig: document.getElementById('save-config'),
    refresh: document.getElementById('refresh-config'),
    status: document.getElementById('config-status'),
    diag: document.getElementById('diag-log'),
  };

  init();

  function init() {
    loadConfig();
    els.refresh.addEventListener('click', loadConfig);
    els.saveToken.addEventListener('click', saveBotToken);
    els.saveChannel.addEventListener('click', saveChannelId);
    els.testBot.addEventListener('click', testBotConnection);
    els.saveConfig.addEventListener('click', savePostingConfig);
  }

  async function apiFetch(url, opts = {}) {
    if (api.apiFetch) return api.apiFetch(url, opts);
    const res = await fetch(url, opts);
    if (!res.ok) {
      const text = await res.text();
      let errorMsg;
      try {
        const json = JSON.parse(text);
        errorMsg = json.error || `HTTP ${res.status}`;
      } catch {
        errorMsg = `HTTP ${res.status}`;
      }
      throw new Error(errorMsg);
    }
    return res.json();
  }

  async function getSignedHeaders(meta = {}) {
    if (auth.getSignedHeaders) return auth.getSignedHeaders(meta);
    return {}; // fallback (dev only)
  }

  async function fetchCsrf() {
    try {
      const r = await fetch('/api/admin/csrf-token');
      if (!r.ok) return '';
      const j = await r.json();
      return j.csrfToken || '';
    } catch { return ''; }
  }

  async function loadConfig() {
    try {
      els.status.textContent = 'Loading configuration...';
      appendDiag('Loading configuration...');
      
      const data = await apiFetch('/api/telegramauth/global/config');
      
      // Update bot status
      if (data.hasGlobalBot && data.hasChannelId) {
        els.botConfiguredStatus.innerHTML = '<span class="text-green-600">✓ Bot configured and ready</span>';
      } else {
        const missing = [];
        if (!data.hasGlobalBot) missing.push('bot token');
        if (!data.hasChannelId) missing.push('channel ID');
        els.botConfiguredStatus.innerHTML = `<span class="text-yellow-600">⚠ Missing: ${missing.join(', ')}</span>`;
      }
      
      // Update channel ID field (but not bot token for security)
      if (data.channelId) {
        els.channelId.value = data.channelId;
      }
      
      // Update posting config
      setForm(data);
      
      els.status.textContent = 'Configuration loaded at ' + new Date().toLocaleTimeString();
      appendDiag('Configuration loaded successfully');
    } catch (e) {
      ui.error(e.message || 'Failed to load config');
      els.status.textContent = 'Load failed';
      appendDiag('Load failed: ' + (e.message || e));
    }
  }

  function setForm(cfg) {
    els.enabled.value = String(cfg.enabled === undefined ? false : !!cfg.enabled);
    els.rateHourly.value = cfg?.rate?.hourly || 10;
    els.minInterval.value = cfg?.rate?.minIntervalSec || 180;
  }

  async function saveBotToken() {
    try {
      const token = els.botToken.value.trim();
      if (!token) {
        ui.error('Please enter a bot token');
        return;
      }
      
      els.tokenStatus.innerHTML = '<span class="text-blue-600">Saving...</span>';
      appendDiag('Saving bot token...');
      
      const headers = {
        'Content-Type': 'application/json',
        ...(await getSignedHeaders({ op: 'save_telegram_token' })),
        'x-csrf-token': await fetchCsrf()
      };
      
      const data = await apiFetch('/api/telegramauth/global/token', {
        method: 'POST',
        headers,
        body: JSON.stringify({ botToken: token })
      });
      
      els.tokenStatus.innerHTML = '<span class="text-green-600">✓ Token saved and bot initialized</span>';
      els.botToken.value = ''; // Clear for security
      appendDiag('Bot token saved and initialized successfully');
      ui.success('Bot token saved');
      
      // Refresh config to update status
      setTimeout(loadConfig, 500);
    } catch (e) {
      els.tokenStatus.innerHTML = `<span class="text-red-600">✗ ${e.message}</span>`;
      appendDiag('Save token failed: ' + (e.message || e));
      ui.error(e.message || 'Failed to save token');
    }
  }

  async function saveChannelId() {
    try {
      const channelId = els.channelId.value.trim();
      if (!channelId) {
        ui.error('Please enter a channel ID');
        return;
      }
      
      els.channelStatus.innerHTML = '<span class="text-blue-600">Saving...</span>';
      appendDiag('Saving channel ID...');
      
      const headers = {
        'Content-Type': 'application/json',
        ...(await getSignedHeaders({ op: 'save_telegram_channel' })),
        'x-csrf-token': await fetchCsrf()
      };
      
      const data = await apiFetch('/api/telegramauth/global/channel', {
        method: 'POST',
        headers,
        body: JSON.stringify({ channelId })
      });
      
      els.channelStatus.innerHTML = '<span class="text-green-600">✓ Channel ID saved</span>';
      appendDiag('Channel ID saved successfully');
      ui.success('Channel ID saved');
      
      // Refresh config to update status
      setTimeout(loadConfig, 500);
    } catch (e) {
      els.channelStatus.innerHTML = `<span class="text-red-600">✗ ${e.message}</span>`;
      appendDiag('Save channel failed: ' + (e.message || e));
      ui.error(e.message || 'Failed to save channel ID');
    }
  }

  async function testBotConnection() {
    try {
      appendDiag('Testing bot connection...');
      
      const headers = {
        'Content-Type': 'application/json',
        ...(await getSignedHeaders({ op: 'test_telegram_bot' })),
        'x-csrf-token': await fetchCsrf()
      };
      
      const data = await apiFetch('/api/telegramauth/global/test', {
        method: 'POST',
        headers
      });
      
      if (data.success && data.botInfo) {
        appendDiag(`✓ Bot connected: @${data.botInfo.username} (${data.botInfo.firstName})`);
        ui.success('Bot connection successful');
      } else {
        appendDiag('Bot test returned unexpected response');
      }
    } catch (e) {
      appendDiag('✗ Bot test failed: ' + (e.message || e));
      ui.error(e.message || 'Bot test failed');
    }
  }

  async function savePostingConfig() {
    try {
      els.status.textContent = 'Saving...';
      appendDiag('Saving posting configuration...');
      
      const body = {
        enabled: els.enabled.value === 'true',
        rate: {
          hourly: parseInt(els.rateHourly.value, 10) || 10,
          minIntervalSec: parseInt(els.minInterval.value, 10) || 180
        }
      };
      
      const headers = {
        'Content-Type': 'application/json',
        ...(await getSignedHeaders({ op: 'save_telegram_config' })),
        'x-csrf-token': await fetchCsrf()
      };
      
      const data = await apiFetch('/api/telegramauth/global/config', {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });
      
      ui.success('Configuration saved');
      els.status.textContent = 'Saved at ' + new Date().toLocaleTimeString();
      appendDiag('Posting configuration saved successfully');
    } catch (e) {
      ui.error(e.message || 'Save failed');
      els.status.textContent = 'Save failed';
      appendDiag('Save config failed: ' + (e.message || e));
    }
  }

  function appendDiag(line) {
    const now = new Date().toLocaleTimeString();
    const current = els.diag.textContent;
    if (current === 'Ready...') {
      els.diag.textContent = `[${now}] ${line}`;
    } else {
      els.diag.textContent = current + '\n' + `[${now}] ${line}`;
    }
    els.diag.scrollTop = els.diag.scrollHeight;
  }
});
