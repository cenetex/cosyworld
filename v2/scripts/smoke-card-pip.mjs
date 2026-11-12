import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createLandingWorld } from "../card-game/pack-landing.mjs";
import { decodeSave, encodeSave } from "../card-game/world.mjs";
import { SAVE_BASE, PLAYING_KEY } from "../card-game/avatar-world.mjs";

// A stranger's whole first quest (rules 134), waiting on what is on screen and
// never on a count of turns: the box, Pip, Talk (his quest is held as it ends,
// nothing to accept), the fade to the opening once his words are heard, with
// that same quest, the opening's boxes, the pond, then the Lamp given to Pip.
// The text service is down, so every line is "…".
async function walkToGivenLamp(browser, base) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: "reduce" });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/card-game/text", (route) => route.fulfill({ status: 503, body: "Unavailable" }));
  const { choose, buttonReads, press, button } = helpers(page);
  await page.goto(`${base}/pip?c=PIP-TEST-0001`);
  // Behind the box the table is out of reach, and the tab is named for the game.
  assert.equal(await page.title(), "Lonely Forest");
  assert.equal(await page.evaluate(() => document.body.inert), true);
  await page.locator('.title-intro[data-phase="card"] .card').click();
  await page.locator(".title-intro").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => document.body.inert), false);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.card), "moth");
  await page.locator('#card-actions [data-action="talk"]').click();
  // Pip's quest is held as Talk ends: no offer card, no Accept quest. The
  // landing fades to the opening once his words are heard.
  await page.waitForFunction((k) => JSON.parse(localStorage.getItem(k)).actors.vale.want?.from === "quest:from:moth", key, { timeout: 4000 });
  assert.equal(await page.locator('#hand [data-card^="quest:"]').count(), 0, "no quest offer card lies in the hand");
  await page.locator('.title-intro[data-phase="ack"]').waitFor({ timeout: 8000 });
  // The land acknowledgement and the logo, then the opening itself: no second box.
  let secondBox = false;
  while (await page.locator(".title-intro").count()) {
    if (await page.locator('.title-intro[data-phase="card"]').count()) secondBox = true;
    await page.mouse.click(195, 300);
    await page.waitForTimeout(250);
  }
  assert.equal(secondBox, false, "a scanner is not asked to open a second box");
  await page.locator('#hand [data-card="vale"]').waitFor();
  const carried = decodeSave(await page.evaluate((key) => localStorage.getItem(key), key));
  assert.equal(carried.actors.vale.place, "attic");
  assert.deepEqual(carried.actors.vale.want?.step, { verb: "give", to: "moth" });
  // The opening: open the attic, turn over the lamp. Nothing is left chosen
  // that has no button.
  await choose("attic");
  await buttonReads(/closed box/iu);
  await button.first().click();
  await buttonReads(/turn over the next card/iu);
  await button.first().click();
  await page.waitForFunction(() => document.querySelector('#hand [data-card="attic"]')?.getAttribute("aria-pressed") === "true" && document.querySelector("#card-actions button"));
  assert.equal(await page.locator('#hand [data-card="lamp"][aria-pressed="true"]').count(), 0, "the lamp is not left chosen");
  // Put the lamp out: choose Vale to show it, raise it, lower it.
  await choose("vale");
  await choose("lamp");
  await page.locator('#hand [data-card="lamp"]').click();
  await page.waitForFunction(() => document.querySelector('#hand [data-card="lamp"]')?.dataset.lit === "false");
  await choose("pond");
  await buttonReads(/goes to Black pond/iu);
  await press(() => page.waitForFunction(() => document.getElementById("place-title")?.textContent === "Black pond", null, { timeout: 2500 }));
  // The quest she holds is Pip's own: no second offer lies at the pond.
  assert.equal(await page.locator('#hand [data-card="quest:from:moth"]').count(), 0);
  await choose("vale");
  await choose("lamp");
  await choose("moth");
  await buttonReads(/gives the Lamp to Pip/iu);
  await button.first().click();
  // The level-up quest is held as the experience reaches it.
  await page.waitForFunction((k) => JSON.parse(localStorage.getItem(k)).actors.vale.want?.from === "quest:level", key, { timeout: 8000 });
  const saved = decodeSave(await page.evaluate((key) => localStorage.getItem(key), key));
  assert.equal(saved.items.lamp.holder, "moth");
  assert.equal(saved.actors.vale.want.quest.level, 2);
  assert.equal(saved.actors.vale.under, undefined);
  assert.equal(saved.actors.vale.place, "pond");
  assert.deepEqual(errors, []);
  console.log("Pip first quest: box, Talk, held quest, fade, opening, pond and Give passed.");
  await page.close();
}
// Choosing and pressing, waiting on what the screen shows. A press soon after
// a box opens is held back by the table, so press again until it has moved on.
function helpers(page) {
  const button = page.locator("#card-actions button");
  const label = async () => (await button.first().textContent()).trim();
  const choose = async (id) => {
    const target = page.locator(`#hand [data-card="${id}"]`);
    for (let tries = 0; tries < 4; tries++) {
      await target.click();
      if (await page.waitForFunction((cardId) => document.querySelector(`#hand [data-card="${cardId}"]`)?.getAttribute("aria-pressed") === "true", id, { timeout: 1500 }).then(() => true, () => false)) return;
    }
    throw new Error(`card ${id} never became the chosen card`);
  };
  const buttonReads = (pattern) => page.waitForFunction(([source, flags]) => new RegExp(source, flags).test(document.querySelector("#card-actions button")?.textContent ?? ""), [pattern.source, pattern.flags]);
  const press = async (settled) => {
    for (let tries = 0; tries < 4; tries++) {
      await button.first().click();
      if (await settled().then(() => true, () => false)) return;
    }
    throw new Error(`the button "${await label()}" never took effect`);
  };
  return { choose, buttonReads, press, button };
}
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
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 700, reducedMotion: width === 320 ? "reduce" : "no-preference" });
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
    if (width === 320) {
      await page.locator('.title-reveal[data-idle="hint"]').waitFor();
      assert.equal(await page.locator(".title-hint").textContent(), "open it");
      const hint = await page.locator(".title-hint").boundingBox();
      assert(hint.y > 16 && hint.y + hint.height <= height);
    }
    await page.screenshot({ path: new URL(`box-${width}.png`, output).pathname });
    await box.click();
    await page.locator(".title-intro").waitFor({ state: "detached" });
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
    const pip = await page.locator('#cast [data-avatar="moth"]').boundingBox();
    assert(pip.width > 80 && pip.x >= 0 && pip.x + pip.width <= width);
    await page.screenshot({ path: new URL(`pip-${width}.png`, output).pathname });
    await talk.click();
    // Talk holds Pip's quest as it ends: no offer card, nothing to accept.
    await page.waitForFunction((k) => JSON.parse(localStorage.getItem(k)).actors.vale.want?.from === "quest:from:moth", key, { timeout: 4000 });
    assert.equal(await page.locator('#hand [data-card^="quest:"]').count(), 0);
    // Closed during the fade: the page returns to the fade, not to Pip.
    await page.reload();
    await page.locator('.title-intro[data-phase="ack"]').waitFor();
    await page.keyboard.press("Escape");
    await page.locator(".title-intro").waitFor({ state: "detached" });
    const journey = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    assert.equal(journey.actors.vale.place, "attic");
    // Pip's Talk is the rules' own: Vale carries what he told her and the quest
    // she accepted from him, the same one the pond would have offered.
    assert.deepEqual(journey.actors.vale.heard, { moth: "item:lamp" });
    assert.deepEqual(journey.actors.vale.want?.step, { verb: "give", to: "moth" });
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
  const other = await browser.newPage();
  await other.goto(`${base}/pip`);
  await other.locator('.title-intro[data-phase="card"] .card').click();
  await other.locator(".title-intro").waitFor({ state: "detached" });
  await other.locator('#card-actions [data-action="talk"]').click();
  await other.locator(".page-fade").waitFor({ timeout: 8000 });
  await other.evaluate(({ key, save }) => {
    localStorage.setItem(key, save);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: save }));
  }, { key, save });
  await other.locator(".page-fade").waitFor({ state: "detached" });
  assert.equal(await other.evaluate((key) => localStorage.getItem(key), key), save);
  assert.equal(await other.locator(".title-intro").count(), 0);
  await other.close();
  await walkToGivenLamp(browser, base);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Blocked", "SecurityError"); } }));
  await page.goto(`${base}/pip`);
  await page.locator('.title-intro[data-phase="card"] .card').click();
  await page.locator(".title-intro").waitFor({ state: "detached" });
  await page.locator('#card-actions [data-action="talk"]').click();
  await page.locator(".page-fade").waitFor({ timeout: 8000 });
  console.log("Pip arrival: routes, black stage, Talk, Vale intro, reload, quest, save isolation and blocked storage passed.");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
