import assert from "node:assert/strict";
import {
  clearSelection,
  selectCard,
  startNewGame,
  openSettings,
  closeSettings,
  pressSetting,
  putOutOpening,
  revealOpening,
  readyActionButton,
} from "./card-browser-helpers.mjs";
import { roomTracks } from "../card-game/music.mjs";

// The opening attic stays silent until the lamp goes out and the mirror first
// shows the Black pond. Spies on the room-music element and its gain stand in
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
  const revealed = () =>
    page.evaluate(() => localStorage.getItem("cosyworld.music-revealed"));
  const playing = () =>
    page.waitForFunction(() => {
      const a = document.querySelector("#room-music");
      return !a.paused && a.currentTime > 0;
    });
  async function playCard(card) {
    await page.waitForFunction(
      () => document.querySelector("#hand").dataset.cooling === "false",
    );
    await clearSelection(page);
    await selectCard(page, card);
    await readyActionButton(page).click();
    await page.waitForFunction(
      () => document.querySelector("#hand").dataset.cooling === "false",
    );
  }
  async function menuStatus() {
    await openSettings(page);
    const text = await page.locator("#music-status").textContent();
    await closeSettings(page);
    return text;
  }
  try {
    await page.goto(`${origin}/?table=music-reveal`);
    // A Wait in the lamplit attic is a first play, but the music waits. The
    // opening offers no play until the lamp and attic are revealed.
    await revealOpening(page);
    await playCard("attic");
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("cosyworld.reflected-shore.v1.music-reveal"),
          ).turn,
      ),
      1,
    );
    await page.waitForTimeout(1200);
    assert(await audio((a) => a.paused), "The lit attic stays silent");
    assert.deepEqual(await page.evaluate(() => window.musicPlays), []);
    assert.equal(await revealed(), null);
    assert.equal(await menuStatus(), "Music waits for the dark.");
    // Dousing the lamp opens the mirror onto the pond: the music fades in.
    await playCard("lamp");
    await page
      .locator('#hand [data-card="pond"]')
      .waitFor({ state: "attached" });
    await playing();
    assert(
      new URL(await audio((a) => a.src)).pathname.endsWith(
        roomTracks.attic[0].file,
      ),
    );
    await page.waitForFunction(() => window.musicRamps.some((r) => r.to > 0));
    const fade = await page.evaluate(() =>
      window.musicRamps.find((r) => r.to > 0),
    );
    assert.equal(fade.from, 0, "The reveal starts from silence");
    assert(Math.abs(fade.to - 0.3) < 0.001, "and fades to the music volume");
    assert(fade.seconds > 0.5 && fade.seconds <= 1.05, "over a short fade");
    const firstWorld = await revealed();
    assert.match(firstWorld, /^local:.*music-reveal:\d+$/);
    console.log("Music: silent lit attic, the pond reveal fades it in");
    // Relit, the mirror closes, but the reveal has happened: a reload plays.
    await playCard("lamp");
    // Settings holds the song, so it plays once Settings closes.
    await page.reload();
    await openSettings(page);
    await closeSettings(page);
    await playing();
    console.log("Music: a reload after the reveal keeps music");
    // A new world wakes in the silent attic again.
    await startNewGame(page);
    await page.reload();
    await openSettings(page);
    // Music off: the reveal is recorded and nothing plays.
    await pressSetting(page, "music");
    assert.equal(
      await page.locator("#music-toggle").getAttribute("aria-pressed"),
      "false",
    );
    await closeSettings(page);
    await page.evaluate(() => (window.musicPlays = []));
    // The new world opens on its reveals, then Put out (opening.mjs).
    await page.waitForFunction(
      () => document.querySelector("#hand").dataset.cooling === "false",
    );
    await putOutOpening(page);
    await page
      .locator('#hand [data-card="pond"]')
      .waitFor({ state: "attached" });
    await page.waitForTimeout(1200);
    assert(await audio((a) => a.paused), "Music off stays off");
    assert.deepEqual(await page.evaluate(() => window.musicPlays), []);
    const secondWorld = await revealed();
    assert(
      secondWorld && secondWorld !== firstWorld,
      "A new world reveals anew",
    );
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
