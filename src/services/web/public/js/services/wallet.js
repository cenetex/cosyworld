/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Wallet service
 * Handles wallet connection and authentication
 */

import { setWallet } from '../core/state.js';
import { showToast } from '../utils/toast.js';
import { shortenAddress } from '../utils/formatting.js';

// Lightweight Base58 encoder (Bitcoin alphabet) to avoid bundler/runtime bare specifier issues with 'bs58' in dev mode
// This mirrors the encoding expected by the server (which uses bs58 to decode signatures)
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function encodeBase58(bytes) {
  if (!bytes || !bytes.length) return '';
  // Count leading zeros
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  // Clone bytes for mutation
  const input = Array.from(bytes);
  const encoded = [];
  let startAt = zeros;
  while (startAt < input.length) {
    let carry = 0;
    for (let i = startAt; i < input.length; i++) {
      const val = (input[i] & 0xff) + carry * 256;
      input[i] = Math.floor(val / 58);
      carry = val % 58;
    }
    encoded.push(B58_ALPHABET[carry]);
    // Skip leading zeros in input after division
    while (startAt < input.length && input[startAt] === 0) startAt++;
  }
  // Add leading zeros
  for (let i = 0; i < zeros; i++) encoded.push('1');
  return encoded.reverse().join('');
}

/**
 * Initialize wallet functionality
 */
export function initializeWallet() {
  // Determine if we should suppress toasts (admin pages)
  const suppressToasts = location.pathname.startsWith('/admin');
  window.__walletSuppressToasts = suppressToasts;
  // Check for wallet connect button and inject if missing
  const walletContainer = document.querySelector(".wallet-container");
  if (walletContainer && !walletContainer.querySelector('button')) {
    walletContainer.innerHTML = `
      <button id="wallet-connect-btn" class="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded transition">
        Connect Wallet
      </button>
    `;
    
    // Add event listener to the injected button
    const connectBtn = document.getElementById('wallet-connect-btn');
    if (connectBtn) {
      connectBtn.addEventListener('click', connectWallet);
    }
  }

  // Try auto-connecting to wallet if available and trusted
  autoConnectWallet();
  
  // Update UI with current wallet state
  updateWalletUI();
  
  // Make connectWallet function available globally
  window.connectWallet = connectWallet;
  window.disconnectWallet = disconnectWallet;

  // If on admin pages without a wallet container, provide a floating connect button
  // Update floating button visibility based on wallet state
  updateFloatingWalletButton();
  
  // Listen for wallet connection changes to update floating button
  window.addEventListener('wallet:connected', updateFloatingWalletButton);
  window.addEventListener('wallet:disconnected', updateFloatingWalletButton);
}

/**
 * Update floating wallet button visibility based on connection state
 */
function updateFloatingWalletButton() {
  const suppressToasts = location.pathname.startsWith('/admin');
  const walletContainer = document.querySelector(".wallet-container");
  const existingBtn = document.getElementById('wallet-connect-floating');
  const isConnected = window.state?.wallet?.publicKey;
  
  if (suppressToasts && !walletContainer) {
    if (!isConnected) {
      // Show button if not connected
      if (!existingBtn) {
        const btn = document.createElement('button');
        btn.id = 'wallet-connect-floating';
        btn.textContent = 'Connect Wallet';
        btn.className = 'fixed top-3 right-3 z-50 px-3 py-2 bg-purple-600 text-white rounded shadow hover:bg-purple-700';
        btn.addEventListener('click', connectWallet);
        document.body.appendChild(btn);
      }
    } else {
      // Hide/remove button if connected
      if (existingBtn) {
        existingBtn.remove();
      }
    }
  }
}

/**
 * Try to auto-connect to a wallet if the provider is available
 */
function autoConnectWallet() {
  const provider = window?.phantom?.solana;
  if (provider) {
    provider.connect({ onlyIfTrusted: true })
      .then(connection => {
        if (connection?.publicKey) {
          handleSuccessfulConnection(connection);
        }
      })
      .catch(err => {
        console.warn("Auto-connect failed or not trusted:", err);
      });
  } else {
    console.log("No compatible wallet provider found for auto-connect");
  }
}

/**
 * Connect to wallet
 * @returns {Promise<Object>} - Connection result
 */
export async function connectWallet() {
  try {
    // Check if Phantom wallet is available
    const provider = window?.phantom?.solana;
    
    if (!provider) {
  if (!window.__walletSuppressToasts) showToast("Please install Phantom wallet", { type: 'warning' });
      return null;
    }
    
    // Request connection
    const connection = await provider.connect();
    
    // Handle successful connection
    handleSuccessfulConnection(connection);
    
    return connection;
  } catch (error) {
    console.error("Wallet connection error:", error);
  if (!window.__walletSuppressToasts) showToast(`Wallet connection failed: ${error.message}`, { type: 'error' });
    return null;
  }
}

/**
 * Disconnect wallet
 */
export function disconnectWallet() {
  try {
    const provider = window?.phantom?.solana;
    if (provider && provider.disconnect) {
      provider.disconnect();
    }
    
    // Update application state
    setWallet(null);
    
    // Update UI
    updateWalletUI();
    
  if (!window.__walletSuppressToasts) showToast("Wallet disconnected", { type: 'info' });
    
    // Reload content if needed
    if (window.loadContent) {
      window.loadContent();
    }

  // Notify listeners of disconnect
  try { window.dispatchEvent(new CustomEvent('wallet:disconnected')); } catch {}
  } catch (error) {
    console.error("Wallet disconnect error:", error);
  if (!window.__walletSuppressToasts) showToast(`Error disconnecting wallet: ${error.message}`, { type: 'error' });
  }
}

/**
 * Handle successful wallet connection
 * @param {Object} connection - Wallet connection data
 */
function handleSuccessfulConnection(connection) {
  if (!connection?.publicKey) {
    console.error("Invalid connection object");
    return;
  }
  
  // Update application state
  const walletData = {
    publicKey: connection.publicKey.toString(),
    isConnected: true
  };
  
  setWallet(walletData);
  
  // Update UI
  updateWalletUI();
  
  if (!window.__walletSuppressToasts) showToast(`Wallet connected: ${shortenAddress(walletData.publicKey)}`, { type: 'success' });
  
  // Reload content if needed
  if (window.loadContent) {
    window.loadContent();
  }

  // Notify listeners of connect
  try { window.dispatchEvent(new CustomEvent('wallet:connected', { detail: { publicKey: walletData.publicKey } })); } catch {}
}

/**
 * Update wallet UI based on connection state
 */
export function updateWalletUI() {
  const walletContainer = document.querySelector(".wallet-container");
  const state = window.state || {};
  
  if (!walletContainer) return;
  
  if (state.wallet && state.wallet.publicKey) {
    // Display connected wallet info
    walletContainer.innerHTML = `
      <div class="flex items-center space-x-2">
        <span class="text-green-400 text-sm">●</span>
        <span class="text-gray-200">${shortenAddress(state.wallet.publicKey)}</span>
        <button id="wallet-disconnect-btn" class="text-gray-400 hover:text-white">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </div>
    `;
    
    // Add event listener to disconnect button
    const disconnectBtn = document.getElementById('wallet-disconnect-btn');
    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', disconnectWallet);
    }
  } else {
    // Display connect button
    walletContainer.innerHTML = `
      <button id="wallet-connect-btn" class="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded transition">
        Connect Wallet
      </button>
    `;
    
    // Add event listener to connect button
    const connectBtn = document.getElementById('wallet-connect-btn');
    if (connectBtn) {
      connectBtn.addEventListener('click', connectWallet);
    }
  }
}

/**
 * Sign a write payload with Phantom for server-side verification
 * Returns headers: { 'X-Wallet-Address', 'X-Message', 'X-Signature' }
 */
export async function signWriteHeaders(extra = {}) {
  const address = window.state?.wallet?.publicKey;
  const provider = window?.phantom?.solana;
  if ((!address || !provider)) {
    // Attempt an on-demand connection (interactive) before failing
    if (provider?.connect) {
      try {
        const connection = await provider.connect();
        if (connection?.publicKey) {
          setWallet({ publicKey: connection.publicKey.toString(), isConnected: true });
        }
      } catch (e) {
        throw new Error('Wallet not connected');
      }
    } else {
      throw new Error('Wallet not connected');
    }
  }
  // Re-check after attempted connect
  const finalAddress = window.state?.wallet?.publicKey;
  if (!finalAddress) throw new Error('Wallet not connected');
  const payload = { ts: Date.now(), nonce: Math.random().toString(36).slice(2), ...extra };
  const msg = JSON.stringify(payload);
  const encoded = new TextEncoder().encode(msg);
  const { signature } = await provider.signMessage(encoded, 'utf8');
  // signature is Uint8Array; convert to base58 string for compact transport
  const bs58sig = encodeBase58(signature);
  return {
    'X-Wallet-Address': finalAddress,
    'X-Message': msg,
    'X-Signature': bs58sig
  };
}