import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const vector = readFileSync("deploy/observability/vector.yaml", "utf8");
const terraform = readFileSync("infra/production-logs/main.tf", "utf8");
const variables = readFileSync("infra/production-logs/variables.tf", "utf8");
const nginx = readFileSync("deploy/lonelyforest/nginx.conf", "utf8");
const primaryFly = readFileSync("fly.toml", "utf8");
const lonelyforestFly = readFileSync("fly.lonelyforest.toml", "utf8");
const shipperFly = readFileSync("fly.logs.toml", "utf8");
const smoke = readFileSync("scripts/check-production-log-ingestion.sh", "utf8");

describe("durable production logs", () => {
  it("uses structured runtime logs and omits raw Nginx request targets", () => {
    expect(primaryFly).toContain('COSYWORLD_LOG_FORMAT = "json"');
    expect(lonelyforestFly).toContain('COSYWORLD_LOG_FORMAT = "json"');
    expect(nginx).toContain("log_format cosyworld_safe");
    expect(nginx).not.toMatch(/access_log[^;]+combined/);
    const safeFormat =
      nginx.match(/log_format cosyworld_safe[^;]+;/)?.[0] ?? "";
    expect(safeFormat).not.toMatch(/\$request(?:[\s"']|$)/);
    expect(safeFormat).not.toContain("$request_uri");
    expect(safeFormat).not.toContain("$args");
  });

  it("allowlists exactly the two production apps before export", () => {
    expect(vector).toContain('.fly.app.name == "cosyworld"');
    expect(vector).toContain('.fly.app.name == "cosyworld-lonelyforest"');
    expect(vector).toMatch(
      /inputs: \[allowlisted_apps\][\s\S]+normalize_and_redact/,
    );
    expect(vector).toMatch(
      /cloudwatch:[\s\S]+type: aws_cloudwatch_logs[\s\S]+inputs: \[normalize_and_redact\]/,
    );
  });

  it("retains at least fourteen days and never stores the IAM key in state", () => {
    expect(variables).toContain("var.retention_days >= 14");
    expect(variables).toContain("contains([");
    expect(variables).toContain("default     = 30");
    expect(terraform).toContain("retention_in_days = var.retention_days");
    expect(terraform).not.toContain('resource "aws_iam_access_key"');
    expect(terraform).not.toContain("logs:CreateLogGroup");
    expect(terraform).toContain('resource "aws_iam_policy" "incident_reader"');
    expect(terraform).toContain('"logs:StartQuery"');
    expect(terraform).not.toContain('"logs:*"');
  });

  it("defines every required incident alarm classification", () => {
    for (const alert of [
      "forced_exit",
      "health_failure",
      "oom",
      "panic",
      "provider_unavailable",
      "actor_job_failure",
    ]) {
      expect(vector).toContain(`alert_kind = "${alert}"`);
      expect(terraform).toMatch(new RegExp(`\\n    ${alert} = \\{`));
    }
    expect(vector).toContain('event == "actor_job_dead"');
    expect(vector).not.toMatch(/match\(searchable, r'actor job/);
    expect(terraform).toMatch(
      /actor_job_failure = \{[\s\S]*?threshold\s+= 1[\s\S]*?period\s+= 60/,
    );
  });

  it("keeps the shipper private and smoke-checks both app/request pairs", () => {
    expect(shipperFly).not.toContain("[http_service]");
    expect(shipperFly).toContain("[checks.vector]");
    expect(smoke).toContain("https://cosyworld.fly.dev/meta");
    expect(smoke).toContain("https://lonelyforest.com/meta");
    expect(smoke).toContain('.app == "cosyworld"');
    expect(smoke).toContain('.app == "cosyworld-lonelyforest"');
  });
});
