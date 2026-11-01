import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(
  new URL("../../scripts/yield-to-production-deploy.sh", import.meta.url),
);
const fastCheck = readFileSync(
  new URL("../../.github/workflows/fast-check.yml", import.meta.url),
  "utf8",
);

// A fake gh prints a production run for the first `busy` queries.
function run({ busy = 0, fail = false, limit = 60 } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "deploy-yield-"));
  writeFileSync(
    join(directory, "gh"),
    `#!/usr/bin/env bash
${fail ? "exit 1" : ""}
n=$(cat "${directory}/count" 2>/dev/null || echo 0)
echo $((n + 1)) > "${directory}/count"
if [ "$n" -lt ${busy * 2} ] && [[ "$2" == *status=in_progress* ]]; then
  echo "123 v1.2.106"
fi
`,
  );
  chmodSync(join(directory, "gh"), 0o755);
  return spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      GH_REPO: "cenetex/cosyworld",
      COSYWORLD_DEPLOY_YIELD_INTERVAL: "1",
      COSYWORLD_DEPLOY_YIELD_SECS: String(limit),
      PATH: `${directory}${delimiter}${process.env.PATH}`,
    },
  });
}

describe("fast check yields runners to production deploys", () => {
  it("waits while a production deploy runs, then continues", () => {
    const result = run({ busy: 2 });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Waiting for production deploy run(s)");
    expect(result.stdout).toContain("No production deploy is waiting");
  });

  it("continues at once when the run list is unreadable", () => {
    const result = run({ fail: true });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("Waiting");
  });

  it("starts the checks anyway after the wait limit", () => {
    const result = run({ busy: 100, limit: 1 });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("::warning::");
  });

  it("holds only the plan job, and only for tag and dispatch deploys", () => {
    const plan = fastCheck.slice(
      fastCheck.indexOf("  plan:"),
      fastCheck.indexOf("\n  lint:"),
    );
    expect(plan).toContain("bash scripts/yield-to-production-deploy.sh");
    expect(plan).toContain("actions: read");
    expect(fastCheck.match(/yield-to-production-deploy/g)).toHaveLength(1);
    const source = readFileSync(script, "utf8");
    expect(source).toContain('.event == "workflow_dispatch"');
    expect(source).toContain('(.head_branch | startswith("v"))');
  });
});
