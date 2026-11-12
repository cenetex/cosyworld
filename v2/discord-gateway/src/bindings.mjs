// Channel binding store. Bindings are gateway-local for now; the orchestrator
// becomes authoritative when multiple bot instances share one world (later).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const DEFAULT_PACK = "lonely-forest";

export function loadBindings(file) {
  if (!file || !existsSync(file)) return new Map();
  try {
    return new Map(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return new Map();
  }
}

export function saveBindings(file, bindings) {
  if (!file) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify([...bindings.entries()], null, 2));
}

export function bind(bindings, channelId, { guildId, mode = "room", pack = DEFAULT_PACK }) {
  bindings.set(channelId, { guildId, mode, pack, boundAt: Date.now() });
}

export function unbind(bindings, channelId) {
  return bindings.delete(channelId);
}

export function bindingFor(bindings, channelId) {
  return bindings.get(channelId) ?? null;
}
