// Discord adapter. This file is the only one that imports discord.js; the core
// modules above are testable without it. Talk routing lands in a later slice.
import { Client, GatewayIntentBits } from "discord.js";
import { loadBindings, saveBindings } from "./bindings.mjs";
import { commandDefinitions, dispatch } from "./commands.mjs";

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

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const bindings = loadBindings(bindingsFile);
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
    await interaction.reply({ content: result.content, ephemeral: result.ephemeral });
  } catch (error) {
    console.error("reply failed", error);
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  // Phase 1b: route bound-channel Talk to the shared narrative endpoint.
  // The skeleton ignores chat until that endpoint exists.
});

client.login(token);
