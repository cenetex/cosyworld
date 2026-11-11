import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createRadioPlayer } from "../v2/card-game/radio-player.mjs";
import { createRadioStation } from "../v2/card-game/radio-station.mjs";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const snapshot = { station: "ratiradio", version: "v1", serverTimeMs: 12000, startedAtMs: 0, endsAtMs: 60000, track: { file: "pond-1.mp3", title: "Quiet Night", durationMs: 60000 } };
function setup(fetchStation = vi.fn(async () => snapshot)) {
  const audio = new EventTarget();
  Object.assign(audio, { paused: true, currentTime: 0, readyState: 1, duration: 60,
    play: vi.fn(async () => { audio.paused = false; }), pause: vi.fn(() => { audio.paused = true; }), load: vi.fn() });
  const changed = vi.fn();
  const player = createRadioPlayer({ audio, changed, makeContext: () => { throw Error("fallback"); }, makeStation: (options) => createRadioStation({ ...options, fetchStation }) });
  player.setStarted(true); player.setActive(true);
  return { audio, player, changed, fetchStation };
}
const tick = () => vi.advanceTimersByTimeAsync(0);
it("waits for a gesture, seeks the server position, and shares volume", async () => {
  const { player, audio, fetchStation, changed } = setup();
  await tick(); expect(fetchStation).not.toHaveBeenCalled();
  player.unlock(); await tick();
  expect(audio.currentTime).toBe(12); expect(audio.paused).toBe(false);
  expect(changed.mock.lastCall[0].title).toContain("made by ratimics");
  player.setVolume(0.7); expect(audio.volume).toBe(0.7);
  player.setEnabled(false); expect(audio.paused).toBe(true);
  player.setEnabled(true); await tick(); expect(fetchStation).toHaveBeenCalledTimes(2);
  player.setActive(false);
});
it.each(["setHidden", "setQuiet", "setActive", "setStarted"])("cancels pending snapshots on %s and refreshes on return", async (method) => {
  let resolve;
  const { player, audio, fetchStation } = setup(vi.fn(() => new Promise(r => { resolve = r; })));
  player.unlock(); const stop = method === "setHidden" || method === "setQuiet";
  player[method](stop); resolve(snapshot); await tick(); expect(audio.play).not.toHaveBeenCalled();
  player[method](!stop); resolve({ ...snapshot, serverTimeMs: 20000 }); await tick();
  expect(fetchStation).toHaveBeenCalledTimes(2); expect(audio.currentTime).toBe(20);
  player.setActive(false);
});
it("retries autoplay on the next gesture without calling it a media outage", async () => {
  const { audio, player, changed } = setup();
  audio.play.mockRejectedValueOnce(Object.assign(Error("gesture"), { name: "NotAllowedError" }));
  player.unlock(); await tick(); expect(audio.paused).toBe(true);
  expect(changed.mock.lastCall[0].failed).toBe(false);
  player.unlock(); await tick(); expect(audio.paused).toBe(false); player.setActive(false);
});
it("stops failed media, reports off air, and retries through bounded transport", async () => {
  const { audio, player, fetchStation, changed } = setup();
  player.unlock(); await tick(); audio.dispatchEvent(new Event("error"));
  expect(audio.paused).toBe(true); expect(changed.mock.lastCall[0].title).toContain("off the air");
  await vi.advanceTimersByTimeAsync(999); expect(fetchStation).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(fetchStation).toHaveBeenCalledTimes(2);
  player.setActive(false);
});
it("stops late play completion after navigation", async () => {
  const { audio, player } = setup(); let resolve;
  audio.play.mockImplementationOnce(() => new Promise(r => { resolve = () => { audio.paused = false; r(); }; }));
  player.unlock(); await tick(); player.setActive(false); resolve(); await tick();
  expect(audio.paused).toBe(true); expect(audio.volume).toBe(0);
});
it("retunes catalog changes and never keeps yesterday's media position", async () => {
  const fetchStation = vi.fn().mockResolvedValueOnce(snapshot).mockResolvedValue({ ...snapshot, version: "v2", serverTimeMs: 27000, startedAtMs: 15000, endsAtMs: 75000, track: { ...snapshot.track, file: "pond-2.mp3" } });
  const { audio, player } = setup(fetchStation);
  player.unlock(); await tick(); await vi.advanceTimersByTimeAsync(15000);
  expect(audio.load).toHaveBeenCalledTimes(2); expect(audio.src).toContain("pond-2.mp3");
  expect(audio.currentTime).toBe(12); player.setActive(false);
});
it("rejects media shorter than the authoritative position instead of looping it", async () => {
  const { audio, player, changed } = setup(); audio.duration = 5;
  player.unlock(); await tick(); expect(audio.paused).toBe(true);
  expect(changed.mock.lastCall[0].failed).toBe(true); player.setActive(false);
});
