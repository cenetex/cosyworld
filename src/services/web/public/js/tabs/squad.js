/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Squad Tab
 * Displays avatars claimed by the user
 */

import { state } from '../core/state.js';
import { AvatarAPI, ClaimsAPI } from '../core/api.js';
import { claimAvatar as claimViaService } from '../services/claimService.js';
import { showToast } from '../utils/toast.js';
import { shortenAddress } from '../utils/formatting.js';
import { setEmpty, setError, escapeHtml } from '../utils/dom.js';
import { addImageFallback } from '../utils/fallbacks.js';

/**
 * Load squad tab content
 */
export async function loadSquad() {
  const content = document.getElementById("content");
  if (!content) return;
  
  // Check if wallet is connected
  if (!state.wallet || !state.wallet.publicKey) {
  renderWalletPrompt(content);
    return;
  }
  
  try {
    // Get user avatars
    const data = await AvatarAPI.getAvatars({
      walletAddress: state.wallet.publicKey,
      view: 'claims',
      page: 1,
      limit: 12
    });
    
    if (!data.avatars || data.avatars.length === 0) {
      renderEmptyState(content);
      return;
    }
    
    // Add claim status to each avatar
    const avatarsWithStatus = await Promise.all(data.avatars.map(async (avatar) => {
      try {
        const claimStatus = await ClaimsAPI.getStatus(avatar._id);
        return {
          ...avatar,
          mintStatus: claimStatus.claimed && !claimStatus.minted ? 'unminted' : 'minted',
          isClaimed: claimStatus.claimed,
          claimedBy: claimStatus.claimedBy || '',
          claimId: claimStatus._id
        };
      } catch (err) {
        console.warn(`Failed to get claim status for avatar ${avatar._id}:`, err);
        return {
          ...avatar,
          mintStatus: 'unknown',
          isClaimed: false,
          claimedBy: ''
        };
      }
    }));
    
  renderAvatarGrid(content, avatarsWithStatus);
  } catch (err) {
    console.error("Load Squad error:", err);
  setError(content, `Failed to load Squad: ${err.message}`, { retryFnName: 'loadSquad' });
  }
}

/**
 * Render wallet connection prompt
 * @param {HTMLElement} container - Container element
 */
function renderWalletPrompt(container) {
  container.innerHTML = `
    <div class="text-center py-12">
      <p class="mb-4">Connect your wallet to view your Squad</p>
      <button class="px-4 py-2 bg-primary-600 hover:bg-primary-700 rounded text-white transition" onclick="connectWallet()">Connect Wallet</button>
    </div>`;
}

/**
 * Render empty state when no avatars found
 * @param {HTMLElement} container - Container element
 */
function renderEmptyState(container) {
  setEmpty(container, { title: 'No Squad Members Found', description: `You haven't claimed any avatars yet. Explore the leaderboard to find avatars to claim!` });
}

/**
 * Render avatar grid
 * @param {HTMLElement} container - Container element
 * @param {Array} avatars - List of avatars to render
 */
function renderAvatarGrid(container, avatars) {
  const renderAvatarCard = window.AvatarDetails?.renderAvatarCard || defaultRenderAvatarCard;
  container.innerHTML = `
    <div class="max-w-7xl mx-auto px-4">
      <div class="text-center py-4">
        <h2 class="text-xl font-bold">Wallet: ${escapeHtml(shortenAddress(state.wallet.publicKey))}</h2>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        ${avatars.map(avatar => `
          <div class="cursor-pointer relative group">
            ${renderAvatarCard(avatar, null, avatar.isClaimed, avatar.claimedBy)}
            ${avatar.mintStatus === 'unminted' ? '<div class="absolute top-2 right-2 px-2 py-1 bg-yellow-600 text-white text-xs rounded-full">Unminted</div>' : ''}
            ${!avatar.isClaimed ?
              `<button class="absolute bottom-4 left-4 right-4 px-3 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm rounded transition opacity-90 group-hover:opacity-100" data-claim="${escapeHtml(avatar._id)}">Claim</button>` :
              avatar.mintStatus === 'unminted' ?
                `<button class="absolute bottom-4 left-4 right-4 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition opacity-90 group-hover:opacity-100" data-mint="${escapeHtml(avatar.claimId)}">Mint NFT</button>` :
                '<div class="absolute bottom-4 left-4 right-4 px-3 py-2 bg-gray-700 text-white text-xs rounded text-center opacity-90 group-hover:opacity-100">Minted</div>'
            }
          </div>`).join("")}
      </div>
    </div>`;
  // Attach button listeners (delegation could be global later)
  container.querySelectorAll('[data-claim]').forEach(btn => btn.addEventListener('click', async e => { 
    e.stopPropagation();
    const id = btn.getAttribute('data-claim');
    if (!id) return;
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = 'Claiming...';
    const result = await claimViaService(id, { silent: true });
    if (!result.success) {
      btn.disabled = false;
      btn.textContent = originalText;
    } else {
      btn.outerHTML = '<div class="absolute bottom-4 left-4 right-4 px-3 py-2 bg-green-600 text-white text-xs rounded text-center opacity-90">Claimed</div>';
    }
  }));
  container.querySelectorAll('[data-mint]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); mintClaim(btn.getAttribute('data-mint')); }));
  container.querySelectorAll('img').forEach(img => addImageFallback(img, 'avatar', img.getAttribute('alt')));
}

/**
 * Default avatar card renderer if AvatarDetails component is not available
 * @param {Object} avatar - Avatar data
 * @param {Object} options - Render options
 * @param {boolean} isClaimed - Whether the avatar is claimed
 * @param {string} claimedBy - Address that claimed the avatar
 * @returns {string} - Avatar card HTML
 */
function defaultRenderAvatarCard(avatar, options, isClaimed, claimedBy) {
  const name = escapeHtml(avatar.name || 'Unnamed');
  const desc = escapeHtml(avatar.description || '');
  const img = escapeHtml(avatar.thumbnailUrl || avatar.imageUrl || '');
  return `
    <div class="bg-gray-800 rounded-lg overflow-hidden hover:bg-gray-750 transition-colors ${isClaimed ? 'border-l-2 border-green-500' : ''}">
      <div class="aspect-w-1 aspect-h-1 relative">
        <img src="${img}" alt="${name}" class="object-cover w-full h-full">
      </div>
      <div class="p-4">
        <h3 class="font-bold text-lg truncate">${name}</h3>
        <p class="text-sm text-gray-400 mt-1 truncate">${desc}</p>
      </div>
    </div>`;
}

/**
 * Mint a claim
 * @param {string} claimId - Claim ID to mint
 */
async function mintClaim(claimId) {
  try {
    showToast("Minting started...");
    
    const response = await fetch(`/api/claims/mint/${claimId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast("Minting successful!", { type: 'success' });
      // Reload content to reflect changes
  window.loadContent?.();
    } else {
      throw new Error(data.error || "Minting failed");
    }
  } catch (err) {
    console.error("Mint error:", err);
    showToast(`Minting failed: ${err.message}`, { type: 'error' });
  }
}

// Add claimAvatar function for claim button
window.claimAvatar = (avatarId) => claimViaService(avatarId);