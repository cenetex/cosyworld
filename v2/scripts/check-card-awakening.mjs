import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/?table=badger-check`);
  const sprite = page.locator("#badger-sprite");
  await sprite.waitFor();
  const decode = () =>
    page.evaluate(() =>
      Promise.all([...document.images].map((image) => image.decode())),
    );
  const play = async (id) => {
    await page.locator(`[data-card="${id}"]`).click();
    await page.locator(`[data-card="${id}"]`).click();
  };
  const state = () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem("cosyworld.steam-clock.v1.badger-check")),
    );
  await mkdir("output/badger-check", { recursive: true });
  await decode();
  assert.equal(await sprite.getAttribute("data-state"), "sleeping");
  await page.screenshot({ path: "output/badger-check/desktop-asleep.png" });
  const badgerCard = page.locator('[data-card="badger"]');
  await badgerCard.focus();
  await page.keyboard.press("Enter");
  assert.equal(await sprite.getAttribute("data-state"), "sleeping");
  assert.equal(await page.locator("#turn").textContent(), "Turn 0");
  await page.keyboard.press("Escape");
  assert.equal(await badgerCard.getAttribute("aria-pressed"), "false");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  assert.equal(await sprite.getAttribute("data-state"), "grumpy");
  assert.equal((await state()).badger.wakeCause, "voice");
  await decode();
  await page.screenshot({ path: "output/badger-check/desktop-awake.png" });
  await page.reload();
  await sprite.waitFor();
  assert.equal(await sprite.getAttribute("data-state"), "grumpy");
  const sibling = await context.newPage();
  await sibling.goto(`${origin}/?table=badger-check`);
  await sibling.locator("#badger-sprite").waitFor();
  await play("clock");
  assert.equal((await state()).badger.irritation, 3);
  await sibling.waitForFunction(
    () => document.getElementById("turn").textContent === "Turn 2",
  );
  await play("clearing");
  await play("clearing");
  await play("clearing");
  assert.equal((await state()).badger.irritation, 0);
  await play("badger");
  assert.match(await page.locator("#dialogue-text").textContent(), /sit there/);
  await page.setViewportSize({ width: 390, height: 844 });
  await decode();
  await page.screenshot({ path: "output/badger-check/mobile-awake.png" });
  assert.equal(await page.evaluate(() => document.body.scrollWidth), 390);
  const bounds = await sprite.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  assert.ok(
    bounds.y + bounds.height <
      (await page.locator(".dialogue").boundingBox()).y,
  );
  await page.locator("#menu-button").click();
  await page.locator("#new-game").click();
  await page.locator("#cancel-reset").click();
  assert.equal((await state()).badger.awake, true);
  await page.locator("#new-game").click();
  await page.locator("#confirm-reset").click();
  assert.equal(await sprite.getAttribute("data-state"), "sleeping");
  await play("clock");
  assert.equal((await state()).badger.wakeCause, "clock");
  await page.evaluate(() =>
    localStorage.setItem("cosyworld.steam-clock.v1.badger-check", "broken"),
  );
  await page.reload();
  await badgerCard.waitFor();
  assert.equal(await badgerCard.isDisabled(), true);
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("cosyworld.steam-clock.v1.badger-check"),
    ),
    "broken",
  );
  await page.locator("#menu-button").click();
  await page.locator("#new-game").click();
  await page.locator("#confirm-reset").click();
  assert.equal(await badgerCard.isDisabled(), false);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.screenshot({
    path: "output/badger-check/small-phone.png",
    fullPage: true,
  });
  assert.equal(await page.evaluate(() => document.body.scrollWidth), 320);
  const shoreSave = encodeSave(createWorld());
  await page.evaluate(
    (saved) =>
      localStorage.setItem("cosyworld.reflected-shore.v1.legacy", saved),
    shoreSave,
  );
  await page.route("**/card-game/text", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":"Browser check"}',
    }),
  );
  await page.goto(`${origin}/?table=legacy`);
  await page.locator('[data-card="vale"]').waitFor();
  await page.locator("#menu-button").click();
  await page.getByRole("link", { name: "Visit the Steam Clock" }).click();
  await sprite.waitFor();
  assert.equal(await sprite.getAttribute("data-state"), "sleeping");
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("cosyworld.reflected-shore.v1.legacy"),
    ),
    shoreSave,
  );
  const privatePage = await context.newPage();
  await privatePage.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Saving unavailable");
      },
    }),
  );
  await privatePage.goto(origin);
  const privateBadger = privatePage.locator('[data-card="badger"]');
  await privateBadger.click();
  await privateBadger.click();
  assert.equal(
    await privatePage.locator("#badger-sprite").getAttribute("data-state"),
    "grumpy",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Badger browser check passed: wake, keyboard, reload, shared tabs, mood, reset, recovery, old saves, and phone layouts.",
  );
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
