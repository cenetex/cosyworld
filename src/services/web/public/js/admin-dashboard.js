import { initializeWallet, connectWallet } from './services/wallet.js';

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
  wireAdminX();
  wireGlobalXToggle();
}

document.addEventListener('DOMContentLoaded', init);

async function wireAdminX() {
  const connectBtn = document.getElementById('admin-x-connect');
  const disconnectBtn = document.getElementById('admin-x-disconnect');
  const profileBox = document.getElementById('admin-x-profile');
  const hint = document.getElementById('admin-x-hint');

  // Helper to refresh status/profile
  async function refresh() {
    try {
      // Step 1: fetch deterministic admin avatar target
      let targetAvatarId = null;
      try {
        const targetRes = await fetch('/api/xauth/admin/target');
        if (targetRes.ok) {
          const t = await targetRes.json();
          targetAvatarId = t.avatarId;
        }
      } catch {}

      // Step 2: if target avatarId is synthetic (model:*) or lacks auth, try to discover a global x_auth record
      let discoveredStatus = null;
      async function fetchStatus(aid) {
        const r = await fetch(`/api/xauth/status/${aid}`);
        return r.ok ? await r.json() : { authorized: false };
      }

      if (targetAvatarId) {
        discoveredStatus = await fetchStatus(targetAvatarId);
      }

      if ((!targetAvatarId || !discoveredStatus?.authorized) ) {
        // Query admin x-accounts to find a global flagged record with profile
        try {
          const r = await fetch('/api/admin/x-accounts');
          if (r.ok) {
            const j = await r.json();
            const globals = (j.xAccounts || []).filter(a => a?.xAuth?.global);
            if (globals.length) {
              // Prefer one with profile cached
              globals.sort((a,b) => (b.xProfile ? 1:0) - (a.xProfile ? 1:0));
              const g = globals[0];
              targetAvatarId = g.avatar?._id || targetAvatarId;
              if (!g.xProfile && targetAvatarId) {
                discoveredStatus = await fetchStatus(targetAvatarId);
              } else {
                discoveredStatus = { authorized: !!g.xAuth?.authorized, profile: g.xProfile, expiresAt: g.xAuth?.expiresAt };
              }
            }
          }
        } catch {}
      }

      const status = discoveredStatus || { authorized: false };
      if (status.authorized) {
        connectBtn?.classList.add('hidden');
        disconnectBtn?.classList.remove('hidden');
        profileBox?.classList.remove('hidden');
        const p = status.profile || {};
        const img = document.getElementById('admin-x-avatar');
        const name = document.getElementById('admin-x-name');
        const user = document.getElementById('admin-x-username');
        const exp = document.getElementById('admin-x-expiry');
        if (img && p.profile_image_url) img.src = p.profile_image_url;
        if (name) name.textContent = p.name || 'Unknown';
        if (user) user.textContent = p.username ? `@${p.username}` : '';
        if (exp && status.expiresAt) exp.textContent = `Token expires: ${new Date(status.expiresAt).toLocaleString()}`;
        hint.classList.add('hidden');
      } else {
        connectBtn?.classList.remove('hidden');
        disconnectBtn?.classList.add('hidden');
        profileBox?.classList.add('hidden');
        hint.classList.remove('hidden');
        hint.textContent = 'No authorized global X account. Use X Accounts -> Set Global or connect here.';
      }
    } catch (e) {
      hint.classList.remove('hidden');
      hint.textContent = `Failed to load X status: ${e.message}`;
    }
  }

  if (connectBtn) {
    connectBtn.addEventListener('click', async () => {
      try {
        connectBtn.disabled = true;
        const res = await fetch('/api/xauth/admin/auth-url');
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        const w = 600, h = 650;
        const l = window.screen.width / 2 - w / 2;
        const t = window.screen.height / 2 - h / 2;
        const popup = window.open(data.url, 'xauth_popup', `width=${w},height=${h},top=${t},left=${l},resizable=yes,scrollbars=yes`);
        if (!popup || popup.closed || typeof popup.closed === 'undefined') {
          throw new Error('Popup blocked. Please allow popups.');
        }
        window.addEventListener('message', async function onMsg(ev) {
          if (ev.data?.type === 'X_AUTH_SUCCESS' || ev.data?.type === 'X_AUTH_ERROR') {
            window.removeEventListener('message', onMsg);
            await refresh();
          }
        });
      } catch (e) {
        hint.classList.remove('hidden');
        hint.textContent = `Failed to start auth: ${e.message}`;
      } finally {
        connectBtn.disabled = false;
      }
    });
  }

  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', async () => {
      try {
        disconnectBtn.disabled = true;
        const res = await fetch('/api/xauth/admin/disconnect', { method: 'POST' });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        await refresh();
      } catch (e) {
        hint.classList.remove('hidden');
        hint.textContent = `Failed to disconnect: ${e.message}`;
      } finally {
        disconnectBtn.disabled = false;
      }
    });
  }

  await refresh();
}

// Minimal API helper for signed writes (fallbacks to unsigned in dev)
async function getSignedHeaders(meta = {}) {
  if (window.AdminAuth?.getSignedHeaders) return window.AdminAuth.getSignedHeaders(meta);
  return {};
}

async function fetchCsrfToken() {
  try {
    const r = await fetch('/api/admin/csrf-token');
    if (!r.ok) return '';
    const j = await r.json();
    return j.csrfToken || '';
  } catch { return ''; }
}

function wireGlobalXToggle() {
  const enabledEl = document.getElementById('global-x-enabled');
  const saveBtn = document.getElementById('global-x-save');
  const pill = document.getElementById('global-x-state-pill');
  const hint = document.getElementById('global-x-hint');
  if (!enabledEl || !saveBtn) return; // not present

  async function load() {
    try {
      pill.textContent = '...';
      const res = await fetch('/api/admin/x-posting/config');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const enabled = !!data?.config?.enabled;
      enabledEl.checked = enabled;
      updatePill();
    } catch (e) {
      hint.classList.remove('hidden');
      hint.textContent = 'Failed to load global posting config: ' + e.message;
      pill.textContent = 'error';
    }
  }

  function updatePill() {
    const enabled = enabledEl.checked;
    pill.textContent = enabled ? 'ON' : 'OFF';
    pill.className = 'text-xs px-2 py-0.5 rounded ' + (enabled ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-700');
  }

  enabledEl.addEventListener('change', updatePill);
  saveBtn.addEventListener('click', async () => {
    try {
      saveBtn.disabled = true;
      hint.classList.add('hidden');
      hint.textContent = '';
      // Ensure wallet is connected & signing available
      if (!window.state?.wallet?.publicKey) {
        hint.classList.remove('hidden');
        hint.textContent = 'Connect wallet first (top right) to authorize change.';
        return;
      }
      let signedHeaders;
      try {
        signedHeaders = await getSignedHeaders({ op: 'toggle_global_posting' });
      } catch (e) {
        hint.classList.remove('hidden');
        hint.textContent = 'Signature rejected or wallet not connected: ' + e.message;
        return;
      }
      const headers = { 'Content-Type': 'application/json', ...signedHeaders, 'x-csrf-token': await fetchCsrfToken() };
      const res = await fetch('/api/admin/x-posting/config', { method: 'PUT', headers, body: JSON.stringify({ enabled: enabledEl.checked }) });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      updatePill();
      hint.classList.remove('hidden');
      hint.classList.remove('bg-yellow-50','text-yellow-700','border-yellow-200');
      hint.classList.add('bg-green-50','text-green-700','border','border-green-200');
      hint.textContent = 'Saved at ' + new Date().toLocaleTimeString();
    } catch (e) {
      hint.classList.remove('hidden');
      hint.classList.add('bg-yellow-50','text-yellow-700','border','border-yellow-200');
      if (/Signed message required/i.test(e.message)) {
        hint.textContent = 'Save failed: Signed message required. Reconnect wallet and approve the signature prompt.';
      } else {
        hint.textContent = 'Save failed: ' + e.message;
      }
    } finally {
      saveBtn.disabled = false;
    }
  });

  load();
}
