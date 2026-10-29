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
      window.addEventListener("DOMContentLoaded", () => {
        new MutationObserver(() => {
          const dialog = document.querySelector("#unveil-dialog");
          if (dialog?.open && dialog.querySelector("[data-quest]"))
            window.questReveals.push(
              dialog.querySelector("[data-quest]").dataset.quest,
            );
        }).observe(document.body, {
          subtree: true,
          attributes: true,
          attributeFilter: ["open", "data-phase"],
        });
      });
    });
    const requests = [];
    const valeFacts = () =>
      requests
        .flatMap((input) => input.entities)
        .filter((entity) => entity.id === "vale")
        .at(-1)
        ?.facts.join(" ") || "";
    await page.route("**/card-game/text", (route) => {
      const input = route.request().postDataJSON();
      requests.push(input);
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
      for (let i = 0; i < 300; i++) {
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
      // The opening quest has no card, reveal or button. Vale says it.
      await ready();
      assert.equal(await page.locator("#unveil-dialog[open]").count(), 0);
      await finish();
      await selectCard(page, "vale");
      await page.locator('#card-actions [data-action="wait"]').click();
      await finish();
      assert.match(
        valeFacts(),
        /What I want most now: First light\. A little warmth might wake this empty room\./,
      );
      const openingHand = await page
        .locator("#hand .card")
        .evaluateAll((cards) => cards.map((card) => card.dataset.card));
      assert.deepEqual(openingHand, ["vale", "lamp", "attic"]);
      assert.equal(await page.locator("#hand [data-quest]").count(), 0);
      await page.screenshot({
        path: new URL(`rest-${width}.png`, output).pathname,
      });
      await selectCard(page, "lamp", { touch: width < 700 });
      assert.equal(
        await page.locator('#card-actions [data-action="drop-quest"]').count(),
        0,
      );
      assert.equal(
        await page.locator("body").getAttribute("data-place"),
        "attic",
      );
      assert.equal(
        await page.locator("body").getAttribute("data-lamplit"),
        "false",
      );
      await page.reload();
      await ready();
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
      await finish();
      // The finished quest reaches the next spoken scene, not a dialog.
      const completedKey = await page.evaluate(
        (key) =>
          Object.values(
            JSON.parse(localStorage.getItem(key)).quests.records,
          ).find((q) => q.program.id === "first-light").key,
        key,
      );
      assert.equal(
        await page.evaluate(
          ({ key, completedKey }) =>
            JSON.parse(localStorage.getItem(key)).quests.records[completedKey]
              .completedTurn !== null,
          { key, completedKey },
        ),
        true,
      );
      await selectCard(page, "vale");
      await page.locator('#card-actions [data-action="wait"]').click();
      await finish();
      assert.match(valeFacts(), /I just finished First light \(fulfilled\)\./);
      await page.screenshot({
        path: new URL(`fulfilled-${width}.png`, output).pathname,
      });
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
          locationId: world.actors.vale.place,
          speaker: "Vale",
          generated: true,
          text: "I wonder who is waiting beyond the mirror.",
        });
        const value = JSON.stringify(world);
        localStorage.setItem(key, value);
        dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
        return next.key;
      }, key);
      await page.waitForSelector("#dialogue-text .speech-letter");
      assert.equal(await page.locator("#unveil-dialog[open]").count(), 0);
      await finish();
      assert(nextQuestKey);
      await selectCard(page, "pond");
      await page.locator('#card-actions [data-action="move"]').click();
      await finish();
      await selectCard(page, "station");
      await page.locator('#card-actions [data-action="move"]').click();
      await finish();
      assert.equal(
        await page.locator("#hand .card").first().getAttribute("data-card"),
        "vale",
      );
      assert.match(valeFacts(), /Along the shore/);
      const saved = await page.evaluate(
        (key) => localStorage.getItem(key),
        key,
      );
      assert.equal(JSON.parse(saved).actors.vale.place, "station");
      await page.reload();
      await finish();
      assert.equal(
        await page.evaluate((key) => localStorage.getItem(key), key),
        saved,
      );
      assert.deepEqual(await page.evaluate(() => window.questReveals), []);
      // Reset restores the opening reveal; a save update safely cancels that reveal.
      await page.locator("#toolbar-menu-button").click();
      await page.locator("#menu-button").click();
      await page.locator("#new-game").click();
      await page.locator("#confirm-reset").click();
      await page.waitForSelector('#hand [data-card="vale"]');
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
        "station",
      );
      assert.deepEqual(await page.evaluate(() => window.questReveals), []);
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
