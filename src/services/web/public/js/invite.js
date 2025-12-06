/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { getProvider } from './admin/admin-auth.js'; // Reuse wallet provider logic
import { apiFetch } from './admin/admin-api.js'; // Reuse fetch wrapper if possible, or standard fetch

// We need a simplified version of getSignedHeaders since we might not be logged in as admin yet
// But we can reuse the phantom/solana logic from admin-auth.js if it exports it.
// admin-auth.js exports ensureWallet, getSignedHeaders.

document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');

  const loadingState = document.getElementById('loading-state');
  const errorState = document.getElementById('error-state');
  const actionState = document.getElementById('action-state');
  const successState = document.getElementById('success-state');
  const errorMessage = document.getElementById('error-message');
  const connectBtn = document.getElementById('connect-wallet-btn');

  if (!token) {
    showError('Missing invite token.');
    return;
  }

  // 1. Validate Token
  try {
    const res = await fetch(`/api/invite/${token}`);
    const data = await res.json();
    
    if (!res.ok || !data.valid) {
      showError(data.error || 'Invalid invite.');
      return;
    }

    // Valid
    loadingState.classList.add('hidden');
    actionState.classList.remove('hidden');

  } catch (e) {
    showError('Failed to verify invite. Please try again.');
  }

  function showError(msg) {
    loadingState.classList.add('hidden');
    actionState.classList.add('hidden');
    errorState.classList.remove('hidden');
    errorMessage.textContent = msg;
  }

  // 2. Connect & Accept
  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting...';

    try {
      // Use Phantom/Solana provider
      const provider = window.phantom?.solana;
      if (!provider?.isPhantom) {
        throw new Error('Phantom wallet not found. Please install it.');
      }

      const resp = await provider.connect();
      const walletAddress = resp.publicKey.toString();

      // Sign the token to prove ownership
      const message = new TextEncoder().encode(token);
      const signedMessage = await provider.signMessage(message, 'utf8');
      
      // Send to backend
      const acceptRes = await fetch('/api/invite/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          walletAddress,
          signature: Array.from(signedMessage.signature) // Send as array for consistency with auth.js
        })
      });

      const acceptData = await acceptRes.json();
      if (!acceptRes.ok) {
        throw new Error(acceptData.error || 'Failed to accept invite.');
      }

      // Success
      actionState.classList.add('hidden');
      successState.classList.remove('hidden');

    } catch (e) {
      alert(e.message);
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect Wallet & Accept';
    }
  });
});
