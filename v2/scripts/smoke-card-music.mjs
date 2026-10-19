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
  await page.waitForFunction(() =>
    document.querySelector("#room-music").src.endsWith("attic-1.mp3"),
  );
  assert(await page.locator("#room-music").evaluate((audio) => audio.paused));
  await page.locator("#menu-button").click();
  await page.waitForFunction(
    () => document.querySelector("#room-music").currentTime > 0,
  );

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
      const duration = await page.locator("#room-music").evaluate((audio) => {
        const duration = audio.duration;
        audio.currentTime = duration - 0.1;
        return duration;
      });
      assert(duration > 30, `${room} track ${number} has a decoded duration`);
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
  assert.equal(
    await page.locator("#room-music").evaluate((audio) => audio.volume),
    0.18,
  );
  await page.locator('[data-close="menu-dialog"]').click();

  async function playCard(card) {
    await page.waitForFunction(
      () => document.querySelector("#hand").dataset.cooling === "false",
    );
    await page.locator(`[data-card="${card}"]`).click();
    await page.locator(`[data-card="${card}"]`).click();
  }
  async function travel(room, card = room) {
    await playCard(card);
    await page.waitForFunction(
      (room) =>
        document.querySelector("#room-music").src.endsWith(`${room}-1.mp3`),
      room,
    );
    await checkPair(room);
  }
  await travel("pond", "lamp");
  console.log("Pond tracks played");
  await playCard("moth");
  await travel("station");
  console.log("Station tracks played");
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  assert(await page.locator("#room-music").evaluate((audio) => audio.paused));
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await page.waitForFunction(
    () => !document.querySelector("#room-music").paused,
  );
  await page.locator("#menu-button").click();
  await page.locator("#music-toggle").click();
  assert(await page.locator("#room-music").evaluate((audio) => audio.paused));
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
  await page.screenshot({ path: "/private/tmp/shore-room-music-mobile.png" });
  assert.deepEqual(errors, []);
  console.log(
    "Room music: all six MP3s decoded and played; room travel, two-track loops, saved controls, tab pause/resume, and mobile menu passed.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
