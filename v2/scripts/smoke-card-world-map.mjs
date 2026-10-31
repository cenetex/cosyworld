// Open the storybook map's full view from its card at desktop and phone width:
// uncover it, select it, Look, zoom with a tap, close with Escape and outside.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

const output = "output/card-world-map";
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
      hasTouch: width < 700,
    });
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const key = `cosyworld.reflected-shore.v1.world-map-${width}`;
    await page.addInitScript(
      ({ key, save }) => {
        if (!localStorage.getItem(key)) {
          localStorage.setItem(key, save);
          // A card the player has not uncovered yet.
          localStorage.setItem(`${key}.seen.covered`, '["world-map"]');
        }
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false, volume: 0 }),
        );
      },
      { key, save: encodeSave(createWorld()) },
    );
    await page.route("**/card-game/text", (route) =>
      route.fulfill({ status: 400, json: { error: "No story here." } }),
    );
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=world-map-${width}`,
    );
    const card = page.locator('#hand [data-card="world-map"]');
    await card.waitFor({ state: "attached" });
    await page.waitForFunction(
      () => document.querySelector("#hand").dataset.cooling === "false",
    );
    // A covered map offers no Look until its first tap uncovers it.
    assert.equal(await card.getAttribute("data-unrevealed"), "true");
    await selectCard(page, "world-map", { touch: width < 700 });
    const look = page.locator('#card-actions [data-look="world-map"]');
    await look.waitFor();
    const before = await page.evaluate((key) => localStorage.getItem(key), key);
    await look.click();
    const dialog = page.locator("#item-view[open]");
    await dialog.waitFor();
    const image = page.locator("#item-view-image");
    await page.waitForFunction(
      () => document.querySelector("#item-view-image").naturalWidth > 0,
    );
    assert.match(await image.getAttribute("src"), /world-map-full\.webp$/);
    assert.equal(
      await image.getAttribute("alt"),
      "Map of the Wood and the Wine-Dark Sea",
    );
    const fit = await image.boundingBox();
    assert(fit.width <= width && fit.height <= height, "fits the screen");
    await page.screenshot({ path: `${output}/map-${width}.png` });
    // A tap on the map zooms in; the view scrolls over the larger image.
    await page.locator("#item-view-zoom").press("Enter");
    assert.equal(
      await page.locator("#item-view").getAttribute("data-zoomed"),
      "true",
    );
    assert((await image.boundingBox()).width > fit.width * 1.5, "zooms in");
    await page.screenshot({ path: `${output}/map-${width}-zoomed.png` });
    await image.click();
    assert.equal(
      await page.locator("#item-view").getAttribute("data-zoomed"),
      "false",
    );
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert(await look.evaluate((el) => el === document.activeElement));
    await look.click();
    await page.locator("#item-view-close").press("Enter");
    await dialog.waitFor({ state: "detached" });
    // A tap outside the map closes it too.
    await look.click();
    await dialog.waitFor();
    await page.mouse.click(4, 4);
    await dialog.waitFor({ state: "detached" });
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), key),
      before,
    );
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`World map view opened, zoomed and closed at ${width}px.`);
  }
} finally {
  await browser.close();
  server.close();
}
