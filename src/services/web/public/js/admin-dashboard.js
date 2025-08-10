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
}

document.addEventListener('DOMContentLoaded', init);
