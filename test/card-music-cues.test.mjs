import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRoomMusic } from "../v2/card-game/music.mjs";
import {
  battleMusicDue,
  createMusicCues,
} from "../v2/card-game/music-cues.mjs";
import { createWorld, legalActions, play } from "../v2/card-game/world.mjs";

beforeEach(() => vi.useFakeTimers({ now: 0 }));
afterEach(() => vi.useRealTimers());
const advance = (ms) => vi.advanceTimersByTimeAsync(ms);
const now = () => Date.now() / 1000;

async function table() {
  const levels = new Map();
  const element = () => {
    const audio = Object.assign(new EventTarget(), { paused: true, load() {} });
    audio.play = async () => void (audio.paused = false);
    audio.pause = () => (audio.paused = true);
    return Object.assign(audio, { currentTime: 0 });
  };
  const makeContext = () => {
    let ramp = [0, 0, 0, 0];
    const gain = {
      cancelScheduledValues() {},
      setValueAtTime: (v, t) => (ramp = [v, v, t, t]),
      linearRampToValueAtTime: (v, t) => (ramp = [ramp[0], v, ramp[2], t]),
    };
    const value = () => {
      const [from, to, start, end] = ramp;
      const p = end > start ? Math.min(1, (now() - start) / (end - start)) : 1;
      return from + (to - from) * p;
    };
    const node = { connect() {} };
    const context = { state: "running", createGain: () => ({ gain, ...node }) };
    context.createMediaElementSource = (audio) =>
      levels.set(audio, value) && node;
    return Object.defineProperty(context, "currentTime", { get: now });
  };
  const [battle, loss, room] = [element(), element(), element()];
  const queue = [battle, loss];
  const cues = createMusicCues({ makeAudio: () => queue.shift(), makeContext });
  const music = createRoomMusic({ audio: room, cues, makeContext, now });
  music.setStarted(true);
  music.setRoom("pond");
  music.unlock();
  await advance(1000);
  room.currentTime = 42;
  const level = (audio) => levels.get(audio)?.() ?? 0;
  return { music, room, battle, loss, level };
}

it("crossfades from the room song into a looping battle song and back", async () => {
  const { music, room, battle, level } = await table();
  music.cue("battle");
  expect(battle.loop).toBe(true);
  expect(battle.src).toMatch(/battle-attic-lamp\.mp3/);
  await advance(500);
  expect(level(room)).toBeCloseTo(0.15);
  expect(level(battle)).toBeCloseTo(0.15);
  await advance(500);
  expect(room.paused).toBe(true);
  // A new round or strike keeps the song where it is.
  battle.currentTime = 20;
  battle.play = vi.fn(battle.play);
  music.cue("battle");
  await advance(1000);
  expect(battle.play).not.toHaveBeenCalled();
  expect(battle.currentTime).toBe(20);
  // The battle ends: out over 1.5 seconds as the room song resumes in place.
  music.cue(null);
  await advance(750);
  expect(level(battle)).toBeCloseTo(0.15);
  expect([room.paused, room.currentTime]).toEqual([false, 42]);
  await advance(750);
  expect(battle.paused).toBe(true);
  expect(level(room)).toBeCloseTo(0.3);
  music.cue("battle");
  expect([battle.paused, battle.currentTime]).toEqual([false, 0]);
});

it("hands the battle song to the loss screen's song, then to the room", async () => {
  const { music, room, battle, loss, level } = await table();
  music.cue("battle");
  await advance(1000);
  music.cue("battle-loss");
  expect(loss.loop).toBe(true);
  await advance(750);
  expect(level(battle)).toBeCloseTo(0.15);
  expect(level(loss)).toBeCloseTo(0.15);
  await advance(750);
  expect([battle.paused, room.paused]).toEqual([true, true]);
  music.cue(null);
  await advance(1000);
  expect(loss.paused).toBe(true);
  expect([room.paused, room.currentTime]).toEqual([false, 42]);
});

it("follows the music switch, the volume and a hidden tab", async () => {
  const { music, room, battle, level } = await table();
  music.cue("battle");
  await advance(1000);
  music.setVolume(0.6);
  await advance(200);
  expect(level(battle)).toBeCloseTo(0.6);
  battle.currentTime = 12;
  music.setHidden(true);
  await advance(0);
  expect(battle.paused).toBe(true);
  music.setHidden(false);
  await advance(400);
  expect(battle.currentTime).toBe(12);
  expect(level(battle)).toBeCloseTo(0.6);
  music.setEnabled(false);
  await advance(1500);
  expect([battle.paused, room.paused]).toEqual([true, true]);
  music.setEnabled(true);
  await advance(1000);
  expect([battle.paused, battle.currentTime]).toEqual([false, 12]);
  // Before music starts (the attic opening), a cue stays silent.
  music.cue(null);
  await advance(1500);
  music.setStarted(false);
  music.cue("battle");
  await advance(2000);
  expect(battle.paused).toBe(true);
});

it("counts an open standoff the player fights in or stands beside", () => {
  let s = createWorld();
  s.actors.moth.place = "station";
  s.items.lamp.holder = "moth";
  s.actors.moth.want = null;
  expect(battleMusicDue(s, "vale")).toBe(false);
  s = play(
    s,
    legalActions(s).find((a) => a.kind === "threaten" && a.target === "moth"),
  ).state;
  expect(battleMusicDue(s, "vale")).toBe(true);
  // A human outside the fight in its locked room hears it; elsewhere, no.
  const place = s.standoffs[0].location;
  const watcher = (at) => ({
    ...s,
    actors: { ...s.actors, ann: { place: at } },
  });
  expect(battleMusicDue(watcher(place), "ann")).toBe(true);
  expect(battleMusicDue(watcher("attic"), "ann")).toBe(false);
  expect(battleMusicDue({ ...s, standoffs: [] }, "vale")).toBe(false);
});
