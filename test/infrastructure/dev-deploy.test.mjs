import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { lastRollout, rolledOut } from "../../scripts/last-dev-rollout.mjs";

const sha = "a".repeat(40);

describe("a .dev train compares with the commit .dev runs", () => {
  const step = (name, conclusion) => ({ name, conclusion });
  const runs = [
    { id: 9, status: "in_progress", head_sha: "9".repeat(40) },
    { id: 8, status: "completed", head_sha: "8".repeat(40) },
    { id: 7, status: "completed", head_sha: "7".repeat(40) },
    { id: 6, status: "completed", head_sha: "6".repeat(40) },
  ];
  const jobs = {
    // Superseded before its rollout.
    8: [
      {
        name: "Deploy main to .dev",
        steps: [step("Roll out .dev", "skipped")],
      },
    ],
    // Rolled out, then failed a later check: .dev still runs this commit.
    7: [
      {
        name: "Deploy main to .dev",
        conclusion: "failure",
        steps: [
          step("Roll out .dev", "success"),
          step("Verify primary card game", "failure"),
        ],
      },
    ],
    6: [
      {
        name: "Deploy primary to Fly",
        steps: [step("Deploy primary Fly app", "success")],
      },
    ],
  };

  it("finds the newest completed run whose rollout step succeeded", async () => {
    const seen = [];
    const base = await lastRollout({
      runs,
      currentRunId: 10,
      jobsFor: async (id) => {
        seen.push(id);
        return jobs[id];
      },
    });
    expect(base).toBe("7".repeat(40));
    expect(seen).toEqual([8, 7]);
  });

  it("counts release-path rollouts and skips the current run", async () => {
    const base = await lastRollout({
      runs: runs.slice(3),
      currentRunId: 7,
      jobsFor: async (id) => jobs[id],
    });
    expect(base).toBe("6".repeat(40));
    expect(
      await lastRollout({
        runs: [runs[3]],
        currentRunId: 6,
        jobsFor: async () => [],
      }),
    ).toBe("");
  });

  it("does not count a cancelled or failed rollout step", () => {
    for (const conclusion of ["cancelled", "failure", "skipped", null]) {
      expect(
        rolledOut([
          {
            name: "Deploy main to .dev",
            steps: [step("Roll out .dev", conclusion)],
          },
        ]),
      ).toBe(false);
    }
  });

  it("names the rollout steps the workflow really runs", () => {
    const workflow = readFileSync(
      new URL("../../.github/workflows/deploy.yml", import.meta.url),
      "utf8",
    );
    expect(workflow).toContain("name: Deploy main to .dev");
    expect(workflow).toContain("- name: Roll out .dev");
    expect(workflow).toContain("name: Deploy primary to Fly");
    expect(workflow).toContain("- name: Deploy primary Fly app");
  });
});

const serializeScript = fileURLToPath(
  new URL("../../scripts/serialize-primary-rollout.sh", import.meta.url),
);

// A fake gh answers run and job lists from JSON fixtures through jq, so the
// script's real filters run. A fixture named in `once` is served once.
const runSerialize = (mode, options = {}) => {
  const { fixtures = {}, once = [] } = options;
  const directory = mkdtempSync(join(tmpdir(), "cosyworld-serialize-"));
  const log = join(directory, "gh.log");
  for (const [name, value] of Object.entries(fixtures)) {
    writeFileSync(join(directory, `${name}.json`), JSON.stringify(value));
  }
  writeFileSync(
    join(directory, "gh"),
    `#!/usr/bin/env bash
echo "$*" >> "${log}"
[ "$1" = api ] || exit 0
${options.apiFails ? "exit 1" : ""}
path="$2"; filter=""; while [ $# -gt 0 ]; do [ "$1" = --jq ] && filter="$2"; shift; done
case "$path" in
  */deploy.yml/runs*) name="runs-\${path##*status=}"; name="\${name%%&*}" ;;
  */jobs) name="jobs-$(basename "$(dirname "$path")")" ;;
esac
file="${directory}/$name.json"; [ -e "$file" ] || echo '{"workflow_runs":[],"jobs":[]}' > "$file"
jq -r "$filter" < "$file"
case " ${once.join(" ")} " in *" $name "*) rm "$file" ;; esac
`,
  );
  chmodSync(join(directory, "gh"), 0o755);
  try {
    const result = spawnSync("bash", [serializeScript, mode], {
      encoding: "utf8",
      timeout: 20_000,
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH}`,
        GH_REPO: "example/world",
        GITHUB_RUN_ID: "42",
        GITHUB_SHA: sha,
        GITHUB_EVENT_NAME: options.event ?? "schedule",
        GITHUB_REF: options.ref ?? "refs/heads/main",
        RUNNER_TEMP: directory,
        COSYWORLD_ROLLOUT_WAIT_INTERVAL: "1",
        COSYWORLD_ROLLOUT_WAIT_SECS: options.limit ?? "30",
      },
    });
    const calls = existsSync(log) ? readFileSync(log, "utf8") : "";
    return { ...result, calls };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const runs = (...list) => ({
  workflow_runs: list.map(([id, event, head_branch, title]) => ({
    id,
    event,
    head_branch,
    display_title:
      title ?? (event === "schedule" ? `.dev train ${sha}` : "Deploy main"),
  })),
});
const devJob = (status) => ({
  jobs: [
    {
      name: "Deploy main to .dev",
      status: "in_progress",
      steps: [{ name: "Wait for production deploys", status }],
    },
  ],
});
const devRolling = {
  "runs-in_progress": runs([7, "schedule", "main"]),
  "jobs-7": devJob("completed"),
};

describe("a .dev deploy and a production deploy never roll out together", () => {
  it("a .dev rollout waits for a tag or dispatch deploy, then continues", () => {
    const tag = runSerialize("dev", {
      fixtures: { "runs-queued": runs([5, "push", "v1.2.3"]) },
      once: ["runs-queued"],
    });
    expect(tag.stdout).toContain(
      "Waiting for production deploy run(s): 5 v1.2.3",
    );
    expect(tag.stdout).toContain("No production deploy overlaps this run.");
    expect(tag.status).toBe(0);
    const dispatch = runSerialize("dev", {
      fixtures: { "runs-waiting": runs([6, "workflow_dispatch", "main"]) },
      once: ["runs-waiting"],
    });
    expect(dispatch.stdout).toContain("6 main");
    // Other trains, `dev` dispatches, and its own run never hold it.
    const quiet = runSerialize("dev", {
      event: "workflow_dispatch",
      fixtures: {
        "runs-in_progress": runs(
          [7, "schedule", "main"],
          [8, "workflow_dispatch", "main", `.dev train ${sha}`],
          [42, "workflow_dispatch", "main"],
        ),
      },
    });
    expect(quiet.stdout).not.toContain("Waiting");
    expect(quiet.status).toBe(0);
  });

  it("only a .dev train on main waits", () => {
    expect(
      runSerialize("dev", { event: "push", ref: "refs/tags/v1.2.3" }).calls,
    ).toBe("");
    expect(runSerialize("dev", { ref: "refs/heads/other" }).calls).toBe("");
  });

  it("production sees a `dev` dispatch as a .dev rollout", () => {
    const result = runSerialize("production", {
      fixtures: {
        "runs-in_progress": runs([
          9,
          "workflow_dispatch",
          "main",
          `.dev train ${sha}`,
        ]),
        "jobs-9": devJob("completed"),
      },
      once: ["jobs-9"],
    });
    expect(result.stdout).toContain("Waiting for .dev rollout run(s): 9 main");
    expect(result.status).toBe(0);
  });

  it("production waits only for a .dev run past its wait, so neither deadlocks", () => {
    const rolling = runSerialize("production", {
      fixtures: devRolling,
      once: ["jobs-7"],
    });
    expect(rolling.stdout).toContain("Waiting for .dev rollout run(s): 7 main");
    expect(rolling.status).toBe(0);
    const waiting = runSerialize("production", {
      fixtures: { ...devRolling, "jobs-7": devJob("in_progress") },
    });
    expect(waiting.stdout).not.toContain("Waiting");
    expect(waiting.status).toBe(0);
  });

  it("fails after its limit, and continues when runs cannot be read", () => {
    const stuck = runSerialize("production", {
      fixtures: devRolling,
      limit: "1",
    });
    expect(stuck.stderr).toContain("still running after 1 seconds");
    expect(stuck.status).toBe(1);
    expect(runSerialize("production", { apiFails: true }).status).toBe(0);
  });
});

const summaryScript = fileURLToPath(
  new URL("../../scripts/dev-train-summary.sh", import.meta.url),
);
const summarize = (base, deploy, messages) => {
  const directory = mkdtempSync(join(tmpdir(), "cosyworld-train-"));
  writeFileSync(
    join(directory, "compare.json"),
    JSON.stringify({
      commits: messages.map((message) => ({ commit: { message } })),
    }),
  );
  writeFileSync(
    join(directory, "gh"),
    `#!/usr/bin/env bash\nwhile [ $# -gt 0 ]; do [ "$1" = --jq ] && f="$2"; shift; done\njq -r "$f" < "${directory}/compare.json"\n`,
  );
  chmodSync(join(directory, "gh"), 0o755);
  try {
    return spawnSync("bash", [summaryScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH}`,
        GH_REPO: "example/world",
        GITHUB_SHA: sha,
        BASE: base,
        DEPLOY: deploy,
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

describe("each .dev train labels its drop", () => {
  it("lists the pull requests merged since .dev's last rollout", () => {
    const result = summarize("b".repeat(40), "true", [
      "Merge pull request #12 from cenetex/a\n\nLand the pond",
      "Fix the lamp (#13)",
      "A direct commit",
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`## .dev train ${sha.slice(0, 7)}`);
    expect(result.stdout).toContain("- #12 Land the pond");
    expect(result.stdout).toContain("- #13 Fix the lamp");
    expect(result.stdout).not.toContain("direct commit");
  });

  it("says so when main has not moved", () => {
    const result = summarize(sha, "false", []);
    expect(result.stdout).toContain("main has not moved");
  });
});
