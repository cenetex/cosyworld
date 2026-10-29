import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/fixtures/runner-update-error-probe.mjs"],
    setupFiles: ["test/setup.mjs"],
    maxWorkers: 1,
    minWorkers: 1,
  },
});
