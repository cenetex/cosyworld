/**
 * Unified Claim Service
 * Handles signing + submitting avatar claims and UI/cache updates
 */
import { state } from '../core/state.js';
import { showToast } from '../utils/toast.js';

function toHex(uint8) {
  return Array.from(uint8).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function signClaim(avatarId) {
  if (!state.wallet?.publicKey) throw new Error('Wallet not connected');
  const provider = window?.phantom?.solana;
  if (!provider) throw new Error('Solana wallet not found');
  const message = `I am claiming avatar ${avatarId}`;
  const encoded = new TextEncoder().encode(message);
  const { signature } = await provider.signMessage(encoded, 'utf8');
  return { message, signatureHex: toHex(signature), walletAddress: state.wallet.publicKey };
}

export async function claimAvatar(avatarId, { silent = false } = {}) {
  try {
    if (!avatarId) throw new Error('Missing avatar id');
    if (!silent) showToast('Claiming avatar...');
    const { message, signatureHex, walletAddress } = await signClaim(avatarId);
    const res = await fetch('/api/claims/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatarId, walletAddress, signature: signatureHex, message })
    });
    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await res.json() : { error: await res.text() };
    if (!res.ok || !data.success) throw new Error(data.error || 'Claim failed');
    if (!silent) showToast('Avatar claimed!', { type: 'success' });
    // Invalidate relevant tab caches so squad + leaderboard refresh reflect claim
    try { window.invalidateTabCache && ['squad','leaderboard'].forEach(t => window.invalidateTabCache(t)); } catch {}
    // Reload current tab if it shows claim state
    if (window.loadContent) window.loadContent();
    // Dispatch global event
    try { window.dispatchEvent(new CustomEvent('avatar:claimed', { detail: { avatarId, walletAddress } })); } catch {}
    return { success: true, data };
  } catch (err) {
    if (!silent) showToast(`Claim failed: ${err.message}`, { type: 'error' });
    return { success: false, error: err.message };
  }
}

// Expose globally for legacy handlers
window.ClaimService = { claimAvatar };
