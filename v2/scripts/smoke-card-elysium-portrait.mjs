import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import sharp from "sharp";
import { createServer } from "../card-game/serve.mjs";
import { profiles } from "../card-game/memory.mjs";
import { DAYLIGHT_TURNS } from "../card-game/pack-rules.mjs";
import { createWorld, legalActions, play } from "../card-game/world.mjs";

const room = "elysium-void-001";
const keystone = "elysium-keystone";
const worldId = "elysium-portrait-smoke";
const screenshot = process.env.COSYWORLD_PORTRAIT_SCREENSHOT;
const app = await readFile(
  new URL("../card-game/app.mjs", import.meta.url),
  "utf8",
);
const portrait = await sharp(
  new URL("../card-game/assets/elysium/resident.png", import.meta.url).pathname,
)
  .tint("#cbb6ff")
  .png()
  .toBuffer();

function action(world, kind, target) {
  const offered = legalActions(world).find(
    (a) => a.kind === kind && (a.item ?? a.target) === target,
  );
  assert(offered, `${kind} ${target} is available`);
  const played = play(world, offered);
  assert(played.ok, played.error);
  return played.state;
}

function fixture() {
  let world = createWorld({ seed: 17 });
  const start = world.items["elysium-wayfinder"].holder;
  world.actors.vale.place = start;
  world.actors.vale.visited.push(start);
  for (const item of Object.values(world.items))
    if (item.holder === "vale") item.holder = start;
  world.revision = world.turn = DAYLIGHT_TURNS;
  world = action(world, "take", "elysium-wayfinder");
  world = action(world, "move", room);
  world = action(world, "move", "elysium-keystone-ledge");
  world = action(world, "take", keystone);
  return action(world, "move", room);
}

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [390, 1440]) {
    let world = fixture();
    let status = 404,
      accountLost = false;
    const requests = [],
      errors = [];
    const page = await browser.newPage({
      viewport: { width, height: 844 },
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/app.mjs", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: `${app}\nglobalThis.coverPortraitScene = () => { covering = true; };`,
      }),
    );
    await page.addInitScript(
      ({ worldId, seen }) => {
        localStorage.setItem(
          `cosyworld.reflected-shore.v1.shared.${worldId}.vale.seen`,
          JSON.stringify(seen),
        );
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false }),
        );
      },
      { worldId, seen: Object.keys(profiles) },
    );
    await page.route("**/auth/account", (route) =>
      route.fulfill({
        json: {
          authenticated: true,
          user_id: "smoke-user",
          account_revision: 0,
        },
      }),
    );
    await page.route(
      new RegExp(`/card-game/shared/worlds/${worldId}(?:/command)?$`),
      (route) =>
        accountLost
          ? route.fulfill({
              status: 401,
              json: { error: "Sign in with your passkey." },
            })
          : route.fulfill({
              json: {
                actor: "vale",
                world,
                now: Date.now(),
                actions: legalActions(world),
                queue: [],
                history: [],
                claimed: [true],
                present: [true],
              },
            }),
    );
    await page.route(
      `**/card-game/shared/worlds/${worldId}/elysium-portrait`,
      (route) => {
        requests.push({
          method: route.request().method(),
          user: route.request().headers()["x-account-user"],
        });
        if (status !== 200) return route.fulfill({ status });
        return route.fulfill({
          contentType: "image/png",
          headers: { "cache-control": "private, no-store" },
          body: portrait,
        });
      },
    );
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?world=${worldId}`,
    );
    const images = [
      '#cast [data-avatar="elysium-resident"] .portrait-body > img',
      '#hand [data-card="elysium-resident"] .art > img',
    ];
    const fallback = () =>
      page.waitForFunction(
        (selectors) =>
          selectors.every((selector) => {
            const img = document.querySelector(selector);
            return (
              img?.naturalWidth > 0 &&
              new URL(img.src).pathname.includes("/elysium/resident.")
            );
          }),
        images,
      );
    const nextResponse = (code) =>
      page.waitForResponse(
        (response) =>
          response.url().endsWith(`/worlds/${worldId}/elysium-portrait`) &&
          response.status() === code,
      );

    await fallback();
    assert.equal(requests.length, 0, "an unearned portrait is never fetched");
    const first = nextResponse(404);
    world = action(world, "drop", keystone);
    assert.deepEqual(world.opened["elysium-gold-spiral"], ["vale"]);
    await first;
    await fallback();
    status = 503;
    await nextResponse(503);
    await fallback();
    status = 200;
    await page.waitForFunction((selectors) => {
      const [stage, card] = selectors.map((selector) =>
        document.querySelector(selector),
      );
      return (
        stage?.naturalWidth > 0 &&
        card?.naturalWidth > 0 &&
        stage.src.startsWith("data:image/png;base64,") &&
        stage.src === card.src
      );
    }, images);
    assert.deepEqual(
      requests,
      Array.from({ length: 3 }, () => ({ method: "GET", user: "smoke-user" })),
    );
    if (width === 390 && screenshot) {
      await page.locator(images[1]).scrollIntoViewIfNeeded();
      await page.screenshot({ path: screenshot });
    }

    await page.evaluate(() => window.coverPortraitScene());
    if (width === 390)
      await page.evaluate(() =>
        dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
      );
    else accountLost = true;
    await fallback();
    assert.equal(
      requests.length,
      3,
      "closing the page or losing the account clears the portrait behind the travel veil",
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("Elysium portrait smoke passed at 390 and 1440 px.");
} finally {
  await browser?.close();
  server.close();
}
