import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave, nameOf } from "../card-game/world.mjs";
import { availableCards } from "../card-game/cards.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

const output = new URL("../../output/card-thinking/", import.meta.url);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const reports = [];
try {
  for (const width of [1440, 390]) {
    const world = createWorld();
    world.actors.vale.place = "pond";
    world.actors.moth.place = "pond";
    // Pip stays at the pond to be talked with.
    world.actors.moth.want = null;
    world.items.lamp.holder = "station";
    const table = `thinking-${width}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 900 },
      reducedMotion: width === 390 ? "reduce" : "no-preference",
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const requests = [];
    await page.route("**/card-game/text", (route) => {
      requests.push({ route, input: route.request().postDataJSON() });
    });
    await page.addInitScript(
      ({ key, save, seen }) => {
        localStorage.setItem(key, save);
        localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false }),
        );
      },
      { key, save: encodeSave(world), seen: availableCards(world) },
    );
    const snapshot = () =>
      page.evaluate(() => ({
        cast: [
          ...document.querySelectorAll(
            '#cast [data-avatar]:not([data-removing="true"])',
          ),
        ]
          .map((e) => e.dataset.avatar)
          .sort(),
        hand: [...document.querySelectorAll("#hand .card.avatar")]
          .map((e) => e.dataset.card)
          .sort(),
        status: document.querySelector("#story-status").textContent,
        stageRevision:
          document.querySelector("#stage").dataset.presentedRevision,
        handRevision: document.querySelector("#hand").dataset.presentedRevision,
      }));
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=${table}`,
    );
    await selectCard(page, "vale");
    const requested = page.waitForRequest("**/card-game/text");
    await page.locator('#card-actions [data-action="wait"]').click();
    await requested;
    await page.waitForTimeout(2700);
    const pending = await snapshot();
    reports.push({ width, pending, errors });
    await page.screenshot({
      path: new URL(`pending-${width}.png`, output).pathname,
    });
    {
      assert.deepEqual(
        pending.cast,
        pending.hand,
        "thinking cast and hand share the committed snapshot",
      );
      assert.equal(pending.stageRevision, pending.handRevision);
      assert.match(pending.status, /Thinking/);
    }
    assert(requests.length);
    await requests
      .at(-1)
      .route.fulfill({ status: 503, json: { error: "fixture" } });
    await page.waitForTimeout(1100);
    if (requests.length > 1)
      await requests
        .at(-1)
        .route.fulfill({ status: 503, json: { error: "fixture" } });
    await page.waitForFunction(
      () => !document.querySelector("#story-retry").hidden,
    );
    const failed = await snapshot();
    reports.at(-1).failed = failed;
    assert.deepEqual(failed.cast, failed.hand);
    const saved = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      key,
    );
    const requestedRetry = page.waitForRequest("**/card-game/text");
    await page.locator("#story-retry").click();
    await requestedRetry;
    await page.waitForTimeout(100);
    const retrying = await snapshot();
    {
      assert.deepEqual(retrying.cast, retrying.hand);
      assert.match(retrying.status, /Thinking/);
      const animation = await page
        .locator(".thinking-orbit")
        .evaluate((el) => ({
          name: getComputedStyle(el).animationName,
          count: getComputedStyle(el).animationIterationCount,
        }));
      if (width === 390) assert.equal(animation.name, "none");
      else assert.equal(animation.count, "12");
    }
    const attempt = requests.at(-1);
    await attempt.route.fulfill({
      json: {
        revision: attempt.input.revision,
        model: "thinking-fixture",
        entries: attempt.input.entities.map(({ id }) => ({
          id,
          text: "The path is quiet now.",
        })),
      },
    });
    await page.waitForFunction(() =>
      document
        .querySelector("#dialogue-text")
        .textContent.includes("The path is quiet now."),
    );
    const recovered = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      key,
    );
    assert.equal(recovered.turn, saved.turn);
    assert.deepEqual(recovered.actors, saved.actors);
    assert.deepEqual(recovered.items, saved.items);
    assert.deepEqual((await snapshot()).cast, (await snapshot()).hand);
    for (
      let step = 0;
      step < 80 &&
      (await page.locator("#hand").getAttribute("data-cooling")) === "true";
      step++
    ) {
      if (await page.locator("#dialogue-advance").isVisible())
        await page.locator("#dialogue-advance").click();
      await page.waitForTimeout(50);
    }
    // A Talk asks for words; a silent move made before they arrive
    // supersedes them and sends no request of its own.
    const talkRequest = page.waitForRequest("**/card-game/text");
    await selectCard(page, "moth");
    await page.locator('#card-actions [data-action="talk"]').click();
    await talkRequest;
    const replaced = requests.at(-1);
    const asked = requests.length;
    await page.waitForFunction(
      () => document.querySelector("#hand").dataset.cooling === "false",
    );
    await selectCard(page, "station");
    await page.locator('#card-actions [data-action="move"]').click();
    await page.waitForFunction(
      (title) => document.querySelector("#place-title").textContent === title,
      nameOf("station"),
    );
    await replaced.route
      .fulfill({
        json: {
          revision: replaced.input.revision,
          model: "old-thinking-fixture",
          entries: replaced.input.entities.map(({ id }) => ({
            id,
            text: "These words belong to the previous room.",
          })),
        },
      })
      .catch(() => {});
    await page.waitForFunction(
      () => document.querySelector("#hand").dataset.cooling === "false",
    );
    const superseded = await snapshot();
    assert.equal(requests.length, asked);
    assert.deepEqual(superseded.cast, superseded.hand);
    assert.equal(superseded.stageRevision, superseded.handRevision);
    assert.doesNotMatch(
      await page.locator("#dialogue-text").innerText(),
      /previous room/,
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await writeFile(
    new URL("report.json", output),
    JSON.stringify(reports, null, 2),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(JSON.stringify(reports));

await import("./smoke-card-reply-wait.mjs");
