import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";

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
      await page.click("#unveil-take");
      await page.waitForFunction(
        () => !document.querySelector(".unveil-ghost"),
      );
    }
  }
  async function playCard(card) {
    await takeUnveiled();
    await page.waitForFunction(
      () => document.querySelector("#hand").dataset.cooling === "false",
    );
    await page.locator(`#hand [data-card="${card}"]`).click();
    await page
      .locator(`#hand [data-card="${card}"]`)
      .locator("..")
      .locator(".card-primary")
      .click();
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

  async function checkPair(room) {
    for (const number of [1, 2]) {
      await page.waitForFunction(
        ({ room, number }) => {
          const audio = document.querySelector("#room-music");
          return (
            audio.src.endsWith(`${room}-${number}.mp3`) &&
            audio.currentTime > 0 &&
            !audio.paused &&
            Number.isFinite(audio.duration)
          );
        },
        { room, number },
      );
      await fullVolume();
      const duration = await page.locator("#room-music").evaluate((audio) => {
        const duration = audio.duration;
        audio.currentTime = duration - 1.25;
        return duration;
      });
      assert(duration > 30, `${room} track ${number} has a decoded duration`);
      await page.waitForFunction((volume) => {
        const level = window.musicGain.gain.value;
        return level > 0.01 && level < volume - 0.02;
      }, volume);
    }
    await page.waitForFunction(
      (room) =>
        document.querySelector("#room-music").src.endsWith(`${room}-1.mp3`),
      room,
    );
  }
  await checkPair("attic");
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
      (room) =>
        document.querySelector("#room-music").src.endsWith(`${room}-1.mp3`),
      room,
    );
    await checkPair(room);
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
  assert.deepEqual(errors, []);
  console.log(
    "Room music: all six MP3s played with fades at track endings, room changes, and pause/resume; saved controls and mobile menu passed.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
