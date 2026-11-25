import { readFileSync } from "node:fs";
import vm from "node:vm";
import { newest } from "../../v2/scripts/rules-pins.mjs";

const read = (path) =>
  readFileSync(
    new URL(
      `../../v2/orchestrator-rust/src/card_shared/${path}`,
      import.meta.url,
    ),
    "utf8",
  );

export function currentSharedEngine() {
  const version = newest(read("rules.json"));
  const runtime = vm.createContext({
    structuredClone,
    cardContent: JSON.parse(read("content.json")),
  });
  vm.runInContext(read(`engine-v${version}.js`), runtime);
  return runtime;
}
