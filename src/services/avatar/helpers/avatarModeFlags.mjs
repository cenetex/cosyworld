/**
 * Normalize avatar mode flags, including legacy wallet handling.
 * @param {Object} avatarModes
 * @returns {{allowOnChain: boolean, allowCollection: boolean, allowFree: boolean, allowPureModel: boolean, hasLegacyWallet: boolean}}
 */
export function getAvatarModeFlags(avatarModes = {}) {
  const modes = avatarModes || {};
  const hasLegacyWallet = Object.prototype.hasOwnProperty.call(modes, 'wallet');
  const allowOnChain = hasLegacyWallet ? modes.wallet !== false : modes.onChain !== false;
  const allowCollection = hasLegacyWallet ? modes.wallet !== false : modes.collection !== false;
  const allowFree = modes.free !== false;
  const allowPureModel = modes.pureModel !== false;

  return {
    allowOnChain,
    allowCollection,
    allowFree,
    allowPureModel,
    hasLegacyWallet,
  };
}

/**
 * True when only pure model avatars are allowed in a guild.
 * @param {Object} avatarModes
 * @returns {boolean}
 */
export function isPureModelOnlyAvatarModes(avatarModes = {}) {
  const { allowOnChain, allowCollection, allowFree, allowPureModel } = getAvatarModeFlags(avatarModes);
  return Boolean(allowPureModel && !allowFree && !allowOnChain && !allowCollection);
}
