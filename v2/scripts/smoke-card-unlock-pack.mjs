import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { profiles } from "../card-game/memory.mjs";
import { readyActionButton, selectCard, settleHand, visibleSpot } from "./card-browser-helpers.mjs";

const shots = process.env.COSYWORLD_HAND_SHOTS;
const fixture = enableMotives(createWorld());
fixture.actors.vale.place = "greek-ship";
fixture.crossings["pond-greek-harbor"].discovered = true;
for (const id of ["lamp", "cloth"]) fixture.items[id].holder = "pond";
fixture.items["greek-provisions"].holder = "vale";
fixture.usedUp = (fixture.usedUp || []).filter((id) => id !== "greek-provisions");
const save = encodeSave(fixture);
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const table = `unlock-pack-${width}`,
      key = `cosyworld.reflected-shore.v1.${table}`;
    await page.addInitScript(
      ({ key, save, seen }) => {
        if (localStorage.getItem(key)) return;
        localStorage.setItem(key, save);
        localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
        localStorage.setItem(`${key}.seen.covered`, JSON.stringify(["greek-piraeus"]));
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem("cosyworld.room-music", JSON.stringify({ enabled: false }));
      },
      { key, save, seen: Object.keys(profiles) },
    );
    await page.route("**/card-game/text", async (route) => {
      const input = route.request().postDataJSON();
      await route.fulfill({
        json: {
          revision: input.revision,
          model: "unlock-fixture",
          entries: input.entities.map(({ id }) => ({ id, text: "The deck creaks." })),
        },
      });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/?table=${table}`);
    const port = page.locator('#hand [data-card="greek-piraeus"]');
    await port.waitFor({ state: "attached" });
    assert.equal(await port.getAttribute("data-locked"), "true");
    await page.evaluate(() => {
      window.turns = 0;
      new MutationObserver((changes) => {
        for (const change of changes) if (change.target.dataset.revealing) window.turns++;
      }).observe(document.querySelector("#hand"), { subtree: true, attributeFilter: ["data-revealing"] });
    });
    await selectCard(page, "greek-provisions");
    await selectCard(page, "greek-ship");
    const drop = page.locator('#card-actions [data-action="drop"]');
    if ((await drop.getAttribute("data-revealing")) === "true") await drop.click();
    await readyActionButton(page, "drop").click();
    await page.waitForFunction(
      (key) => JSON.parse(localStorage.getItem(key)).items["greek-provisions"].holder === "greek-ship",
      key,
    );
    await page.waitForFunction(() => document.querySelector('#hand .card-frame[data-pack="closed"]'));
    await settleHand(page);
    assert.equal(await page.locator("#play-status").isHidden(), true, "no status line repeats the pack");
    if (shots) await page.screenshot({ path: `${shots}/unlock-kept-choice-${width}.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);
    const packed = await page.locator('#hand .card-frame[data-pack="closed"]').count();
    assert.equal(
      (await page.locator('#card-actions [data-pack="reveal"]').count()) > 0,
      packed > 3,
      `Reveal all is offered only over three cards (${packed} here)`,
    );
    assert.equal(await port.getAttribute("data-unrevealed"), "true", "an unlocked card waits face down");
    assert.equal(await page.evaluate(() => window.turns), 0, "nothing turns before a tap");
    if (shots) await page.screenshot({ path: `${shots}/unlock-notice-${width}.png` });
    const stack = page.locator('#hand .card-frame[data-pack="closed"]:not([hidden]) > .card');
    await stack.first().click({ position: await visibleSpot(stack.first()) });
    await page.locator('#hand [data-pack="open"]').first().waitFor();
    await page.waitForTimeout(900);
    await port.click({ position: await visibleSpot(port) });
    await page.locator('#card-actions [data-open-box="greek-piraeus"]').click();
    await page.waitForFunction(
      () => document.querySelector('#hand [data-card="greek-piraeus"]')?.dataset.unrevealed === "false",
    );
    assert.equal(await page.evaluate(() => window.turns), 1, "the tap turns the card once");
    await page.waitForTimeout(400);
    if (shots) await page.screenshot({ path: `${shots}/unlock-reveal-${width}.png` });
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`Unlocked cards wait for a tap: ${width}px passed.`);
  }
} finally {
  await browser.close();
  server.close();
}
