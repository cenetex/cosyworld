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
  // Order: first wire unified toggle (loads config), then account (loads profile) so pills can update coherently
  wireGlobalXToggle();
  wireAdminX();
}

document.addEventListener('DOMContentLoaded', init);

async function wireAdminX() {
  const connectBtn = document.getElementById('admin-x-connect');
  const disconnectBtn = document.getElementById('admin-x-disconnect');
  const setGlobalBtn = document.getElementById('admin-x-set-global');
  const hint = document.getElementById('admin-x-hint');
  const profileWrapper = document.getElementById('x-profile-wrapper');
  const accountPill = document.getElementById('global-x-account-pill');
  const globalBadge = document.getElementById('admin-x-global-badge');

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

  async function findGlobalAuth() {
    try {
      const data = await fetchJson('/api/admin/x-accounts');
      const accounts = data.xAccounts || [];
      const globals = accounts.filter(a => a?.xAuth?.global);
      if (globals.length) return globals[0];
      return accounts.find(a => a.xAuth?.accessToken) || null;
    } catch { return null; }
  }

  async function refresh() {
    try {
      hideHint();
      let targetAvatarId = null;
      try {
        const t = await fetchJson('/api/xauth/admin/target');
        targetAvatarId = t.avatarId;
      } catch {}
      let status = null;
      if (targetAvatarId) {
        try { status = await fetchJson(`/api/xauth/status/${targetAvatarId}`); } catch {}
      }
      if (!status || !status.authorized) {
        const globalAcc = await findGlobalAuth();
        if (globalAcc) {
          targetAvatarId = globalAcc.avatar?._id || globalAcc.avatarId || targetAvatarId;
          status = { authorized: !!globalAcc.xAuth?.accessToken, profile: globalAcc.xProfile || globalAcc.xAuth?.profile, expiresAt: globalAcc.xAuth?.expiresAt, global: !!globalAcc.xAuth?.global };
        }
      }

      if (status?.authorized) {
        connectBtn?.classList.add('hidden');
        disconnectBtn?.classList.remove('hidden');
        setGlobalBtn?.classList.remove('hidden');
        profileWrapper?.classList.remove('hidden');
        const p = status.profile || {};
        const img = document.getElementById('admin-x-avatar');
        const name = document.getElementById('admin-x-name');
        const user = document.getElementById('admin-x-username');
        const exp = document.getElementById('admin-x-expiry');
        if (img) {
          if (p.profile_image_url) {
            img.src = p.profile_image_url;
            img.onerror = () => { img.src = '/images/x-placeholder.png'; };
          } else {
            img.src = '/images/x-placeholder.png';
          }
        }
        if (name) name.textContent = p.name || (p.username ? p.username : 'X Account');
        if (user) user.textContent = p.username ? `@${p.username}` : '';
        if (exp && status.expiresAt) exp.textContent = `Token expires: ${new Date(status.expiresAt).toLocaleString()}`;
        if (globalBadge) globalBadge.classList.toggle('hidden', !status.global);
        if (accountPill) {
          accountPill.classList.remove('hidden');
          accountPill.textContent = status.global ? 'GLOBAL ACCOUNT' : 'ACCOUNT CONNECTED';
          accountPill.className = 'text-xs px-2 py-0.5 rounded ' + (status.global ? 'bg-indigo-600 text-white' : 'bg-green-600 text-white');
        }
      } else {
        disconnectBtn?.classList.add('hidden');
        setGlobalBtn?.classList.add('hidden');
        connectBtn?.classList.remove('hidden');
        profileWrapper?.classList.add('hidden');
        if (accountPill) accountPill.classList.add('hidden');
        showHint('No authorized X account. Connect and then mark it Global to enable posting.');
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

  setGlobalBtn?.addEventListener('click', async () => {
    try {
      setGlobalBtn.disabled = true; hideHint();
      // We need the chosen avatarId; attempt to locate via global or first authorized account list
      const accounts = await (await fetch('/api/admin/x-accounts')).json().catch(()=>({xAccounts:[]}));
      const acc = (accounts.xAccounts||[]).find(a => a.xAuth?.accessToken);
      if (!acc) throw new Error('No authorized account to mark global');
      const avatarId = acc.avatar?._id || acc.avatarId;
      const headers = { 'Content-Type': 'application/json' };
      const res = await fetch('/api/admin/x-accounts/set-global', { method: 'POST', headers, body: JSON.stringify({ avatarId }) });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      showHint('Account marked as global.', 'ok');
      await refresh();
    } catch (e) { showHint('Failed to set global: ' + e.message, 'error'); } finally { setGlobalBtn.disabled = false; }
  });

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
