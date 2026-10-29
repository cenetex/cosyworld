import rootConfig from "../../vitest.config.js";

export default {
  ...rootConfig,
  test: {
    ...rootConfig.test,
    include: ["test/fixtures/runner-update-error-probe.mjs"],
    maxWorkers: 1,
    minWorkers: 1,
  },
};
