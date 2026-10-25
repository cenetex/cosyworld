import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  createWorld,
  encodeSave,
  legalActions,
  play,
} from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
const output = new URL("../../output/image-first/", import.meta.url);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const report = [];
function action(world, kind, item, target) {
  const found = legalActions(world).find(
    (a) =>
      a.kind === kind &&
      (!item || a.item === item) &&
      (!target || a.target === target),
  );
  assert(found, `${kind} ${item} ${target}`);
  const result = play(world, found);
  assert(result.ok, result.error);
  return result.state;
}
function pond() {
  let s = enableMotives(createWorld({ opening: true }), {
    questPrograms: true,
    personalQuests: true,
  });
  s = action(s, "light", "lamp");
  s = action(s, "move", null, "pond");
  // Only stage initial possessions; exercise the real transition and save rules.
  s.items.cloth.holder = "vale";
  s.items.lamp.fuel = 12;
  s.items.lamp.lit = true;
  s.items.bell.holder = "station";
  s.actors.moth.place = "station";
  s.actors.keeper.place = "station";
  return s;
}
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
    [844, 390],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(10000);
    const errors = [],
      failed = [],
      requests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400 && r.url().includes("/assets/"))
        failed.push(r.url());
    });
    await page.route("**/card-game/text", async (route) => {
      const c = route.request().postDataJSON();
      requests.push(c);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          revision: c.revision,
          model: "image-first-fixture",
          entries: c.entities.map(({ id }) => ({
            id,
            text: "The water is still.",
          })),
        }),
      });
    });
    const key = `cosyworld.reflected-shore.v1.image-first-${width}`;
    await page.addInitScript(
      ({ key, save }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false, volume: 0 }),
        );
      },
      { key, save: encodeSave(pond()) },
    );
    const state = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    const card = (id) => page.locator(`#hand [data-card="${id}"]`);
    async function ready() {
      for (let i = 0; i < 150; i++) {
        if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
        await page.waitForTimeout(30);
      }
      throw Error("hand remained busy");
    }
    async function cards(...ids) {
      await ready();
      for (const id of ids) {
        await card(id).scrollIntoViewIfNeeded();
        await card(id).click();
      }
      await card(ids.at(-1)).click();
      await ready();
    }
    async function art() {
      await page.waitForFunction(() =>
        [...document.querySelectorAll("#hand img,#backdrop")].every(
          (i) => i.complete && i.naturalWidth > 0,
        ),
      );
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "viewport width",
      );
    }
    try {
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?table=image-first-${width}`,
      );
      await card("cloth").waitFor();
      await art();
      const old = await state();
      assert.equal(
        await page
          .locator(
            ".card .state,.card .caption,.card .kind,.inspiration-meter,#quest-guide,#hand-tip,#unveil-dialog,#turn",
          )
          .count(),
        0,
      );
      assert.equal(
        await page.locator(".card-options").count(),
        0,
        "actions hidden until selection",
      );
      assert.equal(
        requests.length,
        0,
        "quiet save load needs no generated commentary",
      );
      // Overflow arrows, wheel and keyboard remain discoverable without pair recipes.
      const hand = page.locator("#hand");
      const overflow = await hand.evaluate(
        (h) => h.scrollWidth > h.clientWidth + 1,
      );
      if (overflow) {
        await hand.evaluate((h) => (h.scrollLeft = 0));
        await page.locator("#hand-next").click();
        await page.waitForFunction(
          () => document.querySelector("#hand").scrollLeft > 0,
        );
        await hand.evaluate((h) => (h.scrollLeft = 0));
        const bounds = await hand.boundingBox();
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 30);
        await page.mouse.wheel(0, 180);
        await page.waitForFunction(
          () => document.querySelector("#hand").scrollLeft > 0,
        );
      }
      await card("cloth").scrollIntoViewIfNeeded();
      await card("cloth").click();
      await card("lamp").scrollIntoViewIfNeeded();
      await card("lamp").click();
      assert.equal(await card("lamp").getAttribute("aria-pressed"), "true");
      assert.equal(
        await page.locator(".card-primary").first().innerText(),
        "Cover",
      );
      assert.equal((await state()).turn, old.turn, "selection costs no turn");
      await page.keyboard.press("Escape");
      assert.equal(
        await page.locator(".card-options").count(),
        0,
        "cancel clears actions",
      );
      await hand.evaluate((h) => (h.scrollLeft = 0));
      await card("vale").focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(
        await page.evaluate(() => document.activeElement.dataset.card),
        "lamp",
      );
      await page.keyboard.press("Enter");
      assert.equal(await card("lamp").getAttribute("aria-pressed"), "true");
      await page.keyboard.press("Escape");
      const geometry = await card("lamp").evaluate((c) => ({
        card: c.getBoundingClientRect().height,
        art: c.querySelector(".art").getBoundingClientRect().height,
      }));
      assert(geometry.art / geometry.card > 0.9, JSON.stringify(geometry));
      await cards("cloth", "lamp");
      assert.equal((await state()).locations.pond.shipSignal, 1);
      assert.equal(await card("lamp").getAttribute("data-covered"), "true");
      assert.equal(await card("greek-harbor").count(), 0);
      await cards("cloth");
      assert.equal((await state()).locations.pond.shipSignal, 2);
      assert.equal(await card("greek-harbor").count(), 0);
      assert.doesNotMatch(
        await page.locator("body").innerText(),
        /inspiration|[12] of two|first flash|once more|ritual|fuel|turns left|ring again/i,
      );
      assert.doesNotMatch(
        await page.locator("#backdrop").getAttribute("alt"),
        /flash|signal|twice|cover/i,
      );
      assert.equal(requests.length, 0, "cloth manipulations remain silent");
      await page.reload();
      await card("cloth").waitFor();
      assert.equal(
        (await state()).locations.pond.shipSignal,
        2,
        "halfway save restored",
      );
      await cards("cloth", "lamp");
      await cards("cloth");
      assert.equal((await state()).locations.pond.shipSignal, 4);
      await card("greek-harbor").waitFor();
      await art();
      assert.equal(
        await page.locator("#backdrop").getAttribute("data-location-variant"),
        "greek-ship",
      );
      assert.equal(
        await page.locator("dialog[open]").count(),
        0,
        "ship discovery does not open a modal",
      );
      await card("greek-harbor").scrollIntoViewIfNeeded();
      await card("greek-harbor").click();
      await art();
      await page.screenshot({
        path: new URL(`pond-${width}.png`, output).pathname,
        fullPage: true,
      });
      const buttons = await page
        .locator(".card-options button")
        .evaluateAll((bs) =>
          bs.map((b) => ({
            w: b.getBoundingClientRect().width,
            h: b.getBoundingClientRect().height,
          })),
        );
      assert(
        buttons.every((b) => b.w >= 40 && b.h >= 44),
        "touch targets",
      );
      await page.keyboard.press("Escape");
      await page.locator("#menu-button").click();
      assert.doesNotMatch(
        await page.locator("#menu-dialog").innerText(),
        /inspiration|ring.*twice|cloth.*lamp|ritual|milestones|quest|points/i,
      );
      await page.locator('[data-close="menu-dialog"]').click();
      await card("greek-harbor").click();
      await page.locator(".card-primary").click();
      await ready();
      assert.equal((await state()).actors.vale.place, "greek-harbor");
      assert.equal((await state()).items.lamp.holder, "vale");
      await cards("greek-courtyard");
      await art();
      await page.locator("#history-button").click();
      assert.match(
        await page.locator("#messages").innerText(),
        /The water is still/,
      );
      assert.doesNotMatch(
        await page.locator("#messages").innerText(),
        /Turn \d|first flash|ritual progress/,
      );
      await page.locator('[data-close="history-dialog"]').click();
      await ready();
      await page.screenshot({
        path: new URL(`courtyard-${width}.png`, output).pathname,
        fullPage: true,
      });
      await page.reload();
      await card("greek-baker").waitFor();
      await ready();
      assert.equal((await state()).actors.vale.place, "greek-courtyard");
      const beforeDrag = await state();
      await card("cloth").scrollIntoViewIfNeeded();
      await card("cloth").dragTo(card("lamp"));
      assert.equal(
        (await state()).turn,
        beforeDrag.turn,
        "pairing by drag is selection only",
      );
      assert.equal(await card("lamp").getAttribute("aria-pressed"), "true");
      await card("lamp").dragTo(page.locator("#stage"), {
        targetPosition: { x: width / 2, y: 110 },
      });
      await ready();
      assert.equal(
        (await state()).items.cloth.holder,
        "lamp",
        "dragged pair resolves once",
      );
      assert.equal((await state()).turn, beforeDrag.turn + 1);
      assert.deepEqual(errors, []);
      assert.deepEqual(failed, []);
      report.push({
        width,
        height,
        artFraction: geometry.art / geometry.card,
        errors,
        failed,
        ritual: "four actions, silent; reload; ship and boarding agree",
        navigation:
          "overflow, wheel, keyboard, cancel, selection, boarding, travel, reload",
      });
    } catch (error) {
      await page.screenshot({
        path: new URL(`failure-${width}.png`, output).pathname,
        fullPage: true,
      });
      console.error({ width, errors, failed });
      throw error;
    } finally {
      await page.close();
    }
  }
  await writeFile(
    new URL("report.json", output),
    JSON.stringify(report, null, 2),
  );
  console.log("Image-first cards: desktop, phone and short landscape passed.");
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
