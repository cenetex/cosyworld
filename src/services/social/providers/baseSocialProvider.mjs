/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Base class for social platform providers
 */
export class BaseSocialProvider {
  constructor(service, platformName) {
    this.service = service;
    this.platformName = platformName;
    this.logger = service.logger;
  }

  async initialize() {
    throw new Error('initialize() must be implemented');
  }

  /**
   * Connect an avatar to this platform
   * @param {string} avatarId 
   * @param {object} credentials 
   */
  async connectAvatar(avatarId, credentials, _options = {}) {
    throw new Error('connectAvatar() must be implemented');
  }

  /**
   * Disconnect an avatar from this platform
   * @param {string} avatarId 
   */
  async disconnectAvatar(avatarId, _options = {}) {
    throw new Error('disconnectAvatar() must be implemented');
  }

  /**
   * Post a message/content as an avatar
   * @param {string} avatarId 
   * @param {object} content 
   */
  async post(avatarId, content, _options = {}) {
    throw new Error('post() must be implemented');
  }
}
