import { describe, expect, it, vi } from "vitest";
import { createRoomMusic } from "../v2/card-game/music.mjs";

function player() {
  const audio = new EventTarget();
  Object.assign(audio, {
    paused: true,
    src: "",
    currentTime: 0,
    play: vi.fn(() => {
      audio.paused = false;
      return Promise.resolve();
    }),
    pause: vi.fn(() => {
      audio.paused = true;
    }),
    load: vi.fn(() => {
      audio.currentTime = 0;
    }),
    removeAttribute: () => {
      audio.src = "";
    },
  });
  const changed = vi.fn();
  const music = createRoomMusic({ audio, changed });
  return { audio, music, changed };
}

describe("room music", () => {
  it("waits for a gesture, cycles both tracks, and keeps the song through scene updates", async () => {
    const { audio, music } = player();
    music.setRoom("attic");
    expect(audio.play).not.toHaveBeenCalled();
    music.unlock();
    await Promise.resolve();
    expect(audio.src).toMatch(/attic-1\.mp3$/);
    audio.currentTime = 40;
    music.setRoom("attic");
    music.unlock();
    expect(audio.currentTime).toBe(40);
    expect(audio.play).toHaveBeenCalledTimes(1);
    audio.dispatchEvent(new Event("ended"));
    expect(audio.src).toMatch(/attic-2\.mp3$/);
    audio.dispatchEvent(new Event("ended"));
    expect(audio.src).toMatch(/attic-1\.mp3$/);
  });

  it("follows travel and keeps each room's place in its playlist", () => {
    const { audio, music } = player();
    music.unlock();
    music.setRoom("pond");
    audio.dispatchEvent(new Event("ended"));
    music.setRoom("station");
    expect(audio.src).toMatch(/station-1\.mp3$/);
    audio.dispatchEvent(new Event("ended"));
    expect(audio.src).toMatch(/station-2\.mp3$/);
    music.setRoom("pond");
    expect(audio.src).toMatch(/pond-2\.mp3$/);
    music.setRoom("new-room");
    expect(audio.paused).toBe(true);
    expect(audio.src).toBe("");
  });

  it("keeps mute through gestures and travel, then starts the current room", () => {
    const { audio, music } = player();
    music.setEnabled(false);
    music.setRoom("attic");
    music.unlock();
    music.setRoom("pond");
    expect(audio.play).not.toHaveBeenCalled();
    music.setEnabled(true);
    expect(audio.src).toMatch(/pond-1\.mp3$/);
    expect(audio.paused).toBe(false);
  });

  it("resumes the same position after hiding the tab and respects mute on return", async () => {
    const { audio, music } = player();
    music.setRoom("station");
    music.unlock();
    await Promise.resolve();
    audio.currentTime = 35;
    music.setHidden(true);
    expect(audio.paused).toBe(true);
    music.setHidden(false);
    expect(audio.paused).toBe(false);
    expect(audio.currentTime).toBe(35);
    music.setHidden(true);
    music.setEnabled(false);
    music.setHidden(false);
    expect(audio.paused).toBe(true);
  });

  it("retries blocked playback on the next gesture", async () => {
    const { audio, music } = player();
    audio.play.mockRejectedValueOnce(
      new DOMException("Gesture required", "NotAllowedError"),
    );
    music.setRoom("attic");
    music.unlock();
    await Promise.resolve();
    music.unlock();
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(audio.src).toMatch(/attic-1\.mp3$/);
  });

  it("ignores an old play promise after rapid travel and mute", async () => {
    const { audio, music, changed } = player();
    let finish;
    audio.play.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    music.setRoom("attic");
    music.unlock();
    music.setRoom("station");
    music.setEnabled(false);
    finish();
    await Promise.resolve();
    expect(audio.src).toMatch(/station-1\.mp3$/);
    expect(audio.paused).toBe(true);
    expect(changed.mock.lastCall[0].enabled).toBe(false);
  });

  it("tries the other song on a file error and stops retries after both fail", () => {
    const { audio, music, changed } = player();
    music.setRoom("attic");
    music.unlock();
    audio.dispatchEvent(new Event("error"));
    expect(audio.src).toMatch(/attic-2\.mp3$/);
    audio.dispatchEvent(new Event("error"));
    music.unlock();
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(changed.mock.lastCall[0].failed).toBe(true);
    music.setEnabled(false);
    music.setEnabled(true);
    expect(audio.play).toHaveBeenCalledTimes(3);
  });

  it("keeps volume within the browser range", () => {
    const { audio, music } = player();
    music.setVolume(0.18);
    expect(audio.volume).toBe(0.18);
    music.setVolume(NaN);
    expect(audio.volume).toBe(0.18);
    music.setVolume(5);
    expect(audio.volume).toBe(1);
    music.setVolume(-1);
    expect(audio.volume).toBe(0);
  });
});
