import { execFileSync } from "node:child_process";
import { test } from "vitest";

test("the offline shared journal archive preserves and verifies bytes", () => {
  execFileSync("python3", ["v2/scripts/test_archive_shared_journal.py"]);
});
