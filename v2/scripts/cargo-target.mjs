import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const manifest = resolve(root, "v2/orchestrator-rust/Cargo.toml");

// Ask Cargo, so CARGO_TARGET_DIR and a shared `build.target-dir` both work.
export function cargoTargetDir() {
  try {
    const out = execFileSync(
      "cargo",
      ["metadata", "--no-deps", "--format-version", "1", "--manifest-path", manifest],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return JSON.parse(out).target_directory;
  } catch {
    return resolve(root, "v2/orchestrator-rust/target");
  }
}

export function orchestratorBinary(name = "cosyworld-orchestrator", profile = "debug") {
  return resolve(cargoTargetDir(), profile, name);
}
