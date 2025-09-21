import { initializeWallet } from './services/wallet.js';
import { apiFetch } from './admin/admin-api.js';
import { success as toastSuccess, error as toastError } from './admin/admin-ui.js';

async function runLogin() {
  initializeWallet();
  const status = document.getElementById('login-status');

  async function tryLogin() {
    try {
      const address = window.state?.wallet?.publicKey;
      if (!address) return;
      if (status) status.textContent = 'Requesting nonce…';
      let nonceData;
      try {
        nonceData = await apiFetch('/api/auth/nonce', { method: 'POST', body: { address }, requireCsrf: true });
      } catch (e) { throw new Error(e.message || 'Failed to get nonce'); }
      const { nonce } = nonceData || {};
      if (!nonce) throw new Error('Nonce missing');

      const provider = window?.phantom?.solana;
      if (!provider) throw new Error('Phantom not available');
      const encoded = new TextEncoder().encode(nonce);
      const { signature } = await provider.signMessage(encoded, 'utf8');

      if (status) status.textContent = 'Verifying…';
      let data;
      try {
        data = await apiFetch('/api/auth/verify', { method: 'POST', body: { address, nonce, signature: Array.from(signature) }, requireCsrf: true });
      } catch (e) { throw new Error(e.message || 'Verification failed'); }

      // Cookie set by server, redirect to admin dashboard
  const msg = data.user?.isAdmin ? 'Admin access granted' : 'Login successful';
  status.textContent = msg + '. Redirecting…';
  toastSuccess(msg);
      setTimeout(() => { window.location.href = '/admin'; }, 600);
    } catch (e) {
  if (status) status.textContent = `Login error: ${e.message}`;
  toastError(e.message || 'Login failed');
  console.error(e);
    }
  }

  window.addEventListener('wallet:connected', tryLogin);

  // If already connected, try immediately
  if (window.state?.wallet?.publicKey) {
    tryLogin();
  }
}

document.addEventListener('DOMContentLoaded', runLogin);
