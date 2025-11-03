/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { BasicTool } from '../BasicTool.mjs';

export class MoveTool extends BasicTool {

  /**
   * Constructs a new MoveTool.
   * @param {Object} services - The services container
   */
  constructor({
    avatarService,
    mapService,
    locationService,
    discordService,
    conversationManager,
    logger
  }) {
    super();

    this.avatarService = avatarService;
    this.mapService = mapService;
    this.locationService = locationService;
    this.discordService = discordService;
    this.conversationManager = conversationManager;
    this.logger = logger;
    
    this.name = 'move';
    this.description = 'Move to a location you know or discover a new location by name.';
    this.emoji = '🏃‍♂️';
  }

  /**
   * Get parameter schema for LLM tool calling
   */
  getParameterSchema() {
    return {
      type: 'object',
      properties: {
        destination: {
          type: 'string',
          description: 'The name of the location to move to (will be created if it doesn\'t exist)'
        }
      },
      required: ['destination']
    };
  }

  /**
   * Executes the move command.
   * @param {Object} message - The original Discord message.
   * @param {string[]} params - The command parameters (location name, etc.).
   * @param {Object} avatar - The avatar (must have at least { name, imageUrl, _id, channelId }).
   * @returns {Promise<string>} A status or error message.
   */
  async execute(message, params, avatar) {
    const destination = params.join(' ');
    if (!destination) {
      // Provide helpful suggestion with known locations
      let suggestion = 'You need to specify a destination!';
      
      if (this.mapService?.avatarLocationMemory) {
        try {
          const knownLocs = await this.mapService.avatarLocationMemory.getRecentLocations(String(avatar._id), 3);
          if (knownLocs.length > 0) {
            const locList = knownLocs.map(l => l.locationName).join(', ');
            suggestion += ` Try: ${locList}`;
          }
        } catch (err) {
          this.logger?.debug?.(`Failed to get location suggestions: ${err.message}`);
        }
      }
      
      return `-# [ ❌ Error: ${suggestion} ]`;
    }

    try {
      // 1. Check if destination matches a known location first
      let knownLocation = null;
      if (this.mapService?.avatarLocationMemory) {
        try {
          const matches = await this.mapService.avatarLocationMemory.searchKnownLocations(
            String(avatar._id),
            destination
          );
          if (matches.length > 0) {
            knownLocation = matches[0]; // Use best match
            this.logger?.debug?.(`Found known location match: ${knownLocation.locationName}`);
          }
        } catch (err) {
          this.logger?.debug?.(`Failed to search known locations: ${err.message}`);
        }
      }

      // 2. Get current location from the toolService
      const currentLocation = await this.mapService.getAvatarLocation(avatar);
      const currentLocationId = currentLocation?.location?.channelId || avatar.channelId;

      // 3. If we found a known location, try to use it
      let newLocation = null;
      if (knownLocation) {
        try {
          // Fetch the Discord channel to verify it still exists
          const channel = await this.discordService.client.channels.fetch(knownLocation.channelId);
          if (channel) {
            newLocation = {
              channel,
              name: channel.name,
              id: channel.id
            };
          }
        } catch (err) {
          this.logger?.warn?.(`Known location channel ${knownLocation.channelId} no longer accessible: ${err.message}`);
          // Fall through to create new location
        }
      }

      // 4. If no known location or it's not accessible, find or create
      if (!newLocation) {
        newLocation = await this.locationService.findOrCreateLocation(
          message.channel.guild,
          destination,
          message.channel
        );
      }

      if (!newLocation) {
        return '-# 🏃‍♂️ [ Failed to find or create that location!';
      }

      // 5. If the avatar is already in that location, bail early
      if (currentLocationId === newLocation.channel.id) {
        return "-# 🏃‍♂️ [ You're already there!";
      }

      // 6. Update the avatar's position in the database (only once)
      // This will also record the visit in location memory via MapService
      const updatedAvatar = await this.mapService.updateAvatarPosition(
        avatar,
        newLocation.channel.id,
        currentLocationId
      );

      if (!updatedAvatar) {
        return `-# 🏃‍♂️ [ Failed to move: Avatar location update failed.`
      }

      // Best-effort: bump lastActiveAt and currentChannelId for persistent world tracking
      try {
        updatedAvatar.lastActiveAt = new Date();
        updatedAvatar.currentChannelId = newLocation.channel.id;
        await this.avatarService.updateAvatar(updatedAvatar);
      } catch (e) {
        this.logger?.debug?.('MoveTool activity update failed: ' + (e?.message || e));
      }

      // 7. Send a mini card to the departure channel if we have one
      if (currentLocationId) {
        try {
          const departureMessage = `${avatar.name} has departed to <#${newLocation.channel.id}>`;
          await this.discordService.sendMiniAvatarEmbed(avatar, currentLocationId, departureMessage);
          this.logger?.debug?.(`Sent mini card for ${avatar.name} to departure location ${currentLocationId}`);
        } catch (miniCardError) {
          this.logger?.error?.(`Error sending mini card: ${miniCardError.message}`);
        }
      }

      // 8. Instead of sending full profile embed to new location, send mini embed only
      try {
        const arrivalMessage = `${avatar.name} has arrived.`;
        await this.discordService.sendMiniAvatarEmbed(updatedAvatar, newLocation.channel.id, arrivalMessage);
        this.logger?.debug?.(`Sent mini arrival card for ${updatedAvatar.name} to ${newLocation.channel.id}`);
      } catch (miniCardError) {
        this.logger?.error?.(`Error sending arrival mini card: ${miniCardError.message}`);
      }

      // 9. Return success message
      return `-# 🏃‍♂️ [ ${avatar.name} moved to ${newLocation.channel.name}! ]`;
    } catch (error) {
      this.logger?.error('Error in MoveTool execute:', error);
      
      // Provide helpful error message with known locations
      let errorMsg = `Failed to move: ${error.message}`;
      if (this.mapService?.avatarLocationMemory) {
        try {
          const knownLocs = await this.mapService.avatarLocationMemory.getRecentLocations(String(avatar._id), 3);
          if (knownLocs.length > 0) {
            const locList = knownLocs.map(l => l.locationName).join(', ');
            errorMsg += `. Known locations: ${locList}`;
          }
        } catch {}
      }
      
      return `-# [ ❌ Error: ${errorMsg} ]`;
    }
  }

  /**
   * Short description of what the tool does.
   */
  getDescription() {
    return 'Move to a different area.';
  }

  /**
   * Syntax instruction for help or usage references.
   */
  async getSyntax() {
    return `${this.emoji} <location>`;
  }
}