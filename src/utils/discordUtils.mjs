const hasBoolean = (value) => typeof value === 'boolean';

/**
 * Determines whether the Discord service should be considered enabled.
 * The check prefers service-level signals and falls back to environment variables.
 *
 * @param {object|undefined} discordService - The discord service instance or a stub.
 * @param {object} env - Environment-like object, defaults to process.env.
 * @returns {boolean} True if Discord integrations are enabled.
 */
export function isDiscordServiceEnabled(discordService, env = process.env) {
  if (discordService) {
    if (typeof discordService.isEnabled === 'function') {
      try {
        return Boolean(discordService.isEnabled());
      } catch (error) {
        // Fall through to other heuristics when the service throws.
      }
    }

    if (hasBoolean(discordService.enabled)) {
      return discordService.enabled;
    }

    if (hasBoolean(discordService.available)) {
      return discordService.available;
    }
  }

  return Boolean(env?.DISCORD_BOT_TOKEN);
}

/**
 * Convenience helper used when evaluating feature toggles inside the web server.
 *
 * @param {object} services - Express service locator containing discordService.
 * @param {object} env - Environment-like object, defaults to process.env.
 * @returns {boolean} True if Discord specific routes should be registered.
 */
export function shouldRegisterDiscordRoutes(services, env = process.env) {
  return isDiscordServiceEnabled(services?.discordService, env);
}
