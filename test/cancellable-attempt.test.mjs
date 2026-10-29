import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("stops a timed-out simulation before its retry starts", () => {
  const output = execFileSync(
    process.execPath,
    [
      resolve("node_modules/vitest/vitest.mjs"),
      "run",
      "--config",
      "test/fixtures/cancellable-attempt-vitest.config.mjs",
    ],
    { cwd: process.cwd(), encoding: "utf8", timeout: 20_000 },
  );
  expect(output).toContain("2 passed");
}, 25_000);

it("keeps normal results and assertion failures visible", async (context) => {
  const { runCancellableAttempt } = await import(
    "./helpers/cancellable-attempt.mjs"
  );
  await expect(
    runCancellableAttempt(context, async (checkpoint) => {
      await checkpoint();
      return 42;
    }),
  ).resolves.toBe(42);
  await expect(
    runCancellableAttempt(context, async () => {
      throw new Error("expected assertion failure");
    }),
  ).rejects.toThrow("expected assertion failure");
});
