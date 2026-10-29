export default class RunnerUpdateErrorReporter {
  onTaskUpdate() {
    throw new Error("worker-update-error-sentinel");
  }
}
