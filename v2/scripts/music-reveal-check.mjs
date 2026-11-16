import assert from "node:assert/strict";
import {
  startNewGame,
  openSettings,
  closeSettings,
  pressSetting,
  putOutOpening,
  revealOpening,
  walkToPond,
} from "./card-browser-helpers.mjs";
import { roomTracks } from "../card-game/music.mjs";

// A new world stays silent until its first play. Spies on the room-music element and its gain stand in
// for an audio device. The browser keeps Chrome's gesture autoplay policy.
export async function checkMusicReveal(browser, origin) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  await context.addInitScript(() => {
    window.musicPlays = [];
    window.musicRamps = [];
    const connect = MediaElementAudioSourceNode.prototype.connect;
    MediaElementAudioSourceNode.prototype.connect = function (node, ...args) {
      if (this.mediaElement.id === "room-music") window.musicGain = node;
      return connect.call(this, node, ...args);
    };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      if (this.id === "room-music") window.musicPlays.push(this.src);
      return play.apply(this, args);
    };
    const ramp = AudioParam.prototype.linearRampToValueAtTime;
    AudioParam.prototype.linearRampToValueAtTime = function (value, time) {
      if (this === window.musicGain?.gain)
        window.musicRamps.push({
          from: this.value,
          to: value,
          seconds: time - window.musicGain.context.currentTime,
        });
      return ramp.call(this, value, time);
    };
  });
  await context.route("**/card-game/text", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":"Story service paused for local check."}',
    }),
  );
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const audio = (read) => page.locator("#room-music").evaluate(read);
  const playing = () =>
    page.waitForFunction(() => {
      const a = document.querySelector("#room-music");
      return !a.paused && a.currentTime > 0;
    });
  async function menuStatus() {
    await openSettings(page);
    const text = await page.locator("#music-status").textContent();
    await closeSettings(page);
    return text;
  }
  try {
    await page.goto(`${origin}/?table=music-reveal`);
    // A new world is silent until its first play, the walk to the pond.
    await revealOpening(page);
    await page.waitForTimeout(1200);
    assert(await audio((a) => a.paused), "The new world waits for a play");
    assert.deepEqual(await page.evaluate(() => window.musicPlays), []);
    assert.equal(await menuStatus(), "Play your first card to start music.");
    await putOutOpening(page);
    assert(await audio((a) => a.paused), "Putting the lamp away is no play");
    await walkToPond(page);
    await playing();
    const song = new URL(await audio((a) => a.src)).pathname;
    assert(
      [...roomTracks.attic, ...roomTracks.pond].some(({ file }) =>
        song.endsWith(file),
      ),
    );
    await page.waitForFunction(() => window.musicRamps.some((r) => r.to > 0));
    const fade = await page.evaluate(() =>
      window.musicRamps.find((r) => r.to > 0),
    );
    assert.equal(fade.from, 0, "The first play starts from silence");
    assert(Math.abs(fade.to - 0.3) < 0.001, "and fades to the music volume");
    assert(fade.seconds > 0.5 && fade.seconds <= 1.05, "over a short fade");
    console.log("Music: a silent new world, the first play fades it in");
    // Settings holds the song, so it plays once Settings closes.
    await page.reload();
    await openSettings(page);
    await closeSettings(page);
    await playing();
    console.log("Music: a reload after the first play keeps music");
    await startNewGame(page);
    await page.reload();
    await openSettings(page);
    await pressSetting(page, "music");
    assert.equal(
      await page.locator("#music-toggle").getAttribute("aria-pressed"),
      "false",
    );
    await closeSettings(page);
    await page.evaluate(() => (window.musicPlays = []));
    await page.waitForFunction(
      () => document.querySelector("#hand").dataset.cooling === "false",
    );
    await putOutOpening(page);
    await walkToPond(page);
    await page.waitForTimeout(1200);
    assert(await audio((a) => a.paused), "Music off stays off");
    assert.deepEqual(await page.evaluate(() => window.musicPlays), []);
    await openSettings(page);
    await pressSetting(page, "music");
    await closeSettings(page);
    await playing();
    assert.deepEqual(errors, []);
    console.log("Music: a new world is silent again and music off stays off");
  } finally {
    await context.close();
  }
}
