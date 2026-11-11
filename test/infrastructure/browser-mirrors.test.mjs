import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../.github/workflows/fast-check.yml", import.meta.url),
  "utf8",
);
const expression = workflow.match(
  /sudo sed -E -i '([^']+)' \/etc\/apt\/apt-mirrors\.txt/,
)?.[1];

function prioritize(mirrors) {
  expect(expression).toBeTruthy();
  // Run the workflow's exact sed expression without changing this host's APT.
  const result = spawnSync("sed", ["-E", expression], {
    input: mirrors,
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

describe("browser dependency mirror fallback", () => {
  it("prefers the archive while preserving the original official fallbacks", () => {
    const azure = "http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n";
    const archive = "https://archive.ubuntu.com/ubuntu/\tpriority:2\n";
    const security = "https://security.ubuntu.com/ubuntu/\tpriority:3\n";
    const result = prioritize(azure + archive + security);
    expect(result).toBe(
      azure + archive.replace("priority:2", "priority:0") + security,
    );
    expect(prioritize(result)).toBe(result);
  });

  it("keeps mirror restrictions and unrelated entries unchanged", () => {
    const other =
      "# Keep runner mirrors\nhttps://ports.ubuntu.com/ubuntu-ports/\n";
    const archive = "http://archive.ubuntu.com/ubuntu priority:12 arch:amd64\n";
    expect(prioritize(other + archive)).toBe(
      other + archive.replace("priority:12", "priority:0"),
    );
    expect(prioritize(other)).toBe(other);
  });

  it("keeps dependency installation and browser smokes mandatory", () => {
    expect(workflow).toContain("run: npx playwright install-deps chromium");
    expect(workflow).toContain('node "v2/scripts/$SMOKE.mjs"');
    expect(workflow).toContain("${{ needs.smoke.result }}");
    expect(workflow).toContain('test "$result" = success');
  });
});
