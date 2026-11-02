// Settings shows the passkey's credits and the speech pack link (#1924).
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  await mkdir("output/credits", { recursive: true });
  for (const [width, signedIn] of [
    [1440, true],
    [390, false],
  ]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/card-game/credits", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          signed_in: signedIn,
          balance: signedIn ? 42 : 0,
          prices: { tts: 1, video: 100 },
        }),
      }),
    );
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=credits-${width}`,
    );
    await page.locator("#toolbar-menu-button").click();
    await page.locator("#menu-button").click();
    await page.locator("#credits-status").waitFor({ state: "visible" });
    const text = await page.textContent("#credits-status");
    if (signedIn) assert.match(text, /Credits: 42\. A spoken line costs 1/u);
    else assert.match(text, /Sign in with your passkey/u);
    assert.equal(
      await page.getAttribute("#speech-pack", "href"),
      "https://github.com/cenetex/cosyworld/issues/1924",
    );
    await page.screenshot({ path: `output/credits/settings-${width}.png` });
    assert.deepEqual(errors, []);
    console.log(`Settings showed credits at ${width}px.`);
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
