import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const manifestPath = fileURLToPath(
  new URL("../rules-rust/wasm/Cargo.toml", import.meta.url),
);
const cargo = (command, ...args) =>
  execFileSync(
    "cargo",
    [command, "--manifest-path", manifestPath, "--locked", ...args],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
const metadata = JSON.parse(
  cargo("metadata", "--no-deps", "--format-version=1"),
);
const guest = metadata.packages.find(
  ({ manifest_path }) => manifest_path === manifestPath,
);
const target = "wasm32-unknown-unknown";
const messages = cargo(
  "build",
  "--target",
  target,
  "--release",
  "--message-format=json",
)
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const binary = messages
  .filter(
    ({ reason, package_id }) =>
      reason === "compiler-artifact" && package_id === guest.id,
  )
  .flatMap(({ filenames }) => filenames)
  .find((file) => file.endsWith(".wasm"));
if (!binary) throw new Error("Cargo did not produce a rules WASM artifact");

const bytes = readFileSync(binary);
const module = new WebAssembly.Module(bytes);
if (WebAssembly.Module.imports(module).length)
  throw new Error("Rules WASM must have zero host imports");
const exports = new Map(
  WebAssembly.Module.exports(module).map(({ name, kind }) => [name, kind]),
);
if (
  exports.get("memory") !== "memory" ||
  ["reserve_input", "reduce", "output_ptr"].some(
    (name) => exports.get(name) !== "function",
  )
)
  throw new Error("Rules WASM is missing required ABI exports");

const sha256 = createHash("sha256").update(bytes).digest("hex");
const outputDir = join(
  metadata.target_directory,
  "rules-candidates",
  guest.version,
);
const file = `${sha256}.wasm`;
const artifact = {
  abi: 1,
  version: guest.version,
  target,
  file,
  sha256,
  size: bytes.length,
};
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, file), bytes);
writeFileSync(
  join(outputDir, `${sha256}.json`),
  `${JSON.stringify(artifact, null, 2)}\n`,
);
console.log(join(outputDir, file));
