// A local save that fails validation at boot shows the "needs a fresh
// start" notice on the action beat instead of an empty table (#2043).
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const results = [];
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.setDefaultTimeout(15000);
    const table = `invalid-save-${width}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
    const report = { width, errors: [] };
    results.push(report);
    page.on("pageerror", (error) => report.errors.push(error.message));
    // A current-schema save whose turn is not a number fails validateWorld.
    await page.addInitScript(
      ({ key }) => {
        localStorage.setItem(key, JSON.stringify({ schema: 7, turn: "x" }));
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false }),
        );
      },
      { key },
    );
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=${table}`,
    );
    const status = page.locator("#play-status");
    await status.waitFor({ state: "visible" });
    report.notice = await status.textContent();
    assert.match(report.notice, /needs a fresh start/u);
    assert.match(report.notice, /New game/u);
    // The kept save is not overwritten by the refused boot.
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), key),
      JSON.stringify({ schema: 7, turn: "x" }),
    );
    assert.deepEqual(report.errors, [], "Boot throws nothing");
    report.passed = true;
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
  console.log(JSON.stringify(results, null, 2));
}
