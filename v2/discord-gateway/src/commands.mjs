// Slash commands and their handlers. Handlers return a plain result; the
// discord.js adapter renders it, so these stay testable without a client.
import { DEFAULT_PACK, bind, unbind, bindingFor } from "./bindings.mjs";
import { residentIdentity } from "./identity.mjs";

export function commandDefinitions() {
  return [
    {
      name: "setup",
      description: "Bind this channel to a world pack",
      options: [
        { name: "pack", description: "World pack to mirror", type: 3, required: false },
        { name: "mode", description: "room or quiet", type: 3, required: false },
      ],
    },
    { name: "who", description: "List the residents in this channel" },
    { name: "unbind", description: "Unbind this channel from its world" },
    { name: "privacy", description: "What this bot can and cannot do" },
  ];
}

const PRIVACY = [
  "**What CosyWorld can do here**",
  "• Answer you as the residents of a bound pack, in bound channels only.",
  "• Talk is a committed act: what you say to a resident is journaled to your world, like a card play. The bot stores no chat outside that.",
  "**What it never does**",
  "• Holds no one's Discord keys, reads no other channel, sends no DMs or pings.",
  "• The world never asks for attention; it posts only where you look.",
].join("\n");

export function roomView(pack, residents) {
  const names = residents.map((resident) => resident.username).join(", ");
  const count = residents.length;
  return `**${pack}** — ${count} resident${count === 1 ? "" : "s"}: ${names || "none"}`;
}

export function dispatch(commandName, context, deps) {
  const { channelId, guildId, options } = context;
  if (commandName === "setup") {
    const mode = options.mode === "quiet" ? "quiet" : "room";
    const pack = options.pack || DEFAULT_PACK;
    bind(deps.bindings, channelId, { guildId, mode, pack });
    deps.save();
    return {
      content: `Bound this channel to **${pack}** (${mode}). /who shows the room.`,
      ephemeral: true,
    };
  }
  if (commandName === "who") {
    const binding = bindingFor(deps.bindings, channelId);
    if (!binding) {
      return { content: "This channel is not bound. Run /setup.", ephemeral: true };
    }
    const residents = deps.residentsFor(binding.pack).map((resident) =>
      residentIdentity(resident, deps.assetBase),
    );
    return { content: roomView(binding.pack, residents) };
  }
  if (commandName === "unbind") {
    unbind(deps.bindings, channelId);
    deps.save();
    return { content: "Unbound this channel.", ephemeral: true };
  }
  if (commandName === "privacy") {
    return { content: PRIVACY };
  }
  return { content: "Unknown command.", ephemeral: true };
}
