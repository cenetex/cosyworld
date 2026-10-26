import { selectCard } from "./card-browser-helpers.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { roomTracks } from "../card-game/music.mjs";
import { createWorld, encodeSave, play } from "../card-game/world.mjs";
import { cardPlay } from "../card-game/cards.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  page.setDefaultTimeout(15_000);
  await page.addInitScript(() => {
    window.musicStops = [];
    const connect = MediaElementAudioSourceNode.prototype.connect;
    MediaElementAudioSourceNode.prototype.connect = function (node, ...args) {
      window.musicGain = node;
      return connect.call(this, node, ...args);
    };
    for (const method of ["pause", "load"]) {
      const original = HTMLMediaElement.prototype[method];
      HTMLMediaElement.prototype[method] = function (...args) {
        if (this.id === "room-music")
          window.musicStops.push({
            method,
            level: window.musicGain?.gain.value || 0,
          });
        return original.apply(this, args);
      };
    }
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/card-game/text", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":"Story service paused for local check."}',
    }),
  );
  await page.goto(
    `http://127.0.0.1:${server.address().port}/?table=music-smoke`,
  );
  console.log("Loaded card table");
  // Cards met for the first time are unveiled; take each into the hand.
  async function takeUnveiled() {
    while (await page.locator("#unveil-dialog[open]").count()) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(60);
    }
  }
  async function playCard(card) {
    await takeUnveiled();
    await page.waitForFunction(
      () => document.querySelector("#hand").dataset.cooling === "false",
    );
    await selectCard(page, card);
    await page.locator("#card-actions .card-primary").click();
  }
  // A new game stays quiet, menu included, until its first accepted card play.
  await page.locator("#menu-button").click();
  await page.waitForTimeout(500);
  assert(await page.locator("#room-music").evaluate((audio) => audio.paused));
  await page.locator('[data-close="menu-dialog"]').click();
  // Lighting the lamp opens the way to the pond and starts the attic music.
  await playCard("lamp");
  await page.waitForFunction(() =>
    document.querySelector('#hand [data-card="pond"]'),
  );
  await takeUnveiled();
  await page.waitForFunction(() => {
    const audio = document.querySelector("#room-music");
    return audio.src.endsWith("attic-1.mp3") && audio.currentTime > 0;
  });
  await page.locator("#menu-button").click();
  let volume = 0.3;
  const fullVolume = () =>
    page.waitForFunction(
      (volume) => Math.abs(window.musicGain.gain.value - volume) < 0.002,
      volume,
    );
  await fullVolume();

  async function checkPlaylist(room) {
    for (const [index, track] of roomTracks[room].entries()) {
      await page.waitForFunction((file) => {
        const audio = document.querySelector("#room-music");
        return (
          audio.src.endsWith(file) &&
          audio.currentTime > 0 &&
          !audio.paused &&
          Number.isFinite(audio.duration)
        );
      }, track.file);
      await fullVolume();
      const duration = await page.locator("#room-music").evaluate((audio) => {
        const duration = audio.duration;
        audio.currentTime = duration - 1.25;
        return duration;
      });
      assert(
        duration > 30,
        `${room} track ${index + 1} has a decoded duration`,
      );
      await page.waitForFunction((volume) => {
        const level = window.musicGain.gain.value;
        return level > 0.01 && level < volume - 0.02;
      }, volume);
    }
    await page.waitForFunction(
      (file) => document.querySelector("#room-music").src.endsWith(file),
      roomTracks[room][0].file,
    );
  }
  await checkPlaylist("attic");
  console.log("Attic tracks played");
  await page.locator("#music-volume").evaluate((input) => {
    input.value = "18";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  volume = 0.18;
  await fullVolume();
  await page.locator('[data-close="menu-dialog"]').click();

  async function travel(room, card = room) {
    await fullVolume();
    const oldSource = await page.locator("#room-music").getAttribute("src");
    await playCard(card);
    assert.equal(
      await page.locator("#room-music").getAttribute("src"),
      oldSource,
    );
    assert(await page.evaluate(() => window.musicGain.gain.value > 0));
    await page.waitForFunction((volume) => {
      const level = window.musicGain.gain.value;
      return level > 0.01 && level < volume - 0.02;
    }, volume);
    await page.waitForFunction(
      (file) => document.querySelector("#room-music").src.endsWith(file),
      roomTracks[room][0].file,
    );
    await checkPlaylist(room);
  }
  // Playing the pond goes there.
  await travel("pond");
  console.log("Pond tracks played");
  await playCard("moth");
  await travel("station");
  console.log("Station tracks played");
  await fullVolume();
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  assert(await page.locator("#room-music").evaluate((audio) => !audio.paused));
  await page.waitForFunction(
    () => document.querySelector("#room-music").paused,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await page.waitForFunction(
    () => !document.querySelector("#room-music").paused,
  );
  await page.locator("#menu-button").click();
  await fullVolume();
  await page.locator("#music-toggle").click();
  assert(await page.locator("#room-music").evaluate((audio) => !audio.paused));
  await page.waitForFunction(
    () => document.querySelector("#room-music").paused,
  );
  assert(
    await page.evaluate(() =>
      window.musicStops.every(({ level }) => level < 0.003),
    ),
    "Track changes and pauses happen after the gain reaches silence",
  );
  await page.reload();
  await page.locator("#menu-button").click();
  assert.equal(
    await page.locator("#music-toggle").getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(await page.locator("#music-volume").inputValue(), "18");
  assert(await page.locator("#room-music").evaluate((audio) => audio.paused));
  await page.locator("#music-toggle").click();
  await page.waitForFunction(
    () => !document.querySelector("#room-music").paused,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#music-volume").scrollIntoViewIfNeeded();
  assert(await page.locator("#music-volume").isVisible());
  assert(await page.locator("#music-toggle").isVisible());
  await fullVolume();
  await page.locator("#music-toggle").click();
  assert(await page.locator("#room-music").evaluate((audio) => !audio.paused));
  await page.waitForFunction(
    () => document.querySelector("#room-music").paused,
  );
  await page.locator("#music-toggle").click();
  await fullVolume();
  await page.screenshot({ path: "output/music/shore-room-mobile.png" });

  // Complete the authored signal, then use the real Board and Disembark cards.
  let ship = createWorld({ opening: true });
  ship.opening.crossed = true;
  ship.opening.met.moth = 0;
  ship.locations.attic.anchored = true;
  ship.actors.vale.place = "pond";
  ship.actors.moth.place = ship.actors.keeper.place = "station";
  ship.items.lamp.holder = ship.items.cloth.holder = "vale";
  ship.items.lamp.lit = true;
  ship.items.lamp.fuel = 12;
  for (const cards of [
    ["cloth", "lamp"],
    ["cloth"],
    ["cloth", "lamp"],
    ["cloth"],
  ]) {
    const result = play(ship, cardPlay(ship, cards).action);
    assert(result.ok, result.error);
    ship = result.state;
  }
  await page.evaluate((save) => {
    localStorage.setItem("cosyworld.reflected-shore.v1.music-smoke", save);
  }, encodeSave(ship));
  await page.reload();
  await takeUnveiled();
  await page.locator("#menu-button").click();
  await fullVolume();
  assert.equal(await page.locator("#music-volume").inputValue(), "18");
  await page.locator('[data-close="menu-dialog"]').click();
  await travel("greek-ship");
  console.log("All ship tracks played");
  await playCard("greek-harbor");
  await page.waitForFunction(
    () => document.querySelector("#room-music").paused,
  );
  await playCard("greek-ship");
  await checkPlaylist("greek-ship");
  await travel("pond");
  assert(
    await page.evaluate(() =>
      window.musicStops.every(({ level }) => level < 0.003),
    ),
    "Ship boarding and disembarking change music after the fade",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Room music: all nine MP3s played with fades at track endings, room changes, and pause/resume; ship round trip, saved controls and mobile menu passed.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
