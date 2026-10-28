import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

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
      window.discoveries = [];
      window.flights = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        if (this.id === "unveil-take")
          window.flights.push({
            id: this.dataset.card,
            direction:
              document.querySelector("#unveil-dialog").dataset.direction,
            frames: args[0],
            duration: args[1].duration,
          });
        return animate.apply(this, args);
      };
      window.addEventListener("DOMContentLoaded", () => {
        new MutationObserver(() => {
          const dialog = document.querySelector("#unveil-dialog");
          if (
            !dialog?.open ||
            dialog.dataset.phase !== "reveal" ||
            dialog.dataset.direction === "fulfill"
          )
            return;
          const id = document.querySelector("#unveil-take").dataset.card;
          if (window.discoveries.at(-1)?.id === id) return;
          window.discoveries.push({
            id,
            isQuest: Boolean(
              document.querySelector("#unveil-take [data-quest]"),
            ),
            travel: Number(
              getComputedStyle(document.querySelector("#travel")).opacity,
            ),
            speech: document.querySelectorAll("#dialogue-text .revealed")
              .length,
            cooling: document.querySelector("#hand").dataset.cooling,
          });
        }).observe(document.body, {
          attributes: true,
          subtree: true,
          attributeFilter: ["open", "data-phase"],
        });
      });
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
          document.querySelector("#unveil-dialog").open &&
          document.querySelector("#unveil-dialog").dataset.phase === "reveal" &&
          document.querySelector("#unveil-take").dataset.card === id,
        id,
      );
    const finish = async () => {
      for (let i = 0; i < 100; i++) {
        if (await page.locator("#unveil-dialog[open]").count())
          await page.keyboard.press("Escape");
        else if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
        await page.waitForTimeout(50);
      }
      throw Error("The exchange stayed busy");
    };
    try {
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?table=${table}`,
      );
      await ready();
      assert.equal(await page.locator("#unveil-dialog[open]").count(), 0);
      await selectCard(page, "lamp");
      await page.locator("#card-actions .card-primary").click();
      await unveil("attic");
      assert.equal((await state()).actors.vale.place, "pond");
      assert.equal(
        await page.locator('#hand [data-card="vale"]').isDisabled(),
        true,
      );
      const before = await state();
      await page.locator('#hand [data-card="vale"]').dispatchEvent("click");
      assert.deepEqual(await state(), before);
      const bounds = await page.locator("#unveil-take").boundingBox();
      assert(
        bounds.width > 100 &&
          bounds.x >= 0 &&
          bounds.y >= 0 &&
          bounds.y + bounds.height <= height,
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
        assert.equal(
          await page.locator("#unveil-dialog").getAttribute("data-phase"),
          "reveal",
        );
        await page.evaluate(() => {
          Object.defineProperty(document, "hidden", {
            configurable: true,
            value: false,
          });
          document.dispatchEvent(new Event("visibilitychange"));
        });
      }
      // The first reveal finishes itself; the player can also tap or press Escape.
      await ready();
      assert.equal(
        await page
          .locator('#hand [data-card="attic"]')
          .evaluate((el) => el.classList.contains("new")),
        true,
      );
      assert.equal(await page.locator(".action-panel").isVisible(), true);
      await selectCard(page, "attic");
      assert.equal(
        await page
          .locator('#hand [data-card="attic"]')
          .evaluate((el) => el.classList.contains("new")),
        false,
      );
      await page.keyboard.press("Escape");
      await selectCard(page, "station");
      await page.locator("#card-actions .card-primary").click();
      if (motion !== "reduce") {
        await page.locator("#toolbar-menu-button").click();
        await page.locator("#menu-button").click();
        await page.waitForTimeout(2400);
        assert.equal(await page.locator("#unveil-dialog[open]").count(), 0);
        await page.locator('[data-close="menu-dialog"]').click();
      }
      await unveil("keeper");
      assert.equal(
        await page
          .locator("#travel")
          .evaluate((el) => Number(getComputedStyle(el).opacity)),
        0,
      );
      assert.equal(await page.locator("#dialogue-text .revealed").count(), 0);
      await page.keyboard.press("Escape");
      await unveil("oil");
      assert.equal(
        await page.locator('#hand [data-card="oil"]').isVisible(),
        false,
      );
      await page.locator("#unveil-take").click();
      await finish();
      if (motion === "reduce")
        assert.equal(await page.locator("#story-retry").isVisible(), true);
      const events = await page.evaluate(() => ({
        discoveries: window.discoveries,
        flights: window.flights,
      }));
      assert.equal(
        events.discoveries.filter((event) => !event.isQuest)[0].id,
        "attic",
      );
      assert(
        events.discoveries.findIndex((e) => e.id === "keeper") <
          events.discoveries.findIndex((e) => e.id === "oil"),
      );
      assert(
        events.discoveries.every(
          (e) =>
            e.cooling === "true" &&
            e.travel <= 0.01 &&
            (e.isQuest || e.speech === 0),
        ),
        `Reveal state at ${width}px (${motion}): ${JSON.stringify(events.discoveries)}`,
      );
      if (motion === "reduce") assert.equal(events.flights.length, 0);
      else {
        assert(events.flights.some((f) => f.id === "attic"));
        assert(events.flights.some((f) => f.id === "oil"));
        assert(
          events.flights
            .filter((f) => f.direction !== "fulfill")
            .every((f) => f.frames[1].transform !== "translate(0, 0) scale(1)"),
        );
      }
      const saved = await state();
      await page.reload();
      await finish();
      assert.equal(await page.locator("#unveil-dialog[open]").count(), 0);
      assert.deepEqual(await page.evaluate(() => window.discoveries), []);
      assert.deepEqual(await state(), saved);
      // Reset through the real menu, then cancel a live reveal with a save update.
      await page.locator("#toolbar-menu-button").click();
      await page.locator("#menu-button").click();
      await page.locator("#new-game").click();
      await page.locator("#confirm-reset").click();
      await ready();
      await selectCard(page, "lamp");
      await page.locator("#card-actions .card-primary").click();
      await unveil("attic");
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
      assert.equal(await page.locator("#unveil-dialog[open]").count(), 0);
      assert.equal(
        await page
          .locator("#unveil-take")
          .evaluate((el) => el.getAnimations().length),
        0,
      );
      assert.deepEqual(errors, []);
      reports.push({ width, height, motion, ...events, passed: true });
      console.log(
        `Discovery reveal, flight, glow, travel order, held items, reload and cancellation passed at ${width}px (${motion}).`,
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
