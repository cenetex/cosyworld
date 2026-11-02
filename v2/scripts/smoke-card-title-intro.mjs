import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { TITLES } from "../card-game/title-intro.mjs";

// The first arrival sees a Lonely Forest title fade over the booting table,
// then Vale's lit attic; later visits and a skip go straight to the table.
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const output = new URL("../../output/title-intro/", import.meta.url);
await mkdir(output, { recursive: true });
const shots = [];

async function open(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/card-game/text", (route) => {
    const input = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        revision: input.revision,
        model: "title-fixture",
        entries: input.entities.map(({ id }) => ({ id, text: "Awake." })),
      }),
    });
  });
  page.errors = errors;
  return page;
}
const newContext = (width, height, reducedMotion = "no-preference") =>
  browser.newContext({ viewport: { width, height }, reducedMotion });
const titlePhase = (page) =>
  page.waitForSelector('.title-intro[data-phase="title"]');
const gone = (page, timeout) =>
  page.waitForSelector(".title-intro", { state: "detached", timeout });

try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    const context = await newContext(width, height);
    await context.addInitScript(() => {
      localStorage.setItem("cosyworld.dialogue.sound", "off");
      localStorage.setItem(
        "cosyworld.room-music",
        JSON.stringify({ enabled: false }),
      );
    });
    // Automated browsers skip the title on the bare address.
    const bare = await open(context);
    await bare.goto(`${origin}/`);
    await bare.waitForSelector("#hand .card");
    assert.equal(await bare.locator(".title-intro").count(), 0);
    await bare.close();
    const fresh = await newContext(width, height);
    const page = await open(fresh);
    const started = Date.now();
    await page.goto(`${origin}/?intro=1`);
    await titlePhase(page);
    const title = await page.locator(".title-intro").getAttribute("data-title");
    assert.ok(TITLES.includes(title), title);
    await page.waitForTimeout(1100);
    const box = await page.locator(".title-intro img").boundingBox();
    const loaded = await page.$eval(
      ".title-intro img",
      (img) => img.complete && img.naturalWidth > 0,
    );
    assert.ok(loaded, "the title image loaded before fading in");
    // About three quarters of a desktop, the full phone width less margins.
    if (width > 640)
      assert.ok(box.width > width * 0.65 && box.width < width * 0.85);
    else assert.ok(Math.abs(box.width - (width - 32)) < 2, String(box.width));
    const path = new URL(`intro-${width}.png`, output).pathname;
    await page.screenshot({ path });
    shots.push(path);
    // The table boots under the title instead of waiting for it.
    await page.waitForSelector("#hand .card");
    assert.equal(await page.locator(".title-intro").count(), 1);
    await gone(page, 6000);
    assert.ok(Date.now() - started < 6500, "the title takes about 5 s");
    const save = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("cosyworld.reflected-shore.v1")),
    );
    assert.equal(save.actors.vale.place, "attic");
    assert.equal(save.items.lamp.lit, true);
    assert.match(
      await page.locator("#backdrop").getAttribute("src"),
      /attic-lit/,
    );
    const after = new URL(`after-${width}.png`, output).pathname;
    await page.screenshot({ path: after });
    shots.push(after);
    // A reload, and a later visit, go straight to the table.
    await page.reload();
    await page.waitForSelector("#hand .card");
    await page.waitForTimeout(600);
    assert.equal(await page.locator(".title-intro").count(), 0);
    assert.equal(
      await page.evaluate(() => localStorage.getItem("cosyworld.title-intro")),
      "seen",
    );
    const later = await open(fresh);
    await later.goto(`${origin}/?intro=1`);
    await later.waitForSelector("#hand .card");
    await later.waitForTimeout(600);
    assert.equal(await later.locator(".title-intro").count(), 0);
    assert.deepEqual([...page.errors, ...later.errors], []);
    await fresh.close();
    await context.close();

    // A tap (desktop) or any key (phone) skips to the opening.
    const skipContext = await newContext(width, height);
    const skipper = await open(skipContext);
    await skipper.goto(`${origin}/?intro=1`);
    await titlePhase(skipper);
    const skippedAt = Date.now();
    if (width > 640) await skipper.mouse.click(width / 2, height / 2);
    else await skipper.keyboard.press("Space");
    await gone(skipper, 1500);
    assert.ok(Date.now() - skippedAt < 1200);
    await skipper.waitForSelector("#hand .card");
    await skipContext.close();
  }
  // Reduced motion crossfades without scaling and still reveals the attic.
  const reduced = await newContext(390, 844, "reduce");
  const quiet = await open(reduced);
  await quiet.goto(`${origin}/?intro=1`);
  await titlePhase(quiet);
  await quiet.waitForTimeout(400);
  assert.equal(
    await quiet.$eval(
      ".title-intro img",
      (img) => getComputedStyle(img).transform,
    ),
    "none",
  );
  await gone(quiet, 4500);
  await quiet.waitForSelector("#hand .card");
  await reduced.close();
  console.log(`Title intro smoke passed. Screenshots: ${shots.join(", ")}`);
} finally {
  await browser.close();
  server.close();
}
