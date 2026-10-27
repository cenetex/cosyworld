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
  publishDelay = 0,
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
} else if (command === 'skopeo' && args[0] === 'copy') {
  if (env.TEST_COPY_FAIL === 'true') process.exit(1);
  writeFileSync(env.TEST_STATE, 'copied');
} else if (command === 'skopeo' && args[0] === 'inspect') {
  if (existsSync(env.TEST_STATE)) {
    const countFile = env.TEST_STATE + '.reads';
    const count = existsSync(countFile) ? Number(readFileSync(countFile, 'utf8')) : 0;
    writeFileSync(countFile, String(count + 1));
    if (count < Number(env.TEST_PUBLISH_DELAY)) process.exit(1);
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
          TEST_LOG: log,
          TEST_STATE: join(dir, "state"),
          TEST_EXISTING: existing,
          TEST_DIGEST: wrongDigest ? `sha256:${"c".repeat(64)}` : digest,
          TEST_COPY_FAIL: String(copyFails),
          TEST_BUILD_FAIL: String(buildFails),
          TEST_PUBLISH_DELAY: String(publishDelay),
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
  it.each([false, true])("waits for a published manifest (copy=%s)", (copy) => {
    const result = prepare({ copy, publishDelay: 2 });
    expect(result.status).toBe(0);
    expect(
      result.calls.filter(({ command }) => command === "sleep"),
    ).toHaveLength(2);
    expect(result.output).toContain(digest);
    expect(operations(result, "flyctl", "deploy")).toHaveLength(copy ? 0 : 1);
  });
  it("stops after the visibility retry limit", () => {
    const result = prepare({ publishDelay: 6 });
    expect(result.status).not.toBe(0);
    expect(
      result.calls.filter(({ command }) => command === "sleep"),
    ).toHaveLength(5);
    expect(result.output).toBe("");
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
