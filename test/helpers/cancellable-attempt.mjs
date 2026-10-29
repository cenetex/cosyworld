import { setImmediate as yieldToRunner } from "node:timers/promises";

// Vitest reuses its own aborted signal for retries. Each attempt needs its own
// signal and must finish cleanup before the runner starts the next attempt.
export function runCancellableAttempt(context, run) {
  const controller = new AbortController();
  const checkpoint = async () => {
    await yieldToRunner();
    controller.signal.throwIfAborted();
  };
  const work = Promise.resolve().then(() => run(checkpoint));
  context.onTestFinished(async () => {
    controller.abort();
    await work.catch(() => {});
  }, 120_000);
  return work;
}
