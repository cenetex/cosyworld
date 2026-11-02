// Settings shows the passkey's credits and the speech pack link, and the
// camera films a scene for 100 credits on the server (#1924). In a shared
// world, Settings shows the world's pool and commits credits to it through
// the action beat, and the camera films on the pool.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
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

async function checkPool(width) {
  const page = await browser.newPage({
    viewport: { width, height: 900 },
    reducedMotion: "reduce",
  });
  const errors = [],
    commits = [];
  let pool = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  const shared = dispatchShared({
    op: "create",
    save: encodeSave(createWorld()),
  }).world;
  await page.route("**/auth/account", (route) =>
    route.fulfill({ json: { authenticated: true } }),
  );
  await page.route(
    /\/card-game\/shared\/worlds\/pool-w(?:\/command)?$/u,
    (route) =>
      route.fulfill({
        json: {
          ...dispatchShared({
            op: "view",
            world: shared,
            actor: "vale",
            claimed: ["vale"],
            present: ["vale"],
          }),
          id: "pool-w",
          version: "full-card-world/9",
          claimed: [1, 0, 0, 0, 0, 0, 0, 0],
          present: [1, 0, 0, 0, 0, 0, 0, 0],
          now: Date.now(),
          queue: [],
          history: [],
        },
      }),
  );
  await page.route("**/card-game/credits", (route) =>
    route.fulfill({
      json: {
        signed_in: true,
        balance: 142 - pool,
        prices: { tts: 1, video: 100 },
      },
    }),
  );
  const view = () => ({
    world: "pool-w",
    pool,
    contributors: pool ? [{ name: "Moss", credits: pool }] : [],
  });
  await page.route("**/card-game/credits/pool?world=pool-w", (route) =>
    route.fulfill({ json: view() }),
  );
  await page.route("**/card-game/credits/commit", (route) => {
    const body = route.request().postDataJSON();
    commits.push(body);
    pool += body.credits;
    return route.fulfill({ json: { ...view(), balance: 142 - pool } });
  });
  await page.goto(`${origin()}/?world=pool-w`);
  await page.waitForFunction(() => document.body.inert === false);
  await page.locator("#toolbar-menu-button").click();
  await page.locator("#menu-button").click();
  const status = page.locator("#credit-pool-status");
  await page.waitForFunction(() =>
    /pool: 0 credits/u.test(
      document.querySelector("#credit-pool-status").textContent,
    ),
  );
  assert.match(await status.textContent(), /Nobody has committed/u);
  await page.screenshot({ path: `output/credits/pool-settings-${width}.png` });
  await page.locator('[data-commit="10"]').click();
  await page.locator("#credit-commit-confirm").click();
  await page.locator("#credit-commit-done").waitFor({ state: "visible" });
  assert.match(
    await page.textContent(".action-beat-heading"),
    /pool holds 10 credits/u,
  );
  await page.screenshot({ path: `output/credits/pool-commit-${width}.png` });
  assert.deepEqual(
    commits.map(({ world, credits }) => [world, credits]),
    [["pool-w", 10]],
  );
  await page.locator("#credit-commit-done").click();
  await page.locator("#scene-video-button").click();
  assert.match(
    await page.textContent("#scene-video-create"),
    /from the pool \(10\)/u,
  );
  assert.equal(await page.locator("#scene-video-create").isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log(`Settings committed credits to a world's pool at ${width}px.`);
  await page.close();
}

const server = createServer();
const origin = () => `http://127.0.0.1:${server.address().port}`;
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
          checkout: signedIn,
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
    // The camera sits beside the wordmark, in colour or grey, never over it.
    await page.waitForFunction(
      () => document.querySelector("#scene-video-button").dataset.affordable,
    );
    const [mark, camera] = await Promise.all(
      ["#scene-video-button strong", "#scene-video-button svg"].map((s) =>
        page.locator(s).boundingBox(),
      ),
    );
    assert.ok(mark && camera, `wordmark and camera render at ${width}px`);
    assert.ok(
      camera.x >= mark.x + mark.width ||
        camera.x + camera.width <= mark.x ||
        camera.y >= mark.y + mark.height ||
        camera.y + camera.height <= mark.y,
      `camera ${JSON.stringify(camera)} overlaps wordmark ${JSON.stringify(mark)} at ${width}px`,
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
    // With Stripe on, a signed-in passkey buys the pack through Checkout.
    assert.equal(await page.locator("#speech-pack").isVisible(), !signedIn);
    assert.equal(await page.locator("#buy-speech-pack").isVisible(), signedIn);
    await page.screenshot({ path: `output/credits/settings-${width}.png` });
    if (signedIn) {
      await page.route("**/card-game/credits/checkout", (route) =>
        route.fulfill({ json: { url: `${origin()}/?credits=bought` } }),
      );
      await page.locator("#buy-speech-pack").click();
      await page.waitForURL(/credits=bought/u);
    }
    assert.deepEqual(errors, []);
    console.log(`Settings showed credits at ${width}px.`);
    await page.close();
  }
  for (const width of [1440, 390]) await checkPool(width);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
