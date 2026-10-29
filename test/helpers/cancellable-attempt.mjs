import { setImmediate as yieldToRunner } from "node:timers/promises";

// Vitest reuses its own aborted signal for retries. Each attempt needs its own
// signal and must finish cleanup before the runner starts the next attempt.
export function runCancellableAttempt(context, run) {
  const controller = new AbortController();
  const started = process.hrtime.bigint();
  const cpuStart = process.cpuUsage();
  let checkpoints = 0;
  const checkpoint = async () => {
    await yieldToRunner();
    controller.signal.throwIfAborted();
    checkpoints++;
    if (checkpoints % 10 === 0) {
      const cpu = process.cpuUsage(cpuStart);
      process.stdout.write(JSON.stringify({ test: context.task.name, checkpoints, elapsedMs: Number(process.hrtime.bigint() - started) / 1e6, cpuMs: (cpu.user + cpu.system) / 1000 }) + "\n");
    }
  };
  const work = Promise.resolve().then(() => run(checkpoint));
  context.onTestFinished(async () => {
    controller.abort();
    await work.catch(() => {});
  }, 120_000);
  return work;
}
