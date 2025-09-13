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
      const targetRes = await fetch('/api/xauth/admin/target');
      if (!targetRes.ok) {
        const err = await targetRes.json().catch(() => ({}));
        hint.classList.remove('hidden');
        hint.textContent = err.error || 'Admin target unavailable.';
        connectBtn?.setAttribute('disabled', 'true');
        return;
      }
      const { avatarId } = await targetRes.json();
      const statusRes = await fetch(`/api/xauth/status/${avatarId}`);
      const status = await statusRes.json();
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
