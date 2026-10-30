import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { decodeSave } from "../../v2/card-game/world.mjs";

const realm = createContext({});
runInContext(
  readFileSync(
    new URL(
      "../../v2/orchestrator-rust/src/card_shared/engine-v20.js",
      import.meta.url,
    ),
    "utf8",
  ),
  realm,
);
const result = JSON.parse(realm.cardShared(JSON.stringify({ op: "create" })));
if (!result.ok) throw Error(result.error);

// Keep a real released pond save for its continuing journeys, loaded as a player would.
export function pondOpening() {
  return decodeSave(JSON.stringify(result.world));
}
