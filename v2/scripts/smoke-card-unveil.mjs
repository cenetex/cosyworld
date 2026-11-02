import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { revealCard, selectCard, stackHits } from "./card-browser-helpers.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const output = new URL("../../output/discovery/", import.meta.url);
await mkdir(output, { recursive: true });
const reports = [];
try {
  for (const [width, height, motion] of [
    [1440, 900, "no-preference"],
    [390, 844, "no-preference"],
    [1440, 900, "reduce"],
    [390, 844, "reduce"],
    [320, 568, "reduce"],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: motion,
    });
    page.setDefaultTimeout(20000);
    const errors = [],
      table = `unveil-${width}`,
      key = `cosyworld.reflected-shore.v1.${table}`;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("cosyworld.dialogue.sound", "off");
      localStorage.setItem(
        "cosyworld.room-music",
        JSON.stringify({ enabled: false }),
      );
      window.arrivals = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        if (
          this.matches?.("#hand .card") &&
          args[0][0]?.opacity === 0 &&
          !args[1].pseudoElement
        )
          window.arrivals.push(this.dataset.card);
        return animate.apply(this, args);
      };
    });
    await page.route("**/card-game/text", (route) => {
      const input = route.request().postDataJSON();
      if (motion === "reduce")
        return route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: "Story fixture unavailable." }),
        });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          revision: input.revision,
          model: "discovery-fixture",
          entries: input.entities.map(({ id }) => ({
            id,
            text: "There is time to look around.",
          })),
        }),
      });
    });
    const state = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    const ready = () =>
      page.waitForFunction(
        () => document.querySelector("#hand").dataset.cooling === "false",
      );
    const unveil = (id) =>
      page.waitForFunction(
        (id) =>
          document.querySelector(`#hand [data-card="${id}"]`)?.dataset
            .unrevealed === "true",
        id,
      );
    const finish = async () => {
      for (let i = 0; i < 300; i++) {
        if (await page.locator("#dialogue-advance").isVisible()) {
          // After a discovery the front card still takes real clicks.
          if ((await stackHits(page)).front === false) {
            await page.waitForTimeout(400);
            if ((await stackHits(page)).front === false)
              throw Error(`The front card missed a click at ${width}px`);
          }
          await page.locator("#dialogue-advance").click({ timeout: 3000 });
        }
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
        await page.waitForTimeout(50);
      }
      throw Error(`The exchange stayed busy at ${width}px (${motion})`);
    };
    const backdrop = () => page.locator("#backdrop").getAttribute("src");
    const stage = (source) =>
      page.evaluate(
        async (source) =>
          (await import("/card-game/images.mjs")).imageUrl(source),
        source,
      );
    try {
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?table=${table}`,
      );
      await ready();
      assert.equal((await state()).actors.vale.place, "attic");
      assert.equal((await state()).items.lamp.lit, true);
      // The lamplit attic shows only the room in the mirror (#1653).
      assert.equal(
        await backdrop(),
        await stage("./assets/attic/attic-lit.webp"),
      );
      // The opening hand starts covered; a first tap uncovers without selecting.
      const covered = () =>
        page.evaluate(() =>
          [...document.querySelectorAll('#hand [data-unrevealed="true"]')]
            .map((card) => card.dataset.card)
            .sort(),
        );
      const opening = ["attic", "lamp", "vale"];
      assert.deepEqual(await covered(), opening);
      await page.screenshot({
        path: new URL(`attic-start-${width}.png`, output).pathname,
      });
      const vale = page.locator('#hand [data-card="vale"]');
      await vale.click();
      assert.equal(await vale.getAttribute("data-unrevealed"), "false");
      assert.equal(await vale.getAttribute("aria-pressed"), "false");
      assert.deepEqual(await covered(), ["attic", "lamp"]);
      // A reload keeps the table known: nothing is covered again.
      await page.reload();
      await ready();
      assert.deepEqual(await covered(), ["attic", "lamp"]);
      await selectCard(page, "lamp");
      await page.locator("#card-actions .card-primary").click();
      await unveil("pond");
      await finish();
      assert.equal((await state()).actors.vale.place, "attic");
      // Dousing the lamp shows the Black Pond in the glass.
      assert.equal(
        await backdrop(),
        await stage("./assets/attic/attic-doused.webp"),
      );
      assert.equal(
        await page.locator('#hand [data-card="vale"]').isDisabled(),
        false,
      );
      const pond = page.locator('#hand [data-card="pond"]');
      // The pond stacks face down behind the attic (#1780): it adds an edge
      // to the location stack instead of arriving, and opening the stack
      // brings it into the hand.
      assert.equal(
        await pond.isVisible(),
        false,
        "the pond waits behind the attic",
      );
      await page
        .locator('#hand .card-frame[data-places="1"] > [data-card="attic"]')
        .waitFor();
      assert(
        !(await page.evaluate(() => window.arrivals.includes("pond"))),
        "a folded place does not arrive",
      );
      // The doused lamp stays in hand and offers Light until it is lowered.
      assert.equal(
        await page.locator('#card-actions [data-action="light"]').count(),
        1,
      );
      await (await revealCard(page, "attic")).click();
      await page
        .locator('#hand [data-card="attic"][aria-expanded="true"]')
        .waitFor();
      const pressed = () =>
        page.evaluate(() =>
          [
            ...document.querySelectorAll('#hand .card[aria-pressed="true"]'),
          ].map((card) => card.dataset.card),
        );
      const held = await pressed();
      assert(held.includes("lamp"), "opening the stack keeps the lamp raised");
      const before = await state();
      assert.equal(await pond.locator(".card-back").isVisible(), true);
      assert(
        await pond
          .locator(".card-back")
          .evaluate((img) => img.complete && img.naturalWidth > 0),
      );
      // A place has no level of its own, so its card carries no numeral.
      assert.equal(await pond.locator(".card-level").count(), 0);
      await pond.click();
      assert.equal(await pond.getAttribute("aria-pressed"), "false");
      assert.equal(await pond.getAttribute("data-unrevealed"), "false");
      assert.equal(await pond.getAttribute("data-revealing"), "common");
      // A new card only glows; it carries no text badge.
      assert.equal(
        await pond.evaluate((el) => getComputedStyle(el, "::after").content),
        "none",
      );
      const lid = await pond.locator(".reveal-lid").evaluate((el) => ({
        motion:
          el.getAnimations()[0].effect.getKeyframes()[0].transform ?? "fade",
        fit: getComputedStyle(el).objectFit,
      }));
      assert.equal(lid.fit, "contain");
      assert.equal(
        lid.motion === "fade",
        motion === "reduce",
        JSON.stringify(lid),
      );
      // Once the lid has opened it stays gone for the rest of the reveal.
      const lateLid = await pond.locator(".reveal-lid").evaluate((lid) => {
        for (const a of lid.getAnimations())
          a.currentTime = a.effect.getComputedTiming().endTime + 1;
        return getComputedStyle(lid).opacity;
      });
      assert.equal(lateLid, "0");
      // A tap during the reveal skips it without selecting, then the card,
      // with no layers or animations left, takes the next click itself. A
      // place widens first as it opens; tap once it holds still.
      await pond.evaluate((el) =>
        Promise.all(
          el
            .closest(".card-frame")
            .getAnimations()
            .map((a) => a.finished),
        ),
      );
      await pond.click();
      assert.equal(await pond.getAttribute("data-revealing"), null);
      assert.equal(await pond.getAttribute("aria-pressed"), "false");
      const hits = await pond.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return {
          card: el.contains(
            document.elementFromPoint(
              box.left + box.width / 2,
              box.top + box.height / 3,
            ),
          ),
          layers: el.querySelectorAll(".reveal-lid, .reveal-sheen").length,
          animations: el.getAnimations({ subtree: true }).length,
          preserved: [
            ...document.querySelectorAll("#hand *, .beat-stack *"),
          ].some((n) => getComputedStyle(n).transformStyle === "preserve-3d"),
        };
      });
      assert.deepEqual(hits, {
        card: true,
        layers: 0,
        animations: 0,
        preserved: false,
      });
      if (await page.locator("#speech-row").isVisible())
        assert.equal((await stackHits(page)).front, true);
      assert.deepEqual(await state(), before);
      const bounds = await pond.boundingBox();
      assert(
        bounds.width > 100 &&
          bounds.x >= 0 &&
          bounds.y >= 0 &&
          bounds.x + bounds.width <= width,
      );
      await page.screenshot({
        path: new URL(`reveal-${width}.png`, output).pathname,
      });
      // A hidden tab keeps the discovery ready for the player's return.
      if (width === 1440) {
        await page.evaluate(() => {
          Object.defineProperty(document, "hidden", {
            configurable: true,
            value: true,
          });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await page.waitForTimeout(1800);
        await page.evaluate(() => {
          Object.defineProperty(document, "hidden", {
            configurable: true,
            value: false,
          });
          document.dispatchEvent(new Event("visibilitychange"));
        });
      }
      // The first tap uncovers without playing or changing the held selection.
      await ready();
      assert.equal(
        await page
          .locator('#hand [data-card="pond"]')
          .getAttribute("data-unrevealed"),
        "false",
      );
      assert.deepEqual(await pressed(), held);
      await page.keyboard.press("Escape");
      await page.locator(".action-panel").waitFor({ state: "hidden" });
      await selectCard(page, "pond");
      assert.equal(
        await page
          .locator('#hand [data-card="pond"]')
          .getAttribute("aria-pressed"),
        "true",
      );
      assert.equal(await pond.locator(".card-level").count(), 0);
      await page.keyboard.press("Escape");
      await selectCard(page, "pond");
      await page.locator("#card-actions .card-primary").click();
      await finish();
      assert.equal((await state()).actors.vale.place, "pond");
      await selectCard(page, "station");
      await page.locator("#card-actions .card-primary").click();
      if (motion !== "reduce") {
        await page.locator("#toolbar-menu-button").click();
        await page.locator("#menu-button").click();
        await page.waitForTimeout(2400);
        await page.locator('[data-close="menu-dialog"]').click();
      }
      await unveil("keeper");
      assert.equal(
        await page
          .locator("#travel")
          .evaluate((el) => Number(getComputedStyle(el).opacity)),
        0,
      );
      await page.keyboard.press("Escape");
      // The keeper's oil arrives in his stack, which stays folded.
      await unveil("oil");
      assert.equal(
        await page.locator('#hand [data-card="oil"]').isVisible(),
        false,
      );
      await selectCard(page, "keeper");
      await page.locator('#hand [data-card="oil"]').click();
      await finish();
      if (motion === "reduce")
        assert.equal(await page.locator("#story-retry").isVisible(), true);
      // Tapping the card behind still goes back in time after discoveries.
      if (await page.locator("#beat-behind").isVisible()) {
        await page.waitForTimeout(400);
        assert.deepEqual(await stackHits(page), { front: true, behind: true });
        await page.locator("#beat-behind").click({ position: { x: 80, y: 6 } });
        await page.locator("#live-line").waitFor();
        await page.locator("#live-line").click();
        await page.locator("#live-line").waitFor({ state: "hidden" });
      }
      const saved = await state();
      await page.reload();
      await finish();
      assert.equal(
        await page
          .locator('#hand [data-card="keeper"]')
          .getAttribute("data-unrevealed"),
        "false",
      );
      assert.equal(
        await page
          .locator('#hand [data-card="oil"]')
          .getAttribute("data-unrevealed"),
        "false",
      );
      assert.deepEqual(await state(), saved);
      // Reset through the real menu, then cancel a live reveal with a save update.
      await page.locator("#toolbar-menu-button").click();
      // Signed out, Settings holds New game (#1892).
      await page.locator("#menu-button").click();
      await page.locator("#new-game").click();
      await page.locator("#confirm-reset").click();
      await ready();
      assert.equal((await state()).actors.vale.place, "attic");
      assert.equal((await state()).items.lamp.lit, true);
      assert.deepEqual(await covered(), opening);
      await selectCard(page, "lamp");
      await page.locator("#card-actions .card-primary").click();
      await unveil("pond");
      await page.evaluate(
        ({ key, save }) => {
          localStorage.setItem(key, save);
          window.dispatchEvent(
            new StorageEvent("storage", { key, newValue: save }),
          );
        },
        { key, save: JSON.stringify(saved) },
      );
      await finish();
      await page.waitForTimeout(1800);
      assert.deepEqual(errors, []);
      reports.push({ width, height, motion, passed: true });
      console.log(
        `Location stack, first-click reveal, skip, hit-testing, second-click selection, reload and reset passed at ${width}px (${motion}).`,
      );
    } finally {
      await page.close();
    }
  }
  await writeFile(
    new URL("report.json", output),
    JSON.stringify(reports, null, 2),
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
