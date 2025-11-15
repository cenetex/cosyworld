/**
 * Shared helpers for distinguishing wallet avatar sources.
 */

/**
 * Check if avatar came from NFT collection sync
 */
export function isCollectionAvatar(avatar) {
  if (!avatar) return false;
  if (avatar.source === 'nft-sync') return true;
  if (avatar.nft?.collection) return true;
  if (avatar.claimed === true || Boolean(avatar.claimedBy)) return true;
  return false;
}

/**
 * Check if avatar was auto-generated for a wallet address
 */
export function isOnChainAvatar(avatar) {
  if (!avatar) return false;
  if (!avatar.walletAddress) return false;
  if (isCollectionAvatar(avatar)) return false;
  if (String(avatar.summoner || '').startsWith('wallet:')) return true;
  return true;
}
