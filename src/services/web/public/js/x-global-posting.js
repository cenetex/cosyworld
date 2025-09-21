/**
 * Global X Posting Admin Page Script
 */

document.addEventListener('DOMContentLoaded', () => {
  const api = window.AdminAPI || {};
  const ui = window.AdminUI || { success: console.log, error: console.error };
  const auth = window.AdminAuth || {};

  const els = {
    enabled: document.getElementById('cfg-enabled'),
    mode: document.getElementById('cfg-mode'),
    globalAvatarId: document.getElementById('cfg-globalAvatarId'),
    rateHourly: document.getElementById('cfg-rate-hourly'),
    hashtags: document.getElementById('cfg-hashtags'),
    altAutogen: document.getElementById('cfg-altAutogen'),
    save: document.getElementById('save-config'),
    refresh: document.getElementById('refresh-config'),
    test: document.getElementById('test-post'),
    status: document.getElementById('config-status'),
    diag: document.getElementById('diag-log'),
  };

  init();

  function init() {
    loadConfig();
    els.refresh.addEventListener('click', loadConfig);
    els.save.addEventListener('click', saveConfig);
    els.test.addEventListener('click', testPost);
  }

  async function apiFetch(url, opts = {}) {
    if (api.apiFetch) return api.apiFetch(url, opts);
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function getSignedHeaders(meta = {}) {
    if (auth.getSignedHeaders) return auth.getSignedHeaders(meta);
    return {}; // fallback (dev only)
  }

  async function loadConfig() {
    try {
      els.status.textContent = 'Loading configuration...';
      const data = await apiFetch('/api/admin/x-posting/config');
      const cfg = data?.config || {};
      if (!cfg._id) {
        els.status.textContent = 'No config document yet (will use defaults until saved).';
      } else {
        els.status.textContent = 'Configuration loaded.';
      }
      setForm(cfg);
    } catch (e) {
      ui.error(e.message || 'Failed to load config');
      els.status.textContent = 'Load failed';
    }
  }

  function setForm(cfg) {
    els.enabled.value = String(cfg.enabled === undefined ? false : !!cfg.enabled);
    els.mode.value = cfg.mode === 'shadow' ? 'shadow' : 'live';
    els.globalAvatarId.value = cfg.globalAvatarId || '';
    els.rateHourly.value = cfg?.rate?.hourly || '';
    els.hashtags.value = Array.isArray(cfg.hashtags) ? cfg.hashtags.join(',') : '';
    els.altAutogen.checked = !!(cfg.media && cfg.media.altAutogen);
  }

  function collectForm() {
    const hashtags = els.hashtags.value.split(/[,\s]+/).map(t => t.trim()).filter(Boolean);
    const payload = {
      enabled: els.enabled.value === 'true',
      mode: els.mode.value,
      globalAvatarId: els.globalAvatarId.value.trim() || undefined,
      rate: { hourly: els.rateHourly.value ? Number(els.rateHourly.value) : undefined },
      hashtags,
      media: { altAutogen: !!els.altAutogen.checked },
    };
    if (!payload.rate.hourly) delete payload.rate;
    return payload;
  }

  async function saveConfig() {
    try {
      els.status.textContent = 'Saving...';
      const body = collectForm();
      const headers = { 'Content-Type': 'application/json', ...(await getSignedHeaders({ op: 'save_global_x_config' })), 'x-csrf-token': await fetchCsrf() };
      const res = await fetch('/api/admin/x-posting/config', { method: 'PUT', headers, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      ui.success('Configuration saved');
      els.status.textContent = 'Saved at ' + new Date().toLocaleTimeString();
      setForm(data.config || {});
    } catch (e) {
      ui.error(e.message || 'Save failed');
      els.status.textContent = 'Save failed';
    }
  }

  async function testPost() {
    try {
      const mediaUrl = prompt('Enter image/video URL to test posting');
      if (!mediaUrl) return;
      els.diag.textContent = 'Triggering test post...';
      const headers = { 'Content-Type': 'application/json', ...(await getSignedHeaders({ op: 'test_global_x_post' })), 'x-csrf-token': await fetchCsrf() };
      const res = await fetch('/api/admin/x-posting/test', { method: 'POST', headers, body: JSON.stringify({ mediaUrl, text: 'Admin test post', type: mediaUrl.match(/\.mp4$/i) ? 'video' : 'image' }) });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      els.diag.textContent = JSON.stringify(data, null, 2);
      ui.success('Test path executed');
    } catch (e) {
      ui.error(e.message || 'Test failed');
      appendDiag('Test failed: ' + (e.message || e));
    }
  }

  function appendDiag(line) {
    els.diag.textContent = (els.diag.textContent + '\n' + line).trim();
  }

  async function fetchCsrf() {
    try {
      const r = await fetch('/api/admin/csrf-token');
      if (!r.ok) return '';
      const j = await r.json();
      return j.csrfToken || '';
    } catch { return ''; }
  }
});
