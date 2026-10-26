import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

const type = process.env.CARD_BROWSER || "chromium";
const browser = await { chromium, webkit }[type].launch({ headless: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const output = new URL(`../../output/card-voice-${type}/`, import.meta.url);
await mkdir(output, { recursive: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 900 },
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(20000);
    const key = `cosyworld.reflected-shore.v1.voice-${width}`,
      errors = [],
      requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("cosyworld.dialogue.sound", "off");
      localStorage.setItem(
        "cosyworld.room-music",
        JSON.stringify({ enabled: false }),
      );
      window.fulfilled = [];
      window.addEventListener("DOMContentLoaded", () => {
        new MutationObserver(() => {
          const quest = document.querySelector(
            '#hand .card-frame[data-raised="true"] [data-fulfilled="true"]',
          );
          if (quest && !window.fulfilled.includes(quest.dataset.quest))
            window.fulfilled.push(quest.dataset.quest);
        }).observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["data-raised"],
        });
      });
    });
    const response = (input) => ({
      revision: input.revision,
      model: "voice-fixture",
      entries: input.entities.map(({ id }) => ({
        id,
        text:
          id === "vale"
            ? `My reaction to ${input.outcome.card.kind}.`
            : "There is time to look around.",
      })),
    });
    let heldLight;
    await page.route("**/card-game/text", (route) => {
      const input = route.request().postDataJSON();
      requests.push(input);
      if (input.outcome.card.kind === "light" && !heldLight) {
        heldLight = { route, input };
        return;
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(response(input)),
      });
    });
    const finish = async () => {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        if (await page.locator("#unveil-dialog[open]").count())
          await page.keyboard.press("Escape");
        else if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        await page.waitForTimeout(50);
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
      }
      throw Error("Voice flow stayed busy");
    };
    const playCards = async (kind, ids) => {
      const before = requests.length;
      for (const id of ids) await selectCard(page, id);
      await page.locator(`#card-actions [data-action="${kind}"]`).click();
      await finish();
      assert.equal(requests.length, before + 1, `${kind} requests speech once`);
      assert.equal(requests.at(-1).speakers[0], "vale");
      assert.equal(requests.at(-1).outcome.card.kind, kind);
      const world = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)),
        key,
      );
      assert(
        world.log.some(
          (line) =>
            line.turn === world.turn &&
            line.actorId === "vale" &&
            line.kind === "dialogue" &&
            line.text === `My reaction to ${kind}.`,
        ),
      );
    };
    try {
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?table=voice-${width}`,
      );
      await page.waitForSelector("#dialogue-text .speech-letter");
      assert.equal(await page.locator("#speaker").innerText(), "Vale");
      assert.match(
        await page.locator("#dialogue-text").textContent(),
        /It's cold up here/,
      );
      assert.equal(requests.length, 0);
      await finish();
      await page.reload();
      await finish();
      const opening = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)),
        key,
      );
      assert.equal(
        opening.log.filter((line) => line.generated && line.kind === "dialogue")
          .length,
        1,
        "Reload keeps one opening line",
      );
      assert.equal(opening.turn, 0);
      await selectCard(page, "lamp");
      await page.locator('#card-actions [data-action="light"]').click();
      await finish(); // The delayed request releases the hand after scene preparation.
      assert(heldLight);
      assert.equal(await page.locator("#speaker").innerText(), "Vale");
      assert.equal(await page.locator("#dialogue-text").textContent(), "");
      await playCards("snuff", ["lamp"]);
      assert.deepEqual(
        await page.evaluate(() => window.fulfilled),
        ["vale:0:first-light:authored"],
        "A replaced slow reply preserves the quest completion cue",
      );
      await heldLight.route
        .fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(response(heldLight.input)),
        })
        .catch(() => {});
      await page.waitForTimeout(100);
      const saved = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)),
        key,
      );
      assert(
        !saved.log.some((line) => line.text === "My reaction to light."),
        "Stale dialogue stays out of the current turn",
      );
      await playCards("wait", ["attic"]);
      await playCards("drop", ["lamp", "attic"]);
      await playCards("take", ["lamp"]);
      await page.screenshot({
        path: new URL(`vale-${width}.png`, output).pathname,
      });
      assert.deepEqual(errors, []);
      console.log(
        `Opening, Light replacement, quest completion, Stay, Put down and Take speech passed in ${type} at ${width}px.`,
      );
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
