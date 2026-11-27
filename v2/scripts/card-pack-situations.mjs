import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { compilePackSituations as assemble } from "../card-game/card-pack-situations.mjs";

export function compilePackSituations(source, directory) {
  const sidecars = new Map();
  if (!existsSync(directory)) return assemble(source, sidecars);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const file = path.join(directory, entry.name);
    try {
      sidecars.set(file, JSON.parse(readFileSync(file, "utf8")));
    } catch (error) {
      throw new Error(`${file}: ${error.message}`, { cause: error });
    }
  }
  return assemble(source, sidecars);
}
