import { fileURLToPath } from "node:url";
import { verifyStore } from "./card-store.mjs";
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--check"))
  throw new Error("Use --check or no arguments");
const packs = verifyStore(fileURLToPath(new URL("../", import.meta.url)), {
  check: args.includes("--check"),
});
console.log(
  `Store integrity verified: ${packs.map(({ entry }) => entry.id).join(", ") || "(empty)"}.`,
);
