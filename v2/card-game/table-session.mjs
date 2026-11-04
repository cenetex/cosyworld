// Resolve a page's world and save slot together before the table starts.
import { SAVE_BASE } from "./avatar-world.mjs";
import { landingPack } from "./pack-landing.mjs";
import { connectSharedWorld } from "./shared.mjs";

export async function openTableSession(href, connect = connectSharedWorld) {
  const params = new URL(href).searchParams;
  const tableName = params.get("table");
  const startingPack = landingPack(href);
  const sharedWorldId = params.get("world");
  const sharedSession = sharedWorldId ? await connect(sharedWorldId) : null;
  const saveKey = sharedSession
    ? `${SAVE_BASE}.shared.${sharedWorldId}.${sharedSession.state.actor}`
    : tableName && /^[a-z0-9-]{1,40}$/i.test(tableName)
      ? `${SAVE_BASE}.${tableName}`
      : startingPack
        ? `${SAVE_BASE}.pack.${startingPack.id}`
        : SAVE_BASE;
  return { tableName, startingPack, sharedWorldId, sharedSession, saveKey };
}
