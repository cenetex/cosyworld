import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createLandingWorld } from "../card-game/pack-landing.mjs";
import { encodeSave } from "../card-game/world.mjs";
import { SAVE_BASE, PLAYING_KEY } from "../card-game/avatar-world.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const output = new URL("../../output/card-pip/", import.meta.url);
await mkdir(output, { recursive: true });
const key = `${SAVE_BASE}.entry.pip`;
const save = encodeSave(createLandingWorld(null, 17));
try {
  for (const path of ["/pip", "/pip/"])
    for (const method of ["GET", "HEAD"])
      assert.equal((await fetch(`${base}${path}`, { method })).status, 200);
  for (const [width, height] of [[1440, 900], [390, 844], [320, 568]]) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 700 });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/card-game/text", (route) => route.fulfill({ status: 503, body: "Unavailable" }));
    await page.addInitScript(({ baseKey, playing, save }) => {
      if (!localStorage.getItem(baseKey)) {
        localStorage.setItem(baseKey, save);
        localStorage.setItem(`${baseKey}.night`, save);
        localStorage.setItem(playing, JSON.stringify({ avatar: "mara", world: "existing-world" }));
      }
    }, { baseKey: SAVE_BASE, playing: PLAYING_KEY, save });
    await page.goto(`${base}/pip`);
    const talk = page.locator('#card-actions [data-action="talk"]');
    const box = page.locator('.title-intro[data-phase="card"] .card');
    await box.waitFor();
    await page.screenshot({ path: new URL(`box-${width}.png`, output).pathname });
    await box.click();
    await page.locator(".title-intro").waitFor({ state: "detached" });
    console.log(await page.locator('#card-actions button').allTextContents());
    await page.screenshot({ path: new URL(`revealed-${width}.png`, output).pathname });
    await talk.waitFor();
    const initial = await page.evaluate((key) => localStorage.getItem(key), key);
    assert(initial, "arrival is saved before the first action");
    await page.reload();
    await talk.waitFor();
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), key), initial);
    assert.equal(await page.locator(".title-intro").count(), 0);
    assert.equal(await page.locator("#stage").getAttribute("data-place-covered"), "true");
    assert.equal(await page.locator(".play-dock").isVisible(), true);
    assert.deepEqual(await page.locator("#hand .card[data-card]").evaluateAll((cards) => cards.map((card) => card.dataset.card)), ["moth"]);
    console.log(`Pip visible at ${width}`);
    await page.locator('#cast [data-avatar="moth"] img').evaluate(async (img) => img.decode());
    await page.waitForTimeout(1200);
    console.log(await page.locator('#cast [data-avatar="moth"]').evaluate((el) => ({ box: el.getBoundingClientRect().toJSON(), style: el.getAttribute("style") })));
    await page.screenshot({ path: new URL(`pip-${width}.png`, output).pathname });
    await talk.click();
    await page.locator(".page-fade").waitFor();
    await page.locator(".title-intro").waitFor();
    await page.keyboard.press("Escape");
    await page.locator(".title-intro").waitFor({ state: "detached" });
    const journey = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    assert.equal(journey.actors.vale.place, "attic");
    assert.equal(journey.actors.vale.want.step.to, "moth");
    assert.equal(journey.actors.vale.want.story, true);
    await page.reload();
    await page.locator('#hand [data-card="vale"]').waitFor();
    assert.equal(await talk.count(), 0);
    assert.equal(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).run.seed, key), journey.run.seed);
    console.log(`Pip quest and Vale intro passed at ${width}`);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), SAVE_BASE), save);
    assert.equal(await page.evaluate((key) => localStorage.getItem(`${key}.night`), SAVE_BASE), save);
    assert.equal(JSON.parse(await page.evaluate((key) => localStorage.getItem(key), PLAYING_KEY)).world, "existing-world");
    assert.deepEqual(errors, []);
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Blocked", "SecurityError"); } }));
  await page.goto(`${base}/pip`);
  await page.locator('.title-intro[data-phase="card"] .card').click();
  await page.locator(".title-intro").waitFor({ state: "detached" });
  await page.locator('#card-actions [data-action="talk"]').click();
  await page.locator(".title-intro").waitFor();
  console.log("Pip arrival: routes, black stage, Talk, Vale intro, reload, quest, save isolation and blocked storage passed.");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
