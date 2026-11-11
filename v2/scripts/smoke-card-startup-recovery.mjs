// Fault the real entry flow, then retry in a clean document with the same URL.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
try {
  for (const width of [1440, 390]) {
    for (const stage of ["table", "local"]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false }),
        );
      });
      const target =
        stage === "table"
          ? "**/card-game/app.mjs"
          : "**/card-game/local-service.mjs";
      await page.route(target, async (route) => {
        if (stage === "table") {
          await new Promise((resolve) => setTimeout(resolve, 250));
          await route.fulfill({
            contentType: "text/javascript",
            body: 'throw new Error("Injected startup failure");',
          });
        } else
          await route.fulfill({
            contentType: "text/javascript",
            body: 'export async function setupLocalService() { throw new Error("Injected local failure"); }',
          });
      });
      const url = `http://127.0.0.1:${server.address().port}/?intro=1`;
      await page.goto(url);
      const retry = page.locator("#dialogue-advance");
      await retry.waitFor({ state: "visible" });
      assert.equal((await retry.textContent()).trim(), "Try again");
      assert.equal(await retry.getAttribute("aria-label"), "Try again");
      assert.equal(await page.evaluate(() => document.body.inert), false);
      assert.equal(await page.locator(".title-intro").count(), 0);
      // A stale intro continuation must not recreate its overlay or eat keys.
      await page.waitForTimeout(600);
      assert.equal(await page.locator(".title-intro").count(), 0);
      await page.evaluate(() =>
        localStorage.setItem("startup-kept", "saved data"),
      );
      await retry.focus();
      await page.unroute(target);
      await Promise.all([
        page.waitForNavigation(),
        page.keyboard.press("Enter"),
      ]);
      assert.equal(page.url(), url);
      await page.locator("#hand .card").first().waitFor();
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () => !document.body.inert && !document.querySelector(".title-intro"),
      );
      assert.equal(
        await page.evaluate(() => localStorage.getItem("startup-kept")),
        "saved data",
      );
      assert.deepEqual(errors, []);
      console.log(`${stage} startup failure/retry passed at ${width}px`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
