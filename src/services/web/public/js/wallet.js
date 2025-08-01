/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

// Wallet connection logic for Phantom wallet and Solana

// Global State
const walletState = {
  wallet: null,
};

// Helper function to shorten wallet address
function shortenAddress(address) {
  return address.slice(0, 6) + '...' + address.slice(-4);
}

// Helper function to update wallet UI
function updateWalletUI() {
  const walletContainer = document.querySelector(".wallet-container");
  if (!walletState.wallet) {
    walletContainer.innerHTML = `<button onclick="connectWallet()" class="px-4 py-2 bg-blue-600 text-white rounded">Connect Wallet</button>`;
  } else {
    walletContainer.innerHTML = `<button class="px-4 py-2 bg-blue-600 text-white rounded">Wallet: ${shortenAddress(walletState.wallet.publicKey)}</button>`;
  }
}

// Connect wallet
async function connectWallet() {
  try {
    const provider = window?.phantom?.solana;
    if (!provider) {
      alert("Please install the Phantom wallet extension.");
      return;
    }
    const resp = await provider.connect();
    if (!resp?.publicKey) throw new Error("No public key received.");
    walletState.wallet = { publicKey: resp.publicKey.toString() };
    updateWalletUI();
    // Trigger any additional logic needed after wallet connection
    if (typeof onWalletConnected === 'function') {
      onWalletConnected();
    }
  } catch (err) {
    console.error("Wallet connection failed:", err);
    alert("Failed to connect wallet.");
    walletState.wallet = null;
    updateWalletUI();
  }
}

// Disconnect wallet
function disconnectWallet() {
  walletState.wallet = null;
  updateWalletUI();
  // Trigger any additional logic needed after wallet disconnection
  if (typeof onWalletDisconnected === 'function') {
    onWalletDisconnected();
  }
}

// Auto connect wallet if available and trusted
document.addEventListener("DOMContentLoaded", () => {
  const provider = window?.phantom?.solana;
  if (provider) {
    provider.connect({ onlyIfTrusted: true })
      .then(resp => {
        if (resp?.publicKey) {
          walletState.wallet = { publicKey: resp.publicKey.toString() };
          updateWalletUI();
          if (typeof onWalletConnected === 'function') {
            onWalletConnected();
          }
        }
      })
      .catch(err => {
        console.warn("Auto-connect failed or not trusted:", err);
      });
  }
  updateWalletUI();
});

export function initializeWallet() {
  const walletContainer = document.querySelector(".wallet-container");
  if (walletContainer && !walletContainer.innerHTML.trim()) {
    walletContainer.innerHTML = `<button onclick="connectWallet()" class="px-4 py-2 bg-blue-600 text-white rounded">Connect Wallet</button>`;
  }

  const provider = window?.phantom?.solana;
  if (provider) {
    provider.connect({ onlyIfTrusted: true })
      .then((resp) => {
        if (resp?.publicKey) {
          window.state = window.state || {};
          window.state.wallet = { publicKey: resp.publicKey.toString() };
          updateWalletUI();
          if (window.loadContent) window.loadContent();
        }
      })
      .catch((err) => console.warn("Auto-connect failed:", err));
  }

  function updateWalletUI() {
    const walletAddress = window.state?.wallet?.publicKey || "Not connected";
    walletContainer.innerHTML = `<span class="text-white">Wallet: ${walletAddress}</span>`;
  }
}
