import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRadioStation } from "../v2/card-game/radio-station.mjs";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const data = (time = 1000) => ({
  station: "ratiradio",
  version: "v1",
  serverTimeMs: time,
  startedAtMs: 0,
  endsAtMs: 30000,
  track: { file: "pond-1.mp3", title: "Pond", durationMs: 30000 },
});
it("compensates request latency with monotonic time and ignores wall-clock changes", async () => {
  let resolve;
  const station = createRadioStation({
    fetchStation: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  station.setActive(true);
  await vi.advanceTimersByTimeAsync(200);
  resolve(data());
  await vi.advanceTimersByTimeAsync(0);
  vi.setSystemTime(new Date("2040-01-01"));
  expect(station.position()).toBe(1100);
  await vi.advanceTimersByTimeAsync(500);
  expect(station.position()).toBe(1600);
});
it("invalidates stale responses when stopped", async () => {
  let resolve;
  const changed = vi.fn();
  const station = createRadioStation({
    changed,
    fetchStation: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  station.setActive(true);
  station.setActive(false);
  resolve(data());
  await vi.advanceTimersByTimeAsync(0);
  expect(changed).not.toHaveBeenCalled();
});
it("rejects bad snapshots and caps repeated failure backoff at thirty seconds", async () => {
  const fetchStation = vi.fn(async () => ({
    ...data(),
    track: { file: "../invalid" },
  }));
  const failed = vi.fn();
  const station = createRadioStation({ fetchStation, failed });
  station.setActive(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(failed).toHaveBeenCalledTimes(1);
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    const calls = fetchStation.mock.calls.length;
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(fetchStation).toHaveBeenCalledTimes(calls);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchStation).toHaveBeenCalledTimes(calls + 1);
  }
  station.setActive(false);
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetchStation).toHaveBeenCalledTimes(8);
});
it("times out a hung request and emits catalog retunes at boundaries", async () => {
  const changed = vi.fn(),
    failed = vi.fn();
  const fetchStation = vi
    .fn()
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValue(data(29000));
  const station = createRadioStation({ changed, failed, fetchStation });
  station.setActive(true);
  await vi.advanceTimersByTimeAsync(8000);
  expect(failed).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(changed).toHaveBeenLastCalledWith(data(29000), false);
  const next = {
    ...data(31000),
    version: "v2",
    startedAtMs: 30000,
    endsAtMs: 60000,
  };
  fetchStation.mockResolvedValue(next);
  await vi.advanceTimersByTimeAsync(1000);
  expect(changed).toHaveBeenLastCalledWith(next, true);
});
