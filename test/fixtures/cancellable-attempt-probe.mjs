import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { runCancellableAttempt } from "../helpers/cancellable-attempt.mjs";

let attempts = 0;
let firstTurns = 0;
const events = [];

it(
  "stops the timed-out attempt before retrying",
  { timeout: 300, retry: 1 },
  (context) =>
    runCancellableAttempt(context, async (checkpoint) => {
      const attempt = ++attempts;
      if (attempt === 1) {
        events.push("first start");
        try {
          while (true) {
            firstTurns++;
            await delay(5);
            await checkpoint();
          }
        } finally {
          events.push("first stop");
        }
      }
      events.push("retry start");
      expect(events).toEqual(["first start", "first stop", "retry start"]);
      const stoppedAt = firstTurns;
      await delay(10);
      expect(firstTurns).toBe(stoppedAt);
      await checkpoint();
      events.push("retry finish");
    }),
);

it("leaves the first attempt stopped after the retry", async () => {
  expect(attempts).toBe(2);
  expect(events).toEqual([
    "first start",
    "first stop",
    "retry start",
    "retry finish",
  ]);
  const stoppedAt = firstTurns;
  await delay(20);
  expect(firstTurns).toBe(stoppedAt);
});
