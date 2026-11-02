import { selectCard, revealCard } from "./card-browser-helpers.mjs";
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
  let s = enableMotives(createWorld({ opening: true }));
  // Keep the bard at this fixture's first deed so the ship starts at harbor.
  // The separate bard smoke covers his fresh-harbor voyage.
  s.actors["greek-rhapsode"].place = "attic";
  // The opening starts lit; dousing the lamp opens the mirror (#1653).
  s = action(s, "snuff", "lamp");
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
      hasTouch: width === 390,
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
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
        await page.waitForTimeout(30);
      }
      const waiting = await page.evaluate(() => ({
        cooling: document.querySelector("#hand").dataset.cooling,
        speaker: document.querySelector("#speaker-name")?.textContent,
        text: document.querySelector("#dialogue-text").textContent,
      }));
      throw Error(`hand remained busy: ${JSON.stringify(waiting)}`);
    }
    async function cards(...ids) {
      await ready();
      for (const id of ids) {
        await selectCard(page, id);
      }
      await page.locator("#card-actions .card-primary").click();
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
      await card("cloth").waitFor({ state: "attached" });
      await art();
      const old = await state();
      assert.equal(
        await page
          .locator(
            ".card .state,.card .caption,.card .kind,.inspiration-meter,#quest-guide,#hand-tip,#turn",
          )
          .count(),
        0,
      );
      assert.equal(
        await page.locator("#card-actions button").count(),
        0,
        "actions hidden until selection",
      );
      assert.equal(
        requests.length,
        0,
        "quiet save load needs no generated commentary",
      );
      // The wheel reaches overflow cards; arrow keys follow card focus.
      const hand = page.locator("#hand");
      const overflow = await hand.evaluate(
        (h) => h.scrollWidth > h.clientWidth + 1,
      );
      const fade = () => hand.evaluate((h) => h.dataset.fade ?? "");
      assert.equal(await page.locator(".hand-scroll").count(), 0, "no arrows");
      if (overflow) {
        await hand.evaluate((h) => (h.scrollLeft = 0));
        await page.waitForFunction(
          () => document.querySelector("#hand").dataset.fade === "end",
        );
        const bounds = await hand.boundingBox();
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 30);
        await page.mouse.wheel(0, 180);
        await page.waitForFunction(
          () => document.querySelector("#hand").scrollLeft > 0,
        );
        // A sideways wheel or trackpad swipe also scrolls the hand.
        await hand.evaluate((h) => (h.scrollLeft = 0));
        await page.mouse.wheel(120, 0);
        await page.waitForFunction(
          () => document.querySelector("#hand").scrollLeft > 0,
        );
        // Only the edges that hide more cards fade.
        await hand.evaluate((h) => (h.scrollLeft = h.scrollWidth));
        await page.waitForFunction(
          () => document.querySelector("#hand").dataset.fade === "start",
        );
        await hand.evaluate((h) => (h.scrollLeft = 0));
      } else assert.equal(await fade(), "", "a hand that fits has no fade");
      const tapCard = async (id) => {
        await selectCard(page, id, { touch: width === 390 });
      };
      const heldPreview = page.locator(
        '[data-avatar="vale"] .portrait-held-item',
      );
      async function assertHeldItem(id) {
        // With no card raised, Vale holds up the lit lamp he carries.
        id ??= "lamp";
        assert.equal(await heldPreview.getAttribute("data-item"), id);
        assert.equal(await page.locator(".portrait-held-item").count(), 1);
        await heldPreview
          .locator("img")
          .first()
          .evaluate((img) => img.decode());
        const bounds = await heldPreview.boundingBox();
        const body = await heldPreview.locator("..").boundingBox();
        assert(
          bounds.width > 20 && bounds.height > 20,
          "held item stays readable",
        );
        assert(
          bounds.x >= 0 && bounds.x + bounds.width <= width,
          "held item fits the screen",
        );
        assert(
          bounds.y >= 0 && bounds.y + bounds.height <= body.y + body.height,
          "held item follows the figure",
        );
      }
      await assertHeldItem(null);
      // Either member of a pair can be lowered, with or without a play.
      for (const ids of [
        ["vale", "cloth"],
        ["cloth", "lamp"],
      ]) {
        for (const lowered of ids) {
          for (const id of ids) await tapCard(id);
          await assertHeldItem(ids.at(-1));
          const scene = page.locator("#stage");
          const outside = { position: { x: 20, y: 80 } };
          if (width === 390) await scene.tap(outside);
          else await scene.click(outside);
          await assertHeldItem(ids.at(-1));
          for (const id of ids)
            assert.equal(
              await card(id).getAttribute("aria-pressed"),
              "true",
              "clicking the scene keeps the carried item selected",
            );
          assert.equal(
            await page.locator(".card-primary").count(),
            ids[0] === "vale" ? 0 : 1,
          );
          // The first tap raises the folded hand as it was; the next lowers.
          await tapCard(lowered);
          assert.equal(
            await card(lowered).getAttribute("aria-pressed"),
            "true",
          );
          await tapCard(lowered);
          assert.equal(
            await card(lowered).getAttribute("aria-pressed"),
            "false",
          );
          const remaining = ids.find((id) => id !== lowered);
          await assertHeldItem(remaining === "vale" ? null : remaining);
          assert.equal(
            await card(remaining).getAttribute("aria-pressed"),
            "true",
          );
          await tapCard(remaining);
          await assertHeldItem(null);
          assert.equal(
            await card(remaining).getAttribute("aria-pressed"),
            "false",
          );
          assert.equal(await page.locator("#card-actions button").count(), 0);
          assert.deepEqual(
            await state(),
            old,
            "card taps preserve the saved world",
          );
          assert.equal(requests.length, 0);
        }
      }

      await selectCard(page, "cloth");

      await selectCard(page, "lamp");
      assert.equal(await card("lamp").getAttribute("aria-pressed"), "true");
      assert.equal(
        await page.locator(".card-primary").first().innerText(),
        "Cover",
      );
      assert.equal((await state()).turn, old.turn, "selection costs no turn");
      await assertHeldItem("lamp");
      assert.equal(await heldPreview.getAttribute("data-lit"), "true");
      await page.screenshot({
        path: new URL(`held-item-${width}.png`, output).pathname,
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await assertHeldItem(null);
      assert.equal(
        await page.locator("#card-actions button").count(),
        0,
        "cancel clears actions",
      );
      await hand.evaluate((h) => (h.scrollLeft = 0));
      await revealCard(page, "lamp");
      await card("vale").focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(
        await page.evaluate(() => document.activeElement.dataset.card),
        "lamp",
      );
      await page.keyboard.press("Enter");
      assert.equal(await card("lamp").getAttribute("aria-pressed"), "true");
      await assertHeldItem("lamp");
      await page.keyboard.press("Enter");
      assert.equal(await card("lamp").getAttribute("aria-pressed"), "false");
      await assertHeldItem(null);
      await page.keyboard.press("Space");
      assert.equal(await card("lamp").getAttribute("aria-pressed"), "true");
      await page.keyboard.press("Space");
      assert.equal(await card("lamp").getAttribute("aria-pressed"), "false");
      assert.deepEqual(await state(), old);
      await page.keyboard.press("Escape");
      await revealCard(page, "lamp");
      const geometry = await card("lamp").evaluate((c) => ({
        card: c.getBoundingClientRect().height,
        art: c.querySelector(".art").getBoundingClientRect().height,
      }));
      assert(geometry.art / geometry.card > 0.9, JSON.stringify(geometry));
      await page.keyboard.press("Escape");
      await cards("cloth", "lamp");
      // Covering keeps both items in hand, so the covered lamp stays raised.
      assert.equal((await state()).crossings["pond-greek-harbor"].phase, 1);
      assert.equal(await card("lamp").getAttribute("data-covered"), "true");
      await assertHeldItem("lamp");
      assert.equal(await heldPreview.getAttribute("data-covered"), "true");
      assert.equal(await heldPreview.locator(".object-cover").count(), 1);
      await page.keyboard.press("Escape");
      assert.equal(
        await card("greek-ship").count(),
        (await state()).transports["greek-ship"].dock === "pond" ? 1 : 0,
      );
      await cards("cloth");
      // One cover and one uncover of the lit lamp call the ship.
      assert.equal((await state()).crossings["pond-greek-harbor"].phase, 2);
      assert.equal(await card("greek-ship").count(), 1);
      assert.doesNotMatch(
        await page.locator("body").innerText(),
        /inspiration|[12] of two|first flash|once more|ritual|fuel|turns left|ring again/i,
      );
      assert.doesNotMatch(
        await page.locator("#backdrop").getAttribute("alt"),
        /flash|signal|twice|cover/i,
      );
      assert.equal(
        requests.length,
        2,
        "each cloth play receives a spoken reaction",
      );
      assert(requests.every((request) => request.speakers[0] === "vale"));
      await page.reload();
      await card("cloth").waitFor({ state: "attached" });
      await assertHeldItem(null);
      assert.equal(
        (await state()).crossings["pond-greek-harbor"].phase,
        2,
        "summoned save restored",
      );
      await card("greek-ship").waitFor({ state: "attached" });
      await art();
      assert.equal(
        await page.locator("#backdrop").getAttribute("data-location-variant"),
        "pond-greek-harbor",
      );
      assert.equal(
        await page.locator("dialog[open]").count(),
        0,
        "ship discovery does not open a modal",
      );

      await selectCard(page, "greek-ship");
      await art();
      await page.screenshot({
        path: new URL(`pond-${width}.png`, output).pathname,
        fullPage: true,
      });
      const buttons = await page
        .locator("#card-actions button")
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
      await page.locator("#toolbar-menu-button").click();
      await page.locator("#menu-button").click();
      assert.doesNotMatch(
        await page.locator("#menu-dialog").innerText(),
        /inspiration|ring.*twice|cloth.*lamp|ritual|milestones|quest|points/i,
      );
      await page.locator('[data-close="menu-dialog"]').click();
      await selectCard(page, "greek-ship");
      await page.locator(".card-primary").click();
      await ready();
      assert.equal((await state()).actors.vale.place, "greek-ship");
      assert.equal(await card("pond").count(), 0);
      // The harbor card sets the course; a round at sea, then Disembark.
      await cards("greek-harbor");
      assert.equal((await state()).transports["greek-ship"].phase, "sea");
      await cards("vale");
      await cards("greek-harbor");
      assert.equal((await state()).actors.vale.place, "greek-harbor");
      assert.equal((await state()).items.lamp.holder, "vale");
      // The Theban Harbor Road climbs from the harbor to the courtyard.
      await cards("greek-road-thebes");
      await cards("greek-courtyard");
      await art();
      await page.locator("#toolbar-menu-button").click();
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
      await card("greek-baker").waitFor({ state: "attached" });
      await ready();
      assert.equal((await state()).actors.vale.place, "greek-courtyard");
      const beforeDrag = await state();

      await revealCard(page, "cloth");
      await card("cloth").dragTo(card("lamp"));
      assert.equal(
        (await state()).turn,
        beforeDrag.turn,
        "pairing by drag is selection only",
      );
      assert.equal(await card("lamp").getAttribute("aria-pressed"), "true");
      await assertHeldItem("lamp");
      // The dialogue lies over the stage as its sibling and takes drops too,
      // so the drop may land on it.
      await card("lamp").dragTo(page.locator("#stage"), {
        targetPosition: { x: width / 2, y: 110 },
        force: true,
      });
      await ready();
      // Both items stay in Vale's hands, so the lamp stays held.
      await assertHeldItem("lamp");
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
        ritual: "four spoken actions; reload; ship and boarding agree",
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
