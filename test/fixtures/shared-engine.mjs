import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (path) =>
  readFileSync(
    new URL(
      `../../v2/orchestrator-rust/src/card_shared/${path}`,
      import.meta.url,
    ),
    "utf8",
  );

// The current compiled shared rules, hosted as Rust hosts them: with this
// build's pack content in globalThis.cardContent.
export function currentSharedEngine() {
  const version = read("engine.rs").match(
    /const VERSION: &str = "full-card-world\/(\d+)"/,
  )[1];
  const runtime = vm.createContext({
    structuredClone,
    cardContent: JSON.parse(read("content.json")),
  });
  vm.runInContext(read(`engine-v${version}.js`), runtime);
  return runtime;
}
