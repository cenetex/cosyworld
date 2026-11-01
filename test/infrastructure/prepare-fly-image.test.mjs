import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const digest = `sha256:${"a".repeat(64)}`;
const source = `registry.fly.io/cosyworld@${digest}`;
const script = resolve("scripts/prepare-fly-image.sh");
function prepare({
  existing = "",
  copy = false,
  copyFails = false,
  wrongDigest = false,
  sourceImage = source,
  buildFails = false,
  imageBuilder = "fly",
  manifestDelays = 0,
  targetCache = false,
  runFailures = 0,
  train = "",
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cosyworld-image-test-"));
  const log = join(dir, "calls.jsonl");
  const output = join(dir, "output");
  const fake = `#!${process.execPath}
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
const command = basename(process.argv[1]);
const args = process.argv.slice(2);
const env = process.env;
appendFileSync(env.TEST_LOG, JSON.stringify({ command, args, config: env.DOCKER_CONFIG, token: env.FLY_API_TOKEN }) + '\\n');
if (command === 'flyctl' && args[0] === 'auth') {
  const config = JSON.parse(readFileSync(join(env.DOCKER_CONFIG, 'config.json'), 'utf8'));
  if (!config.auths?.['registry.fly.io']) process.exit(1);
  writeFileSync(join(env.DOCKER_CONFIG, 'config.json'), '{}');
} else if (command === 'flyctl' && args[0] === 'deploy') {
  if (env.TEST_BUILD_FAIL === 'true') process.exit(1);
  writeFileSync(env.TEST_STATE, 'built');
} else if (command === 'docker' && args[0] === 'run') {
  const counter = env.TEST_STATE + '.runs';
  const runs = existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0;
  writeFileSync(counter, String(runs + 1));
  if (runs < Number(env.TEST_RUN_FAILURES)) process.exit(1);
  const out = args.find((arg) => arg.endsWith(',dst=/out')).split(',')[1].slice(4);
  writeFileSync(join(out, 'cosyworld-orchestrator'), 'binary');
} else if (command === 'docker' && args[0] === 'buildx' && args[1] === 'build') {
  if (env.TEST_BUILD_FAIL === 'true') process.exit(1);
  writeFileSync(env.TEST_STATE, 'built');
} else if (command === 'skopeo' && args[0] === 'copy') {
  if (env.TEST_COPY_FAIL === 'true') process.exit(1);
  writeFileSync(env.TEST_STATE, 'copied');
} else if (command === 'skopeo' && args[0] === 'inspect' && args[args.indexOf('--authfile') + 1].includes('/source/')) {
  if (!env.TEST_TRAIN) process.exit(1);
  console.log(env.TEST_TRAIN);
} else if (command === 'skopeo' && args[0] === 'inspect') {
  if (existsSync(env.TEST_STATE)) {
    const counter = env.TEST_STATE + '.reads';
    const reads = existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0;
    writeFileSync(counter, String(reads + 1));
    if (reads < Number(env.TEST_MANIFEST_DELAYS)) {
      console.error('manifest unknown');
      process.exit(1);
    }
  }
  const value = existsSync(env.TEST_STATE) ? env.TEST_DIGEST : env.TEST_EXISTING;
  if (!value) process.exit(1);
  console.log(value);
}
`;
  writeFileSync(join(dir, "package.json"), '{"type":"module"}');
  for (const command of ["flyctl", "skopeo", "docker", "sleep"])
    writeFileSync(join(dir, command), fake, { mode: 0o755 });
  writeFileSync(output, "");
  try {
    const result = spawnSync(
      "bash",
      [
        script,
        copy ? "cosyworld-lonelyforest" : "cosyworld",
        copy ? "fly.lonelyforest.toml" : "fly.toml",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          FLY_API_TOKEN: "destination-fixture",
          FLY_SOURCE_API_TOKEN: "source-fixture",
          GITHUB_SHA: "b".repeat(40),
          GITHUB_OUTPUT: output,
          SOURCE_IMAGE: copy ? sourceImage : "",
          COSYWORLD_IMAGE_BUILDER: imageBuilder,
          TEST_LOG: log,
          TEST_STATE: join(dir, "state"),
          TEST_EXISTING: existing,
          TEST_TRAIN: train,
          TEST_DIGEST: wrongDigest ? `sha256:${"c".repeat(64)}` : digest,
          TEST_COPY_FAIL: String(copyFails),
          TEST_BUILD_FAIL: String(buildFails),
          TEST_MANIFEST_DELAYS: String(manifestDelays),
          TEST_RUN_FAILURES: String(runFailures),
          COSYWORLD_RELEASE_TARGET_CACHE: targetCache
            ? join(dir, "release-target")
            : "",
        },
      },
    );
    const calls = existsSync(log)
      ? readFileSync(log, "utf8").trim().split("\n").map(JSON.parse)
      : [];
    for (const call of calls) expect(existsSync(call.config)).toBe(false);
    expect(result.stdout + result.stderr).not.toMatch(
      /destination-fixture|source-fixture/,
    );
    return { ...result, calls, output: readFileSync(output, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const operations = (result, tool, operation) =>
  result.calls.filter(
    ({ command, args }) => command === tool && args[0] === operation,
  );

describe("Fly commit image preparation", () => {
  it("reuses an existing commit and returns its fixed digest", () => {
    const result = prepare({ existing: digest });
    expect(result.status).toBe(0);
    expect(operations(result, "flyctl", "deploy")).toHaveLength(0);
    expect(result.output).toBe(`image=${source}\n`);
  });
  it("builds a missing commit before returning the verified image", () => {
    const result = prepare();
    expect(result.status).toBe(0);
    expect(operations(result, "flyctl", "deploy")[0].args).toEqual([
      "deploy",
      "--remote-only",
      "--config",
      "fly.toml",
      "--build-only",
      "--push",
      "--image-label",
      `deploy-${"b".repeat(40)}`,
    ]);
    expect(result.output).toBe(`image=${source}\n`);
  });
  it("builds on the runner with an app-scoped cache and cleans up its builder", () => {
    const result = prepare({ imageBuilder: "runner" });
    expect(result.status).toBe(0);
    const calls = operations(result, "docker", "buildx");
    expect(calls.map(({ args }) => args[1])).toEqual(["create", "build", "rm"]);
    const args = calls[1].args;
    expect(args).toContain("CARGO_BUILD_JOBS=4");
    expect(args).toContain("linux/amd64");
    expect(args).toContain(
      "type=registry,ref=registry.fly.io/cosyworld:build-cache-v1",
    );
    expect(args).toContain(
      "type=registry,ref=registry.fly.io/cosyworld:build-cache-v1,mode=max,image-manifest=true,oci-mediatypes=true",
    );
    expect(args).toContain(
      `registry.fly.io/cosyworld:deploy-${"b".repeat(40)}`,
    );
    expect(operations(result, "flyctl", "deploy")).toHaveLength(0);
    expect(result.output).toBe(`image=${source}\n`);
  });
  it("builds without a prebuilt binary when no target cache is given", () => {
    const result = prepare({ imageBuilder: "runner" });
    expect(operations(result, "docker", "run")).toHaveLength(0);
    const args = operations(result, "docker", "buildx")[1].args;
    expect(args.join(" ")).not.toContain("ORCHESTRATOR_BINARY");
    expect(args.join(" ")).not.toContain("--build-context");
  });
  it("compiles in the Dockerfile toolchain with the saved target, then packages it", () => {
    const result = prepare({ imageBuilder: "runner", targetCache: true });
    expect(result.status).toBe(0);
    const runs = operations(result, "docker", "run");
    expect(runs).toHaveLength(1);
    const run = runs[0].args;
    const toolchain = readFileSync("Dockerfile", "utf8").match(
      /^FROM (\S+) AS chef$/m,
    )[1];
    expect(run).toContain(toolchain);
    expect(run).toContain("linux/amd64");
    expect(run).toContain("CARGO_BUILD_JOBS=4");
    for (const path of [
      "v2/core-c",
      "v2/content",
      "v2/content-engine-version.txt",
      "v2/card-game",
      "v2/media",
      "v2/ai-model-rust",
    ])
      expect(run).toContain(
        `type=bind,src=${resolve(path)},dst=/app/${path},readonly`,
      );
    expect(run).toContain(
      `type=bind,src=${resolve("v2/orchestrator-rust")},dst=/src,readonly`,
    );
    expect(run).toContain(
      `type=bind,src=${resolve("scripts/release-rustc-wrapper.sh")},dst=/usr/local/bin/release-rustc-wrapper,readonly`,
    );
    expect(run.slice(-2)).toEqual([
      "sh",
      "/usr/local/bin/compile-release-binary",
    ]);
    const calls = operations(result, "docker", "buildx");
    expect(calls.map(({ args }) => args[1])).toEqual(["create", "build", "rm"]);
    const args = calls[1].args;
    expect(args).toContain("ORCHESTRATOR_BINARY=orchestrator-prebuilt");
    expect(args.some((arg) => arg.startsWith("orchestrator-prebuilt=/"))).toBe(
      true,
    );
    expect(args).toContain(
      "type=registry,ref=registry.fly.io/cosyworld:build-cache-v1",
    );
    expect(result.output).toBe(`image=${source}\n`);
  });
  it("retries a failed warm build once from an empty target", () => {
    const retried = prepare({
      imageBuilder: "runner",
      targetCache: true,
      runFailures: 1,
    });
    expect(retried.status).toBe(0);
    expect(operations(retried, "docker", "run")).toHaveLength(2);
    const failed = prepare({
      imageBuilder: "runner",
      targetCache: true,
      runFailures: 2,
    });
    expect(failed.status).not.toBe(0);
    expect(failed.output).toBe("");
    expect(
      operations(failed, "docker", "buildx").map(({ args }) => args[1]),
    ).toEqual(["rm"]);
  });
  it("reuses a runner image before starting a builder", () => {
    const result = prepare({ imageBuilder: "runner", existing: digest });
    expect(result.status).toBe(0);
    expect(operations(result, "docker", "buildx")).toHaveLength(0);
  });
  it("cleans up a failed runner build and withholds the image", () => {
    const result = prepare({ imageBuilder: "runner", buildFails: true });
    expect(result.status).not.toBe(0);
    expect(result.output).toBe("");
    expect(operations(result, "docker", "buildx").at(-1).args[1]).toBe("rm");
  });
  it.each([false, true])("waits for the uploaded manifest, copy=%s", (copy) => {
    const result = prepare({ copy, manifestDelays: 2 });
    expect(result.status).toBe(0);
    expect(
      result.calls.filter(({ command }) => command === "sleep"),
    ).toHaveLength(2);
    expect(operations(result, "skopeo", "inspect")).toHaveLength(4);
    expect(result.output).toBe(
      `image=registry.fly.io/${copy ? "cosyworld-lonelyforest" : "cosyworld"}@${digest}\n`,
    );
    expect(operations(result, "flyctl", "deploy")).toHaveLength(copy ? 0 : 1);
  });
  it("stops after the manifest read deadline and keeps the error visible", () => {
    const result = prepare({ manifestDelays: 20 });
    expect(result.status).not.toBe(0);
    expect(result.output).toBe("");
    expect(operations(result, "skopeo", "inspect")).toHaveLength(8);
    expect(
      result.calls.filter(({ command }) => command === "sleep"),
    ).toHaveLength(6);
    expect(result.stderr).toContain("manifest unknown");
    expect(result.stderr).toContain("after 7 reads");
    expect(operations(result, "flyctl", "deploy")).toHaveLength(1);
  });
  it("copies by digest with separate app credentials", () => {
    const result = prepare({ copy: true });
    expect(result.status).toBe(0);
    const logins = operations(result, "flyctl", "auth");
    expect(logins.map(({ token }) => token)).toEqual([
      "destination-fixture",
      "source-fixture",
    ]);
    expect(logins[0].config).not.toBe(logins[1].config);
    const args = operations(result, "skopeo", "copy")[0].args;
    expect(args).toContain("--preserve-digests");
    expect(args).toContain(`docker://${source}`);
    expect(args).toContain(`${logins[1].config}/config.json`);
    expect(args).toContain(`${logins[0].config}/config.json`);
    expect(operations(result, "flyctl", "deploy")).toHaveLength(0);
    expect(result.output).toBe(
      `image=registry.fly.io/cosyworld-lonelyforest@${digest}\n`,
    );
  });
  it("copies the .dev train's image for a Lonely Forest-only deploy", () => {
    const result = prepare({ copy: true, sourceImage: "", train: digest });
    expect(result.status).toBe(0);
    const args = operations(result, "skopeo", "copy")[0].args;
    expect(args).toContain(`docker://${source}`);
    expect(operations(result, "flyctl", "deploy")).toHaveLength(0);
    expect(result.output).toBe(
      `image=registry.fly.io/cosyworld-lonelyforest@${digest}\n`,
    );
  });
  it("builds a Lonely Forest-only deploy when no train built the commit", () => {
    const result = prepare({ copy: true, sourceImage: "" });
    expect(result.status).toBe(0);
    expect(operations(result, "skopeo", "copy")).toHaveLength(0);
    expect(operations(result, "flyctl", "deploy")).toHaveLength(1);
  });
  it("reuses the destination when it already has the source digest", () => {
    const result = prepare({ copy: true, existing: digest });
    expect(result.status).toBe(0);
    expect(operations(result, "skopeo", "copy")).toHaveLength(0);
  });
  it.each([
    { buildFails: true },
    { copy: true, copyFails: true },
    { copy: true, wrongDigest: true },
    { copy: true, sourceImage: "registry.fly.io/unrelated:latest" },
  ])("withholds the deployment image on failure: %j", (options) => {
    const result = prepare(options);
    expect(result.status).not.toBe(0);
    expect(result.output).toBe("");
  });
});

describe("release rustc wrapper", () => {
  const wrap = (crate, version) =>
    spawnSync(
      "sh",
      [
        resolve("scripts/release-rustc-wrapper.sh"),
        "sh",
        "-c",
        'printf "%s|%s|%s|%s|%s" "$CARGO_PKG_VERSION" "$CARGO_PKG_VERSION_MAJOR" "$CARGO_PKG_VERSION_MINOR" "$CARGO_PKG_VERSION_PATCH" "$CARGO_PKG_VERSION_PRE"',
        "--crate-name",
        crate,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          CARGO_PKG_VERSION: "0.0.0",
          CARGO_PKG_VERSION_MAJOR: "0",
          CARGO_PKG_VERSION_MINOR: "0",
          CARGO_PKG_VERSION_PATCH: "0",
          CARGO_PKG_VERSION_PRE: "",
          COSYWORLD_RELEASE_VERSION: version,
        },
      },
    ).stdout;
  it("gives the orchestrator crates their real release version", () => {
    expect(wrap("cosyworld_orchestrator", "1.2.65")).toBe("1.2.65|1|2|65|");
    expect(wrap("card_policy_lab", "2.0.1-rc.1")).toBe("2.0.1-rc.1|2|0|1|rc.1");
  });
  it("leaves dependency crates alone", () => {
    expect(wrap("serde", "1.2.65")).toBe("0.0.0|0|0|0|");
  });
});
