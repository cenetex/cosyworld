import { initializeWallet, connectWallet, signWriteHeaders } from './services/wallet.js';

async function fetchStats() {
  try {
    const res = await fetch('/api/admin/stats');
    if (!res.ok) return;
    const data = await res.json();
    const counts = data.counts || {};
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v ?? '--'; };
    setText('stat-avatars', counts.avatars ?? '--');
    setText('stat-items', counts.items ?? '--');
    setText('stat-locations', counts.locations ?? '--');
    setText('stat-memories', counts.memories ?? '--');
  } catch (e) {
    console.warn('Failed to load stats', e);
  }
}

async function ensureAdminSession() {
  // After wallet connect, try a simple server verify to create user (client-only demo)
  // Real flow: call /api/auth/nonce then sign and POST /api/auth/verify
  const status = document.getElementById('admin-login-status');
  const state = window.state || {};
  if (!state.wallet?.publicKey) {
    if (status) status.textContent = 'Connect with Phantom to access admin features';
    return;
  }

  if (status) status.textContent = 'Wallet connected. Click to verify admin access…';
}

function wirePhantomLogin() {
  // Inject a click handler to run full nonce/sign/verify when wallet connects
  window.addEventListener('wallet:connected', async () => {
    await doVerify();
  });

  async function doVerify() {
    try {
      const address = window.state?.wallet?.publicKey;
      if (!address) return;
      const nonceRes = await fetch('/api/auth/nonce', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address }) });
      if (!nonceRes.ok) throw new Error('Failed to get nonce');
      const { nonce } = await nonceRes.json();

      const provider = window?.phantom?.solana;
      if (!provider) throw new Error('Phantom not available');
      const encoded = new TextEncoder().encode(nonce);
      const { signature } = await provider.signMessage(encoded, 'utf8');

      // Phantom returns a Uint8Array signature; send as array for simplicity
      const verifyRes = await fetch('/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address, nonce, signature: Array.from(signature) }) });
      const data = await verifyRes.json();
      const status = document.getElementById('admin-login-status');
      if (verifyRes.ok && data?.user) {
        if (status) status.textContent = data.user.isAdmin ? 'Admin access granted' : 'Logged in (no admin rights)';
      } else {
        if (status) status.textContent = data?.error || 'Verification failed';
      }
    } catch (e) {
      const status = document.getElementById('admin-login-status');
      if (status) status.textContent = `Login error: ${e.message}`;
      console.error(e);
    }
  }
}

function init() {
  initializeWallet();
  fetchStats();
  ensureAdminSession();
  wirePhantomLogin();
  wireGlobalXToggle();
  // Order: first wire unified toggle (loads config), then account (loads profile) so pills can update coherently
  // wireGlobalXToggle removed (global X posting page & toggle deprecated)
  wireAdminX();
  wireOAuth1Form();
}

// Wait for both DOM ready and admin bootstrap readiness (so window.AdminAPI is present)
function onReady(fn){
  if (document.readyState === 'complete' || document.readyState === 'interactive') { setTimeout(fn,0); }
  else document.addEventListener('DOMContentLoaded', fn);
}
let _bootstrapReady = false;
window.addEventListener('admin:bootstrapReady', () => { _bootstrapReady = true; });
onReady(() => {
  // If bootstrap not yet ready, poll briefly
  const start = Date.now();
  (function waitBootstrap(){
    if (_bootstrapReady || (window.AdminAPI && window.AdminAuth)) return init();
    if (Date.now() - start > 3000) { // 3s timeout
      console.warn('[admin-dashboard] bootstrap not detected; continuing anyway');
      return init();
    }
    setTimeout(waitBootstrap, 50);
  })();
});

async function wireAdminX() {
  const connectBtn = document.getElementById('admin-x-connect');
  const disconnectBtn = document.getElementById('admin-x-disconnect');
  // Refresh profile button removed (auto-refresh via connect/disconnect events)
  const hint = document.getElementById('global-x-hint');
  const profileWrapper = document.getElementById('x-profile-wrapper');
  // Removed account pill & global badge (single implicit global account)

  function showHint(msg, kind='warn') {
    if (!hint) return;
    hint.textContent = msg;
    hint.classList.remove('hidden');
    hint.classList.remove('bg-green-50','text-green-700','border-green-200','bg-yellow-50','text-yellow-700','border-yellow-200','bg-red-50','text-red-700','border-red-200');
    if (kind === 'ok') hint.classList.add('bg-green-50','text-green-700','border','border-green-200');
    else if (kind === 'error') hint.classList.add('bg-red-50','text-red-700','border','border-red-200');
    else hint.classList.add('bg-yellow-50','text-yellow-700','border','border-yellow-200');
  }

  function hideHint() { hint?.classList.add('hidden'); }

  async function fetchJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  }

  // Simplified: we only need the admin target, which implicitly is the global account

  async function refresh() {
    try {
      hideHint();
      let targetAvatarId = null;
      try {
        const t = await fetchJson('/api/xauth/admin/target');
        targetAvatarId = t.avatarId;
      } catch {}
      let status = null;
      let targetMeta = null;
      if (targetAvatarId) {
        try { status = await fetchJson(`/api/xauth/status/${targetAvatarId}`); } catch {}
      }
      // Fetch target meta (may include stored profile) for fallback
      try { targetMeta = await fetchJson('/api/xauth/admin/target'); } catch {}
      if (status && !status.profile && targetMeta?.profile) {
        status.profile = targetMeta.profile; // Enrich missing profile
      }
      // Final fallback: direct admin profile fetch if still missing
      if ((!status || !status.profile) && targetAvatarId) {
        try {
          const ap = await fetchJson('/api/xauth/admin/profile');
          if (ap?.authorized && ap.profile) {
            if (!status) status = { authorized: true, expiresAt: ap.expiresAt, profile: ap.profile };
            else if (!status.profile) status.profile = ap.profile;
          }
        } catch {}
      }
      // No secondary search: only admin target matters now

      if (status?.authorized) {
  connectBtn?.classList.add('hidden');
  disconnectBtn?.classList.remove('hidden');
        profileWrapper?.classList.remove('hidden');
        const p = status.profile || {};
        const img = document.getElementById('admin-x-avatar');
        const name = document.getElementById('admin-x-name');
        const user = document.getElementById('admin-x-username');
        const exp = document.getElementById('admin-x-expiry');
        if (img) {
          const placeholder = '/images/x-placeholder.svg';
          if (p.profile_image_url) {
            img.src = p.profile_image_url;
            img.onerror = () => { img.src = placeholder; };
          } else {
            img.src = placeholder;
          }
        }
        if (name) name.textContent = p.name || (p.username ? p.username : 'X Account');
        if (user) user.textContent = p.username ? `@${p.username}` : '';
        if (exp && status.expiresAt) exp.textContent = `Token expires: ${new Date(status.expiresAt).toLocaleString()}`;
        // Badge/pill removed
        hideHint();
      } else {
  disconnectBtn?.classList.add('hidden');
  connectBtn?.classList.remove('hidden');
        profileWrapper?.classList.add('hidden');
        showHint('No authorized X account. Connect to enable auto posting.');
      }
    } catch (e) {
      showHint('Failed to load X status: ' + e.message, 'error');
    }
  }

  connectBtn?.addEventListener('click', async () => {
    try {
      connectBtn.disabled = true;
      hideHint();
      const res = await fetch('/api/xauth/admin/auth-url');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const w = 600, h = 650; const l = window.screen.width/2 - w/2; const t = window.screen.height/2 - h/2;
      const popup = window.open(data.url, 'xauth_popup', `width=${w},height=${h},top=${t},left=${l},resizable=yes,scrollbars=yes`);
      if (!popup) throw new Error('Popup blocked');
      window.addEventListener('message', async function onMsg(ev) {
        if (ev.data?.type === 'X_AUTH_SUCCESS' || ev.data?.type === 'X_AUTH_ERROR') {
          window.removeEventListener('message', onMsg);
          await refresh();
        }
      });
    } catch (e) { showHint('Failed to start auth: ' + e.message, 'error'); } finally { connectBtn.disabled = false; }
  });

  disconnectBtn?.addEventListener('click', async () => {
    try {
      disconnectBtn.disabled = true; hideHint();
      const res = await fetch('/api/xauth/admin/disconnect', { method: 'POST' });
      const data = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await refresh();
    } catch (e) { showHint('Failed to disconnect: ' + e.message, 'error'); } finally { disconnectBtn.disabled = false; }
  });

  // Manual profile refresh removed: profile auto-updates after auth actions.

  // Set Global workflow removed

  await refresh();
}

// Minimal API helper for signed writes. Previously this returned an empty object
// if the AdminAuth bootstrap hadn't finished yet, which caused authenticated
// PUTs to fail with "Signed message required". We now attempt a direct wallet
// signature using signWriteHeaders as a fallback so the toggle works even if
// AdminAuth isn't fully initialized yet.
async function getSignedHeaders(meta = {}) {
  if (window.AdminAuth?.getSignedHeaders) return window.AdminAuth.getSignedHeaders(meta);
  try {
    return await signWriteHeaders(meta);
  } catch (e) {
    console.warn('[admin-dashboard] fallback signWriteHeaders failed', e);
    return {};
  }
}

async function fetchCsrfToken() {
  try {
    const r = await fetch('/api/admin/csrf-token');
    if (!r.ok) return '';
    const j = await r.json();
    return j.csrfToken || '';
  } catch { return ''; }
}

// Lightweight inline implementation of global X enable toggle using /api/admin/x-posting/config
function wireGlobalXToggle() {
  const toggle = document.getElementById('global-x-enabled');
  const pill = document.getElementById('global-x-state-pill');
  if (!toggle || !pill) return;

  const setPill = (enabled) => {
    pill.textContent = enabled ? 'ENABLED' : 'DISABLED';
    pill.className = 'text-xs px-2 py-0.5 rounded ' + (enabled ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700');
  };

  async function load() {
    try {
      const r = await fetch('/api/admin/x-posting/config');
      if (!r.ok) throw new Error('' + r.status);
      const data = await r.json();
      const enabled = !!data?.config?.enabled;
      toggle.checked = enabled;
      setPill(enabled);
    } catch (e) {
      setPill(false);
    }
  }

  let saveTimer = null;
  toggle.addEventListener('change', async () => {
    // Debounce rapid flips
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const csrf = await fetchCsrfToken();
        const headers = { 'Content-Type': 'application/json', 'x-csrf-token': csrf };
        const body = JSON.stringify({ enabled: toggle.checked });
        const r = await fetch('/api/admin/x-posting/config', { method: 'PUT', headers, body });
        if (!r.ok) throw new Error('Save failed');
        const j = await r.json().catch(()=>({}));
        setPill(!!j?.config?.enabled);
      } catch (e) {
        // revert UI state on failure
        toggle.checked = !toggle.checked;
        setPill(toggle.checked);
      }
    }, 150);
  });

  load();
}

function wireOAuth1Form() {
  const toggleBtn = document.getElementById('oauth1-toggle');
  const form = document.getElementById('oauth1-form');
  const saveBtn = document.getElementById('oauth1-save');
  const testBtn = document.getElementById('oauth1-test');
  const status = document.getElementById('oauth1-status');
  
  const apiKeyInput = document.getElementById('oauth1-api-key');
  const apiSecretInput = document.getElementById('oauth1-api-secret');
  const accessTokenInput = document.getElementById('oauth1-access-token');
  const accessTokenSecretInput = document.getElementById('oauth1-access-token-secret');
  
  function showStatus(msg, type = 'info') {
    if (!status) return;
    status.textContent = msg;
    status.classList.remove('hidden', 'text-green-600', 'text-red-600', 'text-blue-600');
    if (type === 'success') status.classList.add('text-green-600');
    else if (type === 'error') status.classList.add('text-red-600');
    else status.classList.add('text-blue-600');
  }
  
  // Toggle form visibility
  toggleBtn?.addEventListener('click', () => {
    const isHidden = form?.classList.contains('hidden');
    if (isHidden) {
      form?.classList.remove('hidden');
      toggleBtn.textContent = 'Hide';
      loadCredentials();
    } else {
      form?.classList.add('hidden');
      toggleBtn.textContent = 'Show';
    }
  });
  
  // Load existing credentials
  async function loadCredentials() {
    try {
      const res = await fetch('/api/admin/x-oauth1');
      if (!res.ok) return;
      const data = await res.json();
      if (data.apiKey) apiKeyInput.value = data.apiKey;
      if (data.accessToken) accessTokenInput.value = data.accessToken;
      // Secrets are not returned for security, show placeholder
      if (data.hasApiSecret) apiSecretInput.placeholder = '••••••••••••';
      if (data.hasAccessTokenSecret) accessTokenSecretInput.placeholder = '••••••••••••';
      showStatus('Credentials loaded', 'success');
    } catch (e) {
      showStatus('Failed to load credentials: ' + e.message, 'error');
    }
  }
  
  // Save credentials
  saveBtn?.addEventListener('click', async () => {
    try {
      saveBtn.disabled = true;
      showStatus('Saving...', 'info');
      
      const payload = {
        apiKey: apiKeyInput?.value?.trim() || '',
        apiSecret: apiSecretInput?.value?.trim() || '',
        accessToken: accessTokenInput?.value?.trim() || '',
        accessTokenSecret: accessTokenSecretInput?.value?.trim() || '',
      };
      
      console.log('[OAuth1] Saving credentials:', {
        hasApiKey: !!payload.apiKey,
        hasApiSecret: !!payload.apiSecret,
        hasAccessToken: !!payload.accessToken,
        hasAccessTokenSecret: !!payload.accessTokenSecret,
        apiKeyPreview: payload.apiKey?.substring(0, 10) + '...',
        accessTokenPreview: payload.accessToken?.substring(0, 10) + '...'
      });
      
      const headers = await signWriteHeaders();
      headers['Content-Type'] = 'application/json';
      
      const res = await fetch('/api/admin/x-oauth1', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      
      const responseData = await res.json();
      console.log('[OAuth1] Save response:', responseData);
      
      if (!res.ok) {
        throw new Error(responseData.error || `HTTP ${res.status}`);
      }
      
      showStatus('Credentials saved successfully!', 'success');
      // Clear password fields for security
      if (apiSecretInput.value) apiSecretInput.value = '';
      if (accessTokenSecretInput.value) accessTokenSecretInput.value = '';
      await loadCredentials();
    } catch (e) {
      showStatus('Save failed: ' + e.message, 'error');
      console.error('[OAuth1] Save error:', e);
    } finally {
      saveBtn.disabled = false;
    }
  });
  
  // Test upload
  testBtn?.addEventListener('click', async () => {
    try {
      testBtn.disabled = true;
      showStatus('Testing upload...', 'info');
      
      const res = await fetch('/api/admin/x-oauth1/test');
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      
      showStatus(`Test successful! ${data.message || 'Upload works'}`, 'success');
    } catch (e) {
      showStatus('Test failed: ' + e.message, 'error');
    } finally {
      testBtn.disabled = false;
    }
  });
}

