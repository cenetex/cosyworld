import { initializeWallet } from './services/wallet.js';

async function runLogin() {
  initializeWallet();
  const status = document.getElementById('login-status');

  async function tryLogin() {
    try {
      const address = window.state?.wallet?.publicKey;
      if (!address) return;
      if (status) status.textContent = 'Requesting nonce…';
      const nonceRes = await fetch('/api/auth/nonce', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address }) });
      if (!nonceRes.ok) throw new Error('Failed to get nonce');
      const { nonce } = await nonceRes.json();

      const provider = window?.phantom?.solana;
      if (!provider) throw new Error('Phantom not available');
      const encoded = new TextEncoder().encode(nonce);
      const { signature } = await provider.signMessage(encoded, 'utf8');

      if (status) status.textContent = 'Verifying…';
      const verifyRes = await fetch('/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address, nonce, signature: Array.from(signature) }) });
      const data = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(data?.error || 'Verification failed');

      // Cookie set by server, redirect to admin dashboard
      status.textContent = data.user?.isAdmin ? 'Admin access granted. Redirecting…' : 'Logged in. Redirecting…';
      setTimeout(() => { window.location.href = '/admin'; }, 600);
    } catch (e) {
      if (status) status.textContent = `Login error: ${e.message}`;
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
