import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { readyActionButton, selectCard, visibleSpot } from "./card-browser-helpers.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const button = (page, kind) =>
  page.locator(`#card-actions [data-pack="${kind}"]`);
const saved = (page) =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("cosyworld.reflected-shore.v1")),
  );
try {
  for (const voice of ["missing", "silent"]) {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      hasTouch: true,
      isMobile: true,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/meta", (route) => route.fulfill({ status: 404 }));
    await page.route("**/card-game/text", (route) =>
      voice === "missing" ? route.fulfill({ status: 404 }) : undefined,
    );
    await page.goto(`${origin}/?intro=1`);
    await page.waitForSelector('.title-intro[data-phase="ack"]');
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () =>
        document.querySelector('#hand [data-card="vale"]')?.dataset
          .unrevealed === "false",
    );
    await page.waitForSelector(".title-intro", { state: "detached" });
    assert.equal(
      await page.locator('#hand [data-card="lamp"]').getAttribute("aria-pressed"),
      "false",
      "no face-down card starts chosen",
    );
    await button(page, "reveal").waitFor();
    const stack = page.locator(
      '#hand > .card-frame[data-pack="closed"]:not([hidden]) > .card',
    );
    await stack.first().tap({ position: await visibleSpot(stack.first()) });
    await page.locator('#hand [data-pack="open"]').first().waitFor();
    assert.equal(await button(page, "reveal").count(), 0, "a raised hand dismisses Reveal all");
    if (voice === "missing") {
      for (;;) {
        const id = await page.evaluate(
          () => document.querySelector('#hand [data-unrevealed="true"]')?.dataset.card,
        );
        if (!id) break;
        const card = page.locator(`#hand [data-card="${id}"]`);
        if (!(await page.locator('#hand [data-pack="open"]').count()) &&
          (await stack.count()))
          await stack.first().tap({ position: await visibleSpot(stack.first()) });
        await card.tap({ position: await visibleSpot(card) });
        await page.locator(`#card-actions [data-open-box="${id}"]`).tap();
        await page.waitForFunction(
          (id) => !document.querySelector(`#hand [data-card="${id}"]`)?.dataset.revealing,
          id,
        );
      }
    } else {
      await page.keyboard.press("Escape");
      await page.mouse.move(2, 2);
      await button(page, "reveal").tap();
      await button(page, "done").tap();
    }
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => !document.querySelector('#hand [data-unrevealed="true"]'),
    );
    const pond = page.locator('#hand [data-card="pond"]');
    assert.equal(await pond.getAttribute("data-locked"), "true");
    for (let tries = 0; tries < 4; tries++) {
      if ((await saved(page)).items.lamp.lit === false) break;
      await selectCard(page, "lamp", { touch: true });
      await page.waitForTimeout(300);
    }
    await page.waitForFunction(
      () =>
        document.querySelector('#hand [data-card="pond"]')?.dataset.locked ===
          "false" && !document.querySelector("#hand [data-revealing]"),
    );
    assert.equal((await saved(page)).items.lamp.lit, false);
    await selectCard(page, "pond", { touch: true });
    await readyActionButton(page, "move").tap();
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("cosyworld.reflected-shore.v1"))
          .actors.vale.place === "pond",
    );
    const world = await saved(page);
    assert.deepEqual(world.opened, { pond: ["vale"] });
    assert.equal(world.turn, 1);
    assert.deepEqual(errors, []);
    console.log(`Opening plays on a phone with the voice ${voice}.`);
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
