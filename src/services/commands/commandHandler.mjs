/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

export async function handleCommands(message, services = {
  logger: null,
  toolService: null,
  discordService: null,
  mapService: null,
  configService: null,
}, avatar, context) {

  const { logger, toolService, discordService, mapService } = services;
  if (!logger || !toolService || !discordService || !mapService) {
    throw new Error("Missing required services.");
  }
  const content = message.content.trim();
  if (!message.guildId) {
    throw new Error("Message does not have a guild ID.");
  }
  // const guildConfig = await services.configService.getGuildConfig(message.guildId);


  const toolEmojis = Array.from(services.toolService.toolEmojis.keys());

  const isToolCommand = toolEmojis.some(emoji => content.includes(emoji));

  if (isToolCommand) {
    try {
      // Skip position update for synthetic/monster avatars (non-ObjectId IDs)
      if (avatar?._id && !String(avatar._id).startsWith('monster_')) {
        await services.mapService.updateAvatarPosition(avatar, message.channel.id);
      }

      const { commands } = services.toolService.extractToolCommands(content);
      // Only execute the first detected tool command to reduce spam / chaining
      const first = commands[0];
      if (!first) return;
      const { command, params } = first;
      const tool = services.toolService.tools.get(command);
      if (tool) {
        const args = Array.isArray(params) && params[0] === tool.name
          ? params.slice(1)
          : params;
        await services.discordService.reactToMessage(message, tool.emoji);
        const toolResult = await services.toolService.executeTool(command, message, args, avatar, context);
        const resultMessage = toolResult?.message ?? (typeof toolResult === 'string' ? toolResult : null);
        const resultEmbeds = toolResult?.embeds ?? null;
        const resultComponents = toolResult?.components ?? null;
        const shouldNotify = toolResult?.notify !== false;
        if (tool.replyNotification && shouldNotify) {
          if (resultEmbeds) {
            // Send embed response with optional button components
            await services.discordService.replyToMessage(message, { 
              embeds: resultEmbeds,
              components: resultComponents
            });
          } else if (resultMessage) {
            await services.discordService.replyToMessage(message, `${avatar.name} used ${tool.name} ${tool.emoji ||''}\n${resultMessage}`);
          }
        }
        await services.discordService.reactToMessage(message, tool.emoji);
      } else {
        await services.discordService.reactToMessage(message, "❌");
        await services.discordService.replyToMessage(message, `-# [Unknown command: ${command}]`);
      }
    } catch (error) {
      services.logger.error("Error handling tool command:", error);
      await services.discordService.reactToMessage(message, "❌");
      await services.discordService.replyToMessage(message, `-# [There was an error processing your command: ${error.message}]`);
    }
    return;
  }
}