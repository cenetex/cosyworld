import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { setImmediate as nodeSetImmediate } from "node:timers";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const realSetImmediate = nodeSetImmediate;
const spy = vi.fn();
const cleanupOrder = [];
let realCallbackRan = false;
let fakeCallbackRan = false;
afterAll(() => vi.useRealTimers());

it("lets queued real work finish before clearing mocks", (context) => {
  context.onTestFinished(() => {
    expect(realCallbackRan).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
  realSetImmediate(() => {
    realCallbackRan = true;
    spy();
  });
});

it("clears calls made during the previous test cleanup", () => {
  expect(realCallbackRan).toBe(true);
  expect(spy).not.toHaveBeenCalled();
});

it("leaves a fake clock active during cleanup", (context) => {
  context.onTestFinished(() => {
    expect(vi.isFakeTimers()).toBe(true);
    expect(vi.getTimerCount()).toBe(2);
    expect(fakeCallbackRan).toBe(false);
  });
  vi.useFakeTimers();
  setTimeout(() => {
    fakeCallbackRan = true;
  }, 10);
  setImmediate(() => {
    fakeCallbackRan = true;
  });
  expect(vi.isFakeTimers()).toBe(true);
  expect(vi.getTimerCount()).toBe(2);
});

it("keeps fake clock state and existing timer cleanup", () => {
  expect(vi.isFakeTimers()).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  expect(fakeCallbackRan).toBe(false);
  vi.useRealTimers();
});

describe("nested cleanup ordering", () => {
  afterEach(() => cleanupOrder.push("nested"));
  it("runs a nested case", (context) => {
    context.onTestFinished(() => {
      expect(cleanupOrder).toEqual(["body", "nested", "queued"]);
    });
    cleanupOrder.push("body");
    realSetImmediate(() => cleanupOrder.push("queued"));
  });
});

it("runs nested cleanup before the next case", () => {
  expect(cleanupOrder).toEqual(["body", "nested", "queued"]);
});

it("keeps worker update errors fatal", () => {
  const run = spawnSync(
    process.execPath,
    [
      resolve("node_modules/vitest/vitest.mjs"),
      "run",
      "--config",
      "test/fixtures/runner-update-error.config.mjs",
      "--reporter=default",
      "--reporter=./test/fixtures/runner-update-error-reporter.mjs",
    ],
    { cwd: process.cwd(), encoding: "utf8", timeout: 20_000 },
  );
  expect(run.status).toBe(1);
  expect(run.stdout + run.stderr).toContain("worker-update-error-sentinel");
});
