import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const v2Root = path.resolve(scriptDir, "..");
const worldDir = path.join(v2Root, "worlds", "official");
const importsRoot = path.join(v2Root, "content", "imports");
const lock = JSON.parse(fs.readFileSync(path.join(worldDir, "world.lock.json"), "utf8"));

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
}

for (const pack of lock.packs ?? []) {
  const source = pack.source ?? {};
  if (source.type === "workspace") {
    console.log(`worldpack workspace source current: ${pack.id}`);
    continue;
  }
  if (source.type !== "git") throw new Error(`unsupported source type for ${pack.id}: ${source.type}`);
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(source.url ?? "")) {
    throw new Error(`pack ${pack.id} must use an explicit HTTPS GitHub repository URL`);
  }
  if (!/^[0-9a-f]{40}$/.test(source.revision ?? "")) {
    throw new Error(`pack ${pack.id} must pin a full 40-character Git commit`);
  }
  if (!source.path) throw new Error(`pack ${pack.id} has no materialized source path`);
  const target = path.resolve(worldDir, source.path);
  const relativeTarget = path.relative(importsRoot, target);
  if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
    throw new Error(`git pack ${pack.id} must be materialized below v2/content/imports`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(path.join(target, ".git"))) {
    run("git", ["clone", "--no-checkout", source.url, target]);
  }
  run("git", ["-C", target, "fetch", "--depth=1", "origin", source.revision]);
  run("git", ["-C", target, "checkout", "--detach", source.revision]);
  console.log(`worldpack git source current: ${pack.id}@${source.revision}`);
}
