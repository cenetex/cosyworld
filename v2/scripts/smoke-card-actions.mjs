import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

const output = new URL("../../output/card-actions/", import.meta.url);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const meeting = () => {
  const s = createWorld();
  s.actors.moth.place = s.actors.keeper.place = "station";
  s.items.lamp.holder = "vale";
  return s;
};
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
    [320, 568],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
      hasTouch: width < 700,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const key = `cosyworld.reflected-shore.v1.actions-${width}`;
    await page.addInitScript(
      ({ key, save }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false, volume: 0 }),
        );
      },
      { key, save: encodeSave(meeting()) },
    );
    await page.route("**/card-game/text", async (route) => {
      const c = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          revision: c.revision,
          model: "actions-fixture",
          entries: c.entities.map(({ id }) => ({
            id,
            text: "Let us consider this.",
          })),
        }),
      });
    });
    const card = (id) => page.locator(`#hand [data-card="${id}"]`);
    const state = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    const ready = async () => {
      for (let i = 0; i < 200; i++) {
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
        if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        await page.waitForTimeout(40);
      }
      throw Error("Dialogue kept the hand busy");
    };
    const load = async (world) => {
      await page.evaluate(({ key, save }) => localStorage.setItem(key, save), {
        key,
        save: encodeSave(world),
      });
      await page.reload();
      await card("vale").waitFor();
      await ready();
    };
    const labels = () => page.locator("#card-actions button").allTextContents();
    const shot = async (name) => {
      await page.waitForFunction(() =>
        [...document.images].every(
          (image) => image.complete && image.naturalWidth > 0,
        ),
      );
      await page.screenshot({
        path: new URL(`${name}-${width}.png`, output).pathname,
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      const sizes = await page
        .locator("#card-actions button")
        .evaluateAll((buttons) =>
          buttons.map((b) => ({
            width: b.getBoundingClientRect().width,
            height: b.getBoundingClientRect().height,
          })),
        );
      assert(sizes.every((b) => b.height >= 44 && b.width <= width));
    };
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=actions-${width}`,
    );
    await card("vale").waitFor();
    await ready();
    const before = await state();
    assert.equal(await card("lamp").isVisible(), false);
    assert.equal(await card("cloth").isVisible(), false);
    assert.equal(await card("bell").isVisible(), true);
    assert.equal(await page.locator(".card-more").count(), 0);
    await shot("stacks");
    await selectCard(page, "moth", { touch: width < 700 });
    assert.deepEqual(await labels(), ["Talk"]);
    assert.equal(await card("cloth").isVisible(), true);
    const order = await page
      .locator("#hand .card")
      .evaluateAll((cards) => cards.map((c) => c.dataset.card));
    assert.equal(order[order.indexOf("moth") + 1], "cloth");
    await shot("pip-items");
    await selectCard(page, "moth");
    await selectCard(page, "cloth");
    assert.deepEqual(await labels(), ["Ask Pip for Black cloth"]);
    await selectCard(page, "lamp");
    assert.deepEqual(await labels(), ["Trade Lamp for Black cloth"]);
    assert.equal(await page.locator('.card[aria-pressed="true"]').count(), 2);
    assert.deepEqual(await state(), before);
    await shot("trade");
    await page.locator("#card-actions button").click();
    assert.equal(await card("vale").isDisabled(), true);
    await card("vale").dispatchEvent("click");
    assert.equal(await page.locator('.card[aria-pressed="true"]').count(), 0);
    await ready();
    assert.equal((await state()).turn, before.turn + 1);
    assert.equal((await state()).items.cloth.holder, "vale");
    assert.equal((await state()).items.lamp.holder, "moth");
    await selectCard(page, "vale");
    assert.equal(await card("cloth").isVisible(), true);
    assert.equal(await card("lamp").isVisible(), false);
    await load(meeting());
    await selectCard(page, "moth");
    await selectCard(page, "vale");
    assert.deepEqual(await labels(), ["Threaten Pip for Black cloth"]);
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.action),
      "threaten",
    );
    await shot("threat");
    await page.keyboard.press("Enter");
    await ready();
    assert.equal((await state()).standoffs.length, 1);
    await selectCard(page, "vale");
    await selectCard(page, "moth");
    assert.deepEqual(await labels(), ["Guard", "Attack"]);
    await shot("standoff");
    await page.getByRole("button", { name: "Guard", exact: true }).click();
    await ready();
    assert.equal((await state()).turn, 2);
    const story = createWorld();
    story.actors.vale.place = "greek-gate";
    story.crossings["pond-greek-harbor"].discovered = true;
    await load(story);
    await selectCard(page, "greek-guard");
    assert((await labels()).includes("Hear the burial order"));
    await shot("story");
    await page
      .getByRole("button", { name: "Hear the burial order", exact: true })
      .click();
    await ready();
    assert.equal((await state()).turn, 1);
    assert.deepEqual(errors, []);
    console.log(
      `Actions, item stacks, trade, standoff, story choices and keyboard passed at ${width}px.`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
