// Discord adapter. This file is the only one that imports discord.js; the core
// modules are testable without it.
import { Client, GatewayIntentBits } from "discord.js";
import { loadBindings, saveBindings, bindingFor } from "./bindings.mjs";
import { commandDefinitions, dispatch } from "./commands.mjs";
import { residentIdentity } from "./identity.mjs";
import { resolveTarget, resolveWorld, talkTo } from "./talk.mjs";

const token = process.env.DISCORD_TOKEN;
const orchestrator = (process.env.ORCHESTRATOR_URL || "http://127.0.0.1:3102").replace(/\/+$/, "");
const bindingsFile = process.env.DISCORD_BINDINGS_FILE || "bindings.json";

if (!token) {
  console.error("DISCORD_TOKEN is required");
  process.exit(1);
}

// Resident catalog is fetched from the orchestrator's /meta and pack catalogs.
// Phase 1b wires this to the compiled pack registry; until then /who shows the
// forest cast names with no portrait (the webhook falls back to its default).
function residentsForPack(pack) {
  if (pack !== "lonely-forest") return [];
  return [
    { id: "vale", name: "Vale", portraitPath: null },
    { id: "moth", name: "Pip", portraitPath: null },
    { id: "keeper", name: "The keeper", portraitPath: null },
  ];
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent],
});
const bindings = loadBindings(bindingsFile);

async function webhookForChannel(channel) {
  const webhooks = await channel.fetchWebhooks();
  const owned = webhooks.find((webhook) => webhook.owner?.id === client.user?.id);
  return owned ?? (await channel.createWebhook({ name: "CosyWorld" }));
}
const deps = {
  bindings,
  save: () => saveBindings(bindingsFile, bindings),
  assetBase: `${orchestrator}/assets`,
  residentsFor: residentsForPack,
};

client.once("ready", async () => {
  try {
    await client.application.commands.set(commandDefinitions());
    console.log("CosyWorld gateway ready");
  } catch (error) {
    console.error("command registration failed", error);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const result = dispatch(
    interaction.commandName,
    {
      channelId: interaction.channelId,
      guildId: interaction.guildId,
      options: Object.fromEntries(
        (interaction.options.data || []).map((option) => [option.name, option.value]),
      ),
    },
    deps,
  );
  try {
    await interaction.deferReply({ ephemeral: result.ephemeral });
    await interaction.editReply({ content: result.content });
  } catch (error) {
    console.error("reply failed", error);
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  const binding = bindingFor(bindings, message.channelId);
  if (!binding || binding.mode !== "room") return;
  const residents = residentsForPack(binding.pack);
  const target = resolveTarget(message.content, residents);
  if (!target) return;
  const botToken = process.env.COSYWORLD_BOT_TOKEN;
  try {
    const world = await resolveWorld(fetch, orchestrator, {
      token: botToken,
      discordUserId: message.author.id,
    });
    if (!world) return;
    const lines = await talkTo(fetch, orchestrator, {
      worldId: world.worldId,
      avatarId: world.avatarId,
      target,
      text: message.content,
      token: botToken,
      discordUserId: message.author.id,
    });
    const webhook = await webhookForChannel(message.channel);
    for (const line of lines) {
      const resident = residents.find((r) => r.id === line.id) ?? { id: line.id, name: line.id };
      const identity = residentIdentity(resident, `${orchestrator}/assets`);
      await webhook.send({
        content: line.text,
        username: identity.username,
        avatarURL: identity.avatarUrl ?? undefined,
        allowedMentions: { parse: [] },
      });
    }
  } catch (error) {
    console.error("talk failed", error);
  }
});

client.login(token);
