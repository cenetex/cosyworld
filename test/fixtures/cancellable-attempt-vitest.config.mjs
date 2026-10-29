import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/fixtures/cancellable-attempt-probe.mjs"],
    maxWorkers: 1,
    minWorkers: 1,
  },
});
