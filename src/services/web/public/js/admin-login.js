import { initializeWallet } from './services/wallet.js';
import { apiFetch } from './admin/admin-api.js';
import { success as toastSuccess, error as toastError } from './admin/admin-ui.js';

function updateStatusUI(message, type = 'waiting') {
  const status = document.getElementById('login-status');
  const statusIcon = document.getElementById('status-icon');
  
  if (status) {
    status.textContent = message;
    status.className = `text-sm status-${type}`;
  }

  if (statusIcon) {
    // Update icon based on type
    const iconSvgs = {
      waiting: '<path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />',
      processing: '<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd" />',
      success: '<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />',
      error: '<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />'
    };
    
    const colors = {
      waiting: 'text-gray-400',
      processing: 'text-blue-500',
      success: 'text-green-500',
      error: 'text-red-500'
    };
    
    statusIcon.className = `h-5 w-5 ${colors[type] || colors.waiting}`;
    statusIcon.innerHTML = iconSvgs[type] || iconSvgs.waiting;
  }
}

async function runLogin() {
  initializeWallet();

  async function tryLogin() {
    try {
      const address = window.state?.wallet?.publicKey;
      if (!address) return;
      
      updateStatusUI('Requesting nonce…', 'processing');
      let nonceData;
      try {
        nonceData = await apiFetch('/api/auth/nonce', { method: 'POST', body: { address }, requireCsrf: true });
      } catch (e) { 
        throw new Error(e.message || 'Failed to get nonce'); 
      }
      const { nonce } = nonceData || {};
      if (!nonce) throw new Error('Nonce missing');

      const provider = window?.phantom?.solana;
      if (!provider) throw new Error('Phantom not available');
      
      updateStatusUI('Please sign the message in your wallet…', 'processing');
      const encoded = new TextEncoder().encode(nonce);
      const { signature } = await provider.signMessage(encoded, 'utf8');

      updateStatusUI('Verifying signature…', 'processing');
      let data;
      try {
        data = await apiFetch('/api/auth/verify', { method: 'POST', body: { address, nonce, signature: Array.from(signature) }, requireCsrf: true });
      } catch (e) { 
        // Check if it's an authorization error
        if (e.message.includes('401') || e.message.includes('Unauthorized')) {
          throw new Error('Wallet not authorized. Please contact an administrator.');
        }
        throw new Error(e.message || 'Verification failed'); 
      }

      // Check if user is actually an admin
      if (!data.user?.isAdmin) {
        throw new Error('Access denied: This wallet does not have admin privileges. Please contact an administrator.');
      }

      // Cookie set by server, redirect to admin dashboard
      const msg = 'Admin access granted';
      updateStatusUI(msg + '. Redirecting…', 'success');
      toastSuccess(msg);
      setTimeout(() => { window.location.href = '/admin'; }, 600);
    } catch (e) {
      updateStatusUI(`Login error: ${e.message}`, 'error');
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

