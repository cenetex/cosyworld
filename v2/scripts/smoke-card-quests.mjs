import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { selectCard } from "./card-browser-helpers.mjs";
const type = process.env.CARD_BROWSER || "chromium";
const browser = await { chromium, webkit }[type].launch({ headless: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const output = new URL(`../../output/card-quests-${type}/`, import.meta.url);
await mkdir(output, { recursive: true });
const reports = [];
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
    [320, 568],
    [667, 375],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: width === 320 ? "reduce" : "no-preference",
      hasTouch: width < 700,
    });
    page.setDefaultTimeout(20000);
    const key = `cosyworld.reflected-shore.v1.quests-${width}`,
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("cosyworld.dialogue.sound", "off");
      localStorage.setItem(
        "cosyworld.room-music",
        JSON.stringify({ enabled: false }),
      );
      window.questReveals = [];
      window.questMotions = [];
      window.addEventListener("DOMContentLoaded", () => {
        new MutationObserver(() => {
          const dialog = document.querySelector("#unveil-dialog");
          if (dialog?.open && dialog.dataset.direction === "fulfill") {
            const phase = dialog.dataset.phase;
            if (window.questMotions.at(-1) !== phase)
              window.questMotions.push(phase);
          }
          if (
            dialog?.open &&
            dialog.dataset.phase === "reveal" &&
            dialog.dataset.direction !== "fulfill" &&
            dialog.querySelector(".card[data-quest]")
          ) {
            const id = dialog.querySelector(".card").dataset.quest;
            if (window.questReveals.at(-1) !== id) window.questReveals.push(id);
          }
        }).observe(document.body, {
          subtree: true,
          attributes: true,
          attributeFilter: ["open", "data-phase"],
        });
      });
    });
    await page.route("**/card-game/text", (route) => {
      const input = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          revision: input.revision,
          model: "quest-fixture",
          entries: input.entities.map(({ id }) => ({
            id,
            text: "There is time to look around.",
          })),
        }),
      });
    });
    const card = (id) => page.locator(`#hand [data-card="${id}"]`);
    const ready = () =>
      page.waitForFunction(
        () => document.querySelector("#hand").dataset.cooling === "false",
      );
    const finish = async () => {
      for (let i = 0; i < 150; i++) {
        if (await page.locator("#unveil-dialog[open]").count())
          await page.keyboard.press("Escape");
        else if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        await page.waitForTimeout(60);
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
      }
      throw Error("Quest exchange stayed busy");
    };
    try {
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?table=quests-${width}`,
      );
      await page.waitForSelector("#dialogue-text .speech-letter");
      assert.equal(await page.locator("#speaker").innerText(), "Vale");
      assert.match(
        await page.locator("#dialogue-text").textContent(),
        /It's cold up here/,
      );
      assert.equal(await page.locator("#unveil-dialog[open]").count(), 0);
      await page.waitForSelector("#unveil-dialog[open] [data-quest]");
      assert.equal(
        await page.locator("#unveil-take").getAttribute("data-card"),
        "player-quest",
      );
      assert.equal(
        await page.locator("#unveil-take .quest-purpose").innerText(),
        "A little warmth might wake this empty room.",
      );
      assert.equal(await card("vale").isDisabled(), true);
      await page.keyboard.press("Escape");
      await ready();
      assert.equal(await card("player-quest").isVisible(), false);
      assert.deepEqual(
        await page
          .locator("#hand .card")
          .evaluateAll((cards) => cards.map((card) => card.dataset.card)),
        ["attic", "vale", "lamp", "player-quest"],
      );
      await page.screenshot({
        path: new URL(`rest-${width}.png`, output).pathname,
      });
      await selectCard(page, "player-quest", { touch: width < 700 });
      await page.waitForTimeout(350);
      assert.equal(
        await card("player-quest").getAttribute("aria-pressed"),
        "true",
      );
      assert.equal(
        await card("player-quest").getAttribute("draggable"),
        "false",
      );
      assert.equal(await page.locator("#card-actions button").count(), 0);
      assert.equal(
        await page.evaluate(() => document.activeElement.dataset.card),
        "player-quest",
      );
      const bounds = await card("player-quest").boundingBox();
      const purpose = await card("player-quest")
        .locator(".quest-purpose")
        .boundingBox();
      assert(
        purpose.y >= bounds.y &&
          purpose.y + purpose.height <= bounds.y + bounds.height,
        "Purpose fits its card",
      );
      assert(
        bounds.y >= 0 && bounds.y + bounds.height <= height + 1,
        "Raised card fits viewport",
      );
      assert.equal(
        await page.locator("body").getAttribute("data-place"),
        "attic",
      );
      assert.equal(
        await page.locator("body").getAttribute("data-lamplit"),
        "false",
      );
      await page.screenshot({
        path: new URL(`purpose-${width}.png`, output).pathname,
      });
      await card("player-quest").click();
      assert.equal(
        await card("player-quest").getAttribute("aria-pressed"),
        "false",
      );
      await page.reload();
      await ready();
      assert.deepEqual(await page.evaluate(() => window.questReveals), []);
      await selectCard(page, "lamp");
      await page.locator('#card-actions [data-action="light"]').click();
      await page.waitForFunction(
        () =>
          document.querySelector("#unveil-dialog").open &&
          document.querySelector("#unveil-take").dataset.card === "pond",
      );
      assert.equal(
        await page.locator("body").getAttribute("data-lamplit"),
        "true",
      );
      await page.keyboard.press("Escape");
      await page.waitForSelector("#dialogue-text .speech-letter");
      assert.equal(await page.locator("#speaker").innerText(), "Vale");
      for (
        let i = 0;
        i < 20 &&
        !(await page
          .locator('#unveil-dialog[open] [data-fulfilled="true"]')
          .count());
        i++
      ) {
        await page.locator("#dialogue-advance").click();
        await page.waitForTimeout(60);
      }
      await page.waitForSelector(
        '#unveil-dialog[open] [data-fulfilled="true"]',
      );
      assert.equal(
        await page.locator("#hand").getAttribute("data-cooling"),
        "true",
      );
      await page.waitForFunction(() => {
        const dialog = document.querySelector("#unveil-dialog");
        return (
          dialog.dataset.direction === "fulfill" &&
          dialog.dataset.phase === "reveal"
        );
      });
      const completedBounds = await page
        .locator("#unveil-take .card")
        .boundingBox();
      assert(
        Math.abs(completedBounds.x + completedBounds.width / 2 - width / 2) < 2,
        JSON.stringify({ width, height, completedBounds }),
      );
      assert(
        Math.abs(completedBounds.y + completedBounds.height / 2 - height / 2) <
          2,
        JSON.stringify({ width, height, completedBounds }),
      );
      assert.equal(
        await page
          .locator('#unveil-take [data-fulfilled="true"]')
          .evaluate((card) => getComputedStyle(card).opacity),
        "1",
      );
      await page.screenshot({
        path: new URL(`fulfilled-${width}.png`, output).pathname,
      });
      if (width === 390) {
        await page.locator("#menu-button").click();
        await page.waitForTimeout(2500);
        assert.equal(
          await page
            .locator('#unveil-dialog[open] [data-fulfilled="true"]')
            .count(),
          1,
          "Menu pauses completion",
        );
        await page.keyboard.press("Escape");
      }
      await ready();
      assert.equal(await card("player-quest").count(), 0);
      assert.equal(
        await page.evaluate(() => window.questMotions.includes("outward")),
        width !== 320,
        "completion uses the discovery flight in reverse with full motion",
      );
      // Resume a later purpose with an unfinished line. The new card waits for it.
      const nextQuestKey = await page.evaluate(async (key) => {
        const { ensureCollectedQuest, pursueQuest } = await import(
          "/quests.mjs"
        );
        const { places, things } = await import("/world.mjs");
        const { collectionCards } = await import("/shared-quests.mjs");
        const world = JSON.parse(localStorage.getItem(key));
        world.life.actors.vale.phase = "active";
        ensureCollectedQuest(world, "vale", places, things);
        const next = collectionCards(world, "vale").find(
          (quest) => quest.program.id === "along-the-shore",
        );
        if (!pursueQuest(world, "vale", next.key))
          throw new Error("The collected quest must accept focus.");
        world.eventSeq++;
        world.log.push({
          seq: world.eventSeq,
          turn: world.turn,
          kind: "dialogue",
          actorId: "vale",
          locationId: "attic",
          speaker: "Vale",
          generated: true,
          text: "I wonder who is waiting beyond the water.",
        });
        const value = JSON.stringify(world);
        localStorage.setItem(key, value);
        dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
        return next.key;
      }, key);
      await page.waitForSelector("#dialogue-text .speech-letter");
      assert.equal(await page.locator("#unveil-dialog[open]").count(), 0);
      await finish();
      assert.deepEqual(await page.evaluate(() => window.questReveals), [
        nextQuestKey,
      ]);
      await selectCard(page, "pond");
      await page.locator('#card-actions [data-action="move"]').click();
      await finish();
      assert.equal(
        await page.locator("#hand .card").first().getAttribute("data-card"),
        "pond",
      );
      await selectCard(page, "player-quest");
      assert.equal(
        await card("player-quest").locator(".name").innerText(),
        "Along the shore",
      );
      const saved = await page.evaluate(
        (key) => localStorage.getItem(key),
        key,
      );
      await page.reload();
      await finish();
      assert.equal(
        await page.evaluate((key) => localStorage.getItem(key), key),
        saved,
      );
      assert.deepEqual(await page.evaluate(() => window.questReveals), []);
      // Reset restores the opening reveal; a save update safely cancels that reveal.
      await page.locator("#menu-button").click();
      await page.locator("#new-game").click();
      await page.locator("#confirm-reset").click();
      await page.waitForSelector("#unveil-dialog[open] [data-quest]");
      await page.evaluate(
        ({ key, saved }) => {
          localStorage.setItem(key, saved);
          dispatchEvent(new StorageEvent("storage", { key, newValue: saved }));
        },
        { key, saved },
      );
      await finish();
      assert.equal(
        await page.locator("body").getAttribute("data-place"),
        "pond",
      );
      assert.deepEqual(errors, []);
      reports.push({ width, height, passed: true });
    } finally {
      await page.close();
    }
  }
  console.log(JSON.stringify({ browser: type, reports }));
  await writeFile(
    new URL("report.json", output),
    JSON.stringify({ browser: type, reports }, null, 2),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
