import { residentIdentity } from "./identity.mjs";

export function commandDefinitions() {
  return [
    { name: "who", description: "List the residents of #lonely-forest" },
    { name: "privacy", description: "What this bot reads and sends" },
  ];
}

export const PRIVACY = [
  "**Lonely Forest on Discord**",
  "• The bot reads only #lonely-forest, the channel it made.",
  "• Messages in #lonely-forest are sent to AI models to write residents' replies, with the names people show there.",
  "• It keeps up to the last hour of messages in memory to decide who replies. It saves no messages to disk and links no accounts.",
  "• Each server has its own Lonely Forest world, and the bot sends the server's id to find it. Residents know what is happening there.",
  "• Nothing said here changes a game world.",
  "• It never pings anyone or sends DMs.",
].join("\n");

export function roomView(pack, residents) {
  const names = residents.map((resident) => resident.username).join(", ");
  const count = residents.length;
  return `**${pack}** — ${count} resident${count === 1 ? "" : "s"}: ${names || "none"}`;
}

export function dispatch(commandName, deps) {
  if (commandName === "who") {
    const residents = deps.cast().map((resident) => residentIdentity(resident, deps.assetBase));
    const world = deps.world ? `\nJoin this server's world: ${deps.world}` : "";
    return { content: roomView(deps.pack, residents) + world };
  }
  if (commandName === "privacy") return { content: PRIVACY };
  return { content: "Unknown command.", ephemeral: true };
}
