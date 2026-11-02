// Settings shows the passkey's credits and the speech pack link, and the
// camera films a scene for 100 credits on the server (#1924).
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { addLog, createWorld, encodeSave } from "../card-game/world.mjs";

const world = createWorld({ opening: true });
addLog(world, "Vale", "The lamp is steady.", {
  actorId: "vale",
  entityId: "vale",
  kind: "dialogue",
  generated: true,
  locationId: world.actors.vale.place,
});
const save = encodeSave(world);

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
          balance: signedIn ? 142 : 0,
          prices: { tts: 1, video: 100 },
        }),
      }),
    );
    const filmed = [];
    await page.route("**/card-game/video**", (route) => {
      const url = new URL(route.request().url());
      filmed.push(`${route.request().method()} ${url.pathname}`);
      if (url.pathname.endsWith("/content"))
        return route.fulfill({
          status: 200,
          contentType: "video/mp4",
          body: "",
        });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          url.pathname.endsWith("/model")
            ? { id: "tbc/mischief-1", supported_durations: [5] }
            : {
                request_id: "x",
                status:
                  url.pathname === "/card-game/video"
                    ? "submitted"
                    : "completed",
              },
        ),
      });
    });
    const table = `credits-${width}`;
    await page.addInitScript(
      ({ key, save }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
      },
      { key: `cosyworld.reflected-shore.v1.${table}`, save },
    );
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=${table}`,
    );
    await page.locator("#scene-video-button").click();
    const create = page.locator("#scene-video-create");
    assert.match(await create.textContent(), /100 credits/u);
    if (signedIn) {
      await create.click();
      await page.locator("#scene-video-player").waitFor({ state: "visible" });
      assert.deepEqual(filmed, [
        "GET /card-game/video/model",
        "POST /card-game/video",
        filmed[2],
        filmed[3],
      ]);
      assert.match(filmed[3], /\/content$/u);
    } else {
      assert.equal(await create.isDisabled(), true);
      assert.match(await page.textContent("#scene-video-status"), /Sign in/u);
    }
    await page.screenshot({ path: `output/credits/camera-${width}.png` });
    await page.locator("#scene-video-close").click();
    await page.locator("#toolbar-menu-button").click();
    await page.locator("#menu-button").click();
    await page.locator("#credits-status").waitFor({ state: "visible" });
    const text = await page.textContent("#credits-status");
    if (signedIn) assert.match(text, /Credits: 142\. A spoken line costs 1/u);
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
