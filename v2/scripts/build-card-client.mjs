import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const crate = new URL("../client-rust/", import.meta.url);
const target = "wasm32-unknown-unknown";
const output = new URL("target/", crate);
execFileSync(
  "cargo",
  [
    "build",
    "--locked",
    "--manifest-path",
    fileURLToPath(new URL("Cargo.toml", crate)),
    "--target-dir",
    fileURLToPath(output),
    "--target",
    target,
    "--release",
  ],
  { stdio: "inherit" },
);
writeFileSync(
  new URL("../card-game/client-view-model.wasm", import.meta.url),
  readFileSync(new URL(`${target}/release/cosyworld_client.wasm`, output)),
);
