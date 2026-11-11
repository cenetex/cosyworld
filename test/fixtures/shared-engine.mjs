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

// Historical engines use the content recorded with their introducing commit:
// 109: ceb2476fb8fcafee872cbf6c773f302472e45650
// 116: 2f51d6c932968c02eda425a739d76c50a15ce0ca
// The current compiled shared rules use this build's content, as Rust does.
export function currentSharedEngine(savedVersion = null) {
  const version =
    savedVersion ??
    read("engine.rs").match(
      /const VERSION: &str = "full-card-world\/(\d+)"/,
    )[1];
  const runtime = vm.createContext({
    structuredClone,
    cardContent: JSON.parse(
      savedVersion === null
        ? read("content.json")
        : readFileSync(
            new URL(`./card-content-rules-${version}.json`, import.meta.url),
            "utf8",
          ),
    ),
  });
  vm.runInContext(read(`engine-v${version}.js`), runtime);
  return runtime;
}
