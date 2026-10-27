import { afterAll, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = mkdtempSync(join(tmpdir(), "cosyworld-lint-gate-test-"));
const scripts = join(root, "v2/scripts");
const bin = join(root, "bin");
mkdirSync(scripts, { recursive: true });
mkdirSync(join(root, "v2/orchestrator-rust"));
mkdirSync(bin);
writeFileSync(
  join(scripts, "check-rust-lint.sh"),
  readFileSync(new URL("../../v2/scripts/check-rust-lint.sh", import.meta.url)),
);
writeFileSync(join(scripts, "rust-lint-warning-ceiling.txt"), "2\n");
writeFileSync(
  join(bin, "cargo"),
  '#!/bin/sh\n[ "$*" = "clippy --all-targets" ] || exit 71\ncat "$CARGO_STUB_OUTPUT"\nexit "${CARGO_STUB_EXIT:-0}"\n',
  { mode: 0o755 },
);
afterAll(() => rmSync(root, { recursive: true, force: true }));

function check(lines, status = 0) {
  const output = join(root, "cargo-output.txt");
  writeFileSync(output, lines.join("\n") + "\n");
  return spawnSync("bash", [join(scripts, "check-rust-lint.sh")], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      CARGO_STUB_OUTPUT: output,
      CARGO_STUB_EXIT: String(status),
    },
  });
}
const retries = Array.from(
  { length: 100 },
  (_, n) =>
    `warning: spurious network error (${n % 2 ? "1 try" : "3 tries"} remaining): connection reset`,
);

describe("Rust lint warning gate", () => {
  it("counts compiler warnings after successful Cargo download retries", () => {
    const result = check([
      ...retries,
      "warning: first lint",
      "warning: second lint",
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("cargo clippy: 2 warnings (ceiling: 2)");
  });
  it("still rejects added compiler warnings", () => {
    const result = check([
      ...retries,
      "warning: first",
      "warning: second",
      "warning: third",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("clippy warnings rose from 2 to 3");
  });
  it("retains other warnings that mention the network", () => {
    const result = check([
      "warning: first",
      "warning: second",
      "warning: network error handling",
    ]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("cargo clippy: 3 warnings");
  });
  it("preserves Cargo failure after exhausted retries", () => {
    const result = check(retries, 17);
    expect(result.status).toBe(17);
    expect(result.stderr).toContain("cargo clippy failed to build (exit 17)");
  });
});
