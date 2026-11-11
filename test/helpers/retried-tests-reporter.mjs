// Prints, without failing, the tests that passed only on a retry (vitest.config.js
// has `retry: 1`, which would otherwise hide them). Used by CI:
//   npx vitest run --reporter=default --reporter=./test/helpers/retried-tests-reporter.mjs
export default class RetriedTestsReporter {
  onFinished(files = []) {
    const retried = [];
    const walk = (task, file) => {
      if (task.tasks) task.tasks.forEach((t) => walk(t, file));
      else if (task.result?.state === "pass" && task.result.retryCount > 0)
        retried.push(`${file.name}: ${task.name}`);
    };
    files.forEach((f) => walk(f, f));
    console.log(`\n${retried.length} test(s) passed only on retry (flaky).`);
    retried.forEach((r) => console.log(`  ${r}`));
    if (retried.length && process.env.GITHUB_ACTIONS) console.log("::warning title=Flaky tests::Some tests passed only on retry; see the test log.");
  }
}
