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
import {
  servingRelease,
  staleMachines,
} from "../../scripts/fly-machines-serve-commit.mjs";

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
    expect(seen).toEqual([9, 8, 7, 6]);
  });

  it("counts a running train once its rollout job finished", async () => {
    const train = {
      id: 9,
      status: "in_progress",
      display_title: `.dev train ${"9".repeat(40)}`,
      head_sha: "9".repeat(40),
    };
    const deploy = (status) => [
      {
        name: "Deploy main to .dev",
        status,
        steps: [step("Roll out .dev", "success")],
      },
      { name: "Production Rust gate", status: "in_progress", steps: [] },
    ];
    const find = (status) =>
      lastRollout({
        runs: [train, ...runs.slice(1)],
        currentRunId: 10,
        jobsFor: async (id) => (id === 9 ? deploy(status) : jobs[id]),
      });
    expect(await find("completed")).toBe("9".repeat(40));
    expect(await find("in_progress")).toBe("7".repeat(40));
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

  it("counts a failed rollout's return to the commit .dev served", async () => {
    const at = (name, completed_at) => ({ ...step(name, "success"), completed_at });
    const base = await lastRollout({
      runs: runs.slice(1, 2),
      currentRunId: 10,
      jobsFor: async () => [
        {
          name: "Deploy main to .dev",
          steps: [
            at("Roll out .dev", "2026-11-25T01:00:00Z"),
            at(`Roll .dev back to ${"6".repeat(40)}`, "2026-11-25T01:03:00Z"),
          ],
        },
      ],
    });
    expect(base).toBe("6".repeat(40));
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
  */jobs"?per_page=100") name="jobs-$(basename "$(dirname "$path")")" ;;
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

  it("only a .dev deploy from main waits, a main push included", () => {
    expect(
      runSerialize("dev", { event: "push", ref: "refs/tags/v1.2.3" }).calls,
    ).toBe("");
    expect(runSerialize("dev", { ref: "refs/heads/other" }).calls).toBe("");
    const push = runSerialize("dev", {
      event: "push",
      fixtures: { "runs-queued": runs([5, "push", "v1.2.3"]) },
      once: ["runs-queued"],
    });
    expect(push.stdout).toContain("run(s): 5 v1.2.3");
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

describe("a .dev rollout confirms its machines kept the commit", () => {
  const machine = (id, state, commit, group = "app") => ({
    id,
    state,
    config: {
      env: { COSYWORLD_SOURCE_COMMIT: commit },
      metadata: { fly_process_group: group },
    },
  });

  it("finds a machine another release returned to the previous commit", () => {
    // 2026-11-02: a concurrent `fly secrets set` wrote back 0456b60d9's config.
    expect(
      staleMachines(
        [
          machine("e8262d2fd31de8", "started", "0456b60d9fce"),
          machine("857311c4952dd8", "stopped", undefined, undefined),
        ],
        sha,
      ),
    ).toEqual([{ id: "e8262d2fd31de8", commit: "0456b60d9fce" }]);
  });

  it("accepts started app machines on the commit and ignores stopped ones", () => {
    expect(
      staleMachines(
        [machine("a", "started", sha), machine("b", "stopped", "0456b60d9fce")],
        sha,
      ),
    ).toEqual([]);
  });

  it("reports the release the machines serve only when they agree", () => {
    const image = `registry.fly.io/cosyworld@sha256:${"b".repeat(64)}`;
    const serving = (commit, img = image, state = "started", built) => {
      const value = machine("m", state, commit);
      const env = { ...value.config.env, COSYWORLD_IMAGE_COMMIT: built };
      return { ...value, config: { ...value.config, env, image: img } };
    };
    const none = { commit: "", imageCommit: "", machine: "m" };
    expect(
      servingRelease([serving(sha), serving("c".repeat(40), image, "stopped")]),
    ).toEqual({ commit: sha, image, imageCommit: sha, machine: "m" });
    expect(servingRelease([serving(sha, image, "started", "d".repeat(40))])).toEqual(
      { commit: sha, image, imageCommit: "d".repeat(40), machine: "m" },
    );
    for (const machines of [
      [serving("0456b60d9fce")],
      [serving(undefined)],
    ])
      expect(servingRelease(machines)).toEqual({ ...none, image });
    expect(servingRelease([serving(sha), serving("c".repeat(40))])).toEqual({
      ...none,
      image,
      machine: "",
    });
    for (const machines of [
      [],
      [serving(sha, "")],
      [serving(sha), serving(sha, `${image}0`)],
    ])
      expect(servingRelease(machines)).toMatchObject({ commit: "", image: "", imageCommit: "" });
  });

  it("rolls out again from the workflow when the check fails", () => {
    const workflow = readFileSync(
      new URL("../../.github/workflows/deploy.yml", import.meta.url),
      "utf8",
    );
    const rollout = workflow.slice(workflow.indexOf("- name: Roll out .dev"));
    expect(rollout).toContain("bash scripts/fly-rollout.sh --config fly.toml");
    expect(rollout.indexOf("fly-rollout.sh --config fly.toml")).toBeLessThan(
      rollout.indexOf(
        'node scripts/fly-machines-serve-commit.mjs cosyworld "$GITHUB_SHA"',
      ),
    );
    expect(rollout).toContain("for attempt in 1 2 3");
  });
});

const planScript = fileURLToPath(
  new URL("../../scripts/plan-dev-deploy.sh", import.meta.url),
);
// The fake gh answers each API path that starts with a key of `api` with
// that key's value, through the script's own jq filter.
const plan = (base, api = {}, attempt = "1", event = "push") => {
  const directory = mkdtempSync(join(tmpdir(), "cosyworld-dev-plan-"));
  writeFileSync(join(directory, "api.json"), JSON.stringify(api));
  writeFileSync(
    join(directory, "gh"),
    `#!/usr/bin/env bash
path="$2"; filter=""; while [ $# -gt 0 ]; do [ "$1" = --jq ] && filter="$2"; shift; done
jq -er --arg path "$path" 'to_entries[] | select(.key as $k | $path | startswith($k)) | .value' "${directory}/api.json" | jq -r "$filter"
`,
  );
  chmodSync(join(directory, "gh"), 0o755);
  try {
    return spawnSync("bash", [planScript, base], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH}`,
        GH_REPO: "example/world",
        GITHUB_SHA: sha,
        GITHUB_RUN_ATTEMPT: attempt,
        GITHUB_EVENT_NAME: event,
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

describe("a .dev run plans before it joins the build queue", () => {
  const older = "b".repeat(40);
  const compare = (status) => ({
    [`repos/example/world/compare/${older}...${sha}`]: { status },
  });

  it("deploys a push with no earlier rollout", () => {
    const result = plan("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("base=\ndeploy=true\n");
  });

  it("deploys nothing for a commit .dev already contains", () => {
    for (const status of ["identical", "behind"]) {
      const result = plan(older, compare(status));
      expect(result.stdout).toContain(`base=${older}\ndeploy=false\n`);
      expect(result.stderr).toContain("which contains");
    }
  });

  it("deploys nothing on a rerun after main moved", () => {
    const main = { "repos/example/world/commits/main": { sha: older } };
    const moved = plan(older, main, "2");
    expect(moved.stdout).toContain("deploy=false");
    expect(moved.stderr).toContain("a rerun deploys only main's head");
  });

  it("leaves a scheduled run to a push run of the same commit", () => {
    const runs = (conclusion) => ({
      "repos/example/world/actions/workflows/deploy.yml/runs": {
        workflow_runs: [{ conclusion }],
      },
    });
    for (const conclusion of [null, "success", "failure"]) {
      const taken = plan("", runs(conclusion), "1", "schedule");
      expect(taken.stdout).toContain("deploy=false");
      expect(taken.stderr).toContain("the push run for");
    }
    const missed = plan("", runs("cancelled"), "1", "schedule");
    expect(missed.stdout).toContain("deploy=true");
  });

  it("leaves the build to a live .dev run of main's newer head", () => {
    const head = "d".repeat(40);
    const api = (title, status, conclusion = null) => ({
      "repos/example/world/commits/main": { sha: head },
      "repos/example/world/actions/workflows/deploy.yml/runs": {
        workflow_runs: [{ display_title: title, status, conclusion }],
      },
    });
    const train = `.dev train ${head}`;
    for (const live of [
      api(train, "queued"),
      api(train, "completed", "success"),
    ]) {
      const result = plan("", live);
      expect(result.stdout).toContain("deploy=false");
      expect(result.stderr).toContain("the .dev run for main's head ddddddd");
    }
    for (const gone of [
      api(train, "completed", "failure"),
      api(train, "completed", "cancelled"),
      api(`Deploy v1.2.3 to both`, "queued"),
    ])
      expect(plan("", gone).stdout).toContain("deploy=true");
  });
});

const rolloutScript = fileURLToPath(
  new URL("../../scripts/fly-rollout.sh", import.meta.url),
);
const rollout = (status, wait) => {
  const directory = mkdtempSync(join(tmpdir(), "cosyworld-fly-rollout-"));
  writeFileSync(
    join(directory, "flyctl"),
    `#!/usr/bin/env bash\necho "$*" > "${directory}/args"\nexit ${status}\n`,
  );
  chmodSync(join(directory, "flyctl"), 0o755);
  try {
    const result = spawnSync(
      "bash",
      [rolloutScript, "--config", "fly.toml", "--image", "x"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}${delimiter}${process.env.PATH}`,
          ...(wait ? { COSYWORLD_FLY_WAIT_TIMEOUT: wait } : {}),
        },
      },
    );
    const args = existsSync(join(directory, "args"))
      ? readFileSync(join(directory, "args"), "utf8").trim()
      : "";
    return { ...result, args };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

describe("a Fly rollout fails fast on a stuck machine", () => {
  it("bounds the machine wait and turns off flyctl's retries", () => {
    const result = rollout(0);
    expect(result.status).toBe(0);
    expect(result.args).toBe(
      "deploy --config fly.toml --image x --wait-timeout 3m --deploy-retries 0",
    );
    expect(rollout(0, "5m").args).toContain("--wait-timeout 5m");
  });

  it("names the stuck rollout and keeps flyctl's exit status", () => {
    const result = rollout(7);
    expect(result.status).toBe(7);
    expect(result.stderr).toContain("::error title=Fly rollout::");
    expect(result.stderr).toContain("within 3m");
    expect(rollout(0, "soon").status).toBe(2);
  });
});

const awaitScript = fileURLToPath(
  new URL("../../scripts/await-dev-image.sh", import.meta.url),
);
const awaitImage = ({ buildsFor = 0, fail = false, limit = "30" } = {}) => {
  const directory = mkdtempSync(join(tmpdir(), "cosyworld-dev-image-"));
  writeFileSync(
    join(directory, "gh"),
    `#!/usr/bin/env bash
${fail ? "exit 1" : ""}
path="$2"; filter=""; while [ $# -gt 0 ]; do [ "$1" = --jq ] && filter="$2"; shift; done
case "$path" in
  */deploy.yml/runs*) echo '{"workflow_runs":[{"id":7,"status":"in_progress","display_title":".dev train x"},{"id":8,"status":"in_progress","display_title":"Deploy v1 to both"}]}' ;;
  */runs/7/jobs"?per_page=100") n=$(cat "${directory}/n" 2>/dev/null || echo 0); echo $((n + 1)) > "${directory}/n"
    status=in_progress; [ "$n" -ge ${buildsFor} ] && status=completed
    printf '{"jobs":[{"name":"Build the .dev image","status":"%s"}]}' "$status" ;;
  *) exit 1 ;;
esac | jq -r "$filter"
`,
  );
  chmodSync(join(directory, "gh"), 0o755);
  try {
    return spawnSync("bash", [awaitScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH}`,
        GH_REPO: "example/world",
        GITHUB_SHA: sha,
        COSYWORLD_DEV_IMAGE_WAIT_INTERVAL: "1",
        COSYWORLD_DEV_IMAGE_WAIT_SECS: limit,
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

describe("production waits for .dev's image of its commit", () => {
  it("waits only while a .dev run is still building it", () => {
    const waited = awaitImage({ buildsFor: 2 });
    expect(waited.status).toBe(0);
    expect(waited.stdout).toContain("Waiting for .dev run(s) building aaaaaaa: 7");
    expect(waited.stdout).toContain("No .dev run is building aaaaaaa.");
    expect(awaitImage().stdout).not.toContain("Waiting");
  });

  it("stops waiting at its limit or when runs cannot be read", () => {
    const slow = awaitImage({ buildsFor: 100, limit: "1" });
    expect(slow.status).toBe(0);
    expect(slow.stdout).toContain("::warning::");
    expect(awaitImage({ fail: true }).stdout).not.toContain("Waiting");
  });
});
