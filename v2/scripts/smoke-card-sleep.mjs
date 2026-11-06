// Sleep after a Wait (#2028): the same cards chosen again offer Sleep, its
// wake reads as a past-tense caption, and a sleeper's Thinking card shows
// the sleeping art.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { availableCards } from "../card-game/cards.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

const server = createServer();
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const output = resolve("output/card-sleep");
await mkdir(output, { recursive: true });
const labels = (page) =>
  page
    .locator("#card-actions button")
    .evaluateAll((all) =>
      all.map((b) => b.getAttribute("aria-label") || b.textContent.trim()),
    );

async function local(width) {
  const page = await browser.newPage({
    viewport: { width, height: width === 390 ? 844 : 900 },
    reducedMotion: "reduce",
    hasTouch: width === 390,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  // The residents stay content, so the beats are Vale's own.
  const world = createWorld();
  world.actors.moth.want = null;
  world.actors.keeper.want = null;
  await page.route("**/card-game/text", (route) =>
    route.fulfill({ status: 503, json: { error: "fixture" } }),
  );
  await page.addInitScript(
    ({ save, seen }) => {
      localStorage.setItem("cosyworld.reflected-shore.v1.sleep", save);
      localStorage.setItem(
        "cosyworld.reflected-shore.v1.sleep.seen",
        JSON.stringify(seen),
      );
      localStorage.setItem("cosyworld.dialogue.sound", "off");
    },
    { save: encodeSave(world), seen: availableCards(world) },
  );
  const touch = width === 390;
  const play = page.locator("#card-actions .card-primary");
  const settled = () =>
    page.waitForFunction(
      () => document.querySelector("#hand").dataset.cooling === "false",
    );
  try {
    await page.goto(`${origin}/?table=sleep`);
    await page.waitForFunction(() => document.body.inert === false);
    await selectCard(page, "vale", { touch });
    assert.deepEqual(await labels(page), ["Wait"]);
    if (touch) await page.locator(".action-beat-cards").tap();
    else await play.press("Enter");
    await settled();
    // The same card chosen again offers Sleep in place of Wait.
    await selectCard(page, "vale", { touch });
    assert.deepEqual(await labels(page), ["Sleep"]);
    await page.screenshot({ path: resolve(output, `offer-${width}.png`) });
    // Letting go of the card brings back the plain Wait.
    await selectCard(page, "vale", { touch });
    await selectCard(page, "vale", { touch });
    assert.deepEqual(await labels(page), ["Wait"]);
    await play.click();
    await settled();
    await selectCard(page, "vale", { touch });
    if (touch) await play.click();
    else {
      const card = page.locator('#hand [data-card="vale"]');
      const stage = page.locator("#stage");
      const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
      await card.dispatchEvent("dragstart", { dataTransfer });
      assert.equal(await stage.getAttribute("data-play"), "Sleep");
      await stage.dispatchEvent("drop", { dataTransfer });
    }
    await settled();
    // The wake gives its reason in the past, after the Sleep.
    await page.waitForFunction(() =>
      /Vale woke/.test(document.querySelector(".dialogue").textContent),
    );
    const text = await page.locator(".dialogue").textContent();
    assert.match(text, /Vale woke (as|at|in|to|,)/);
    await page.screenshot({ path: resolve(output, `woke-${width}.png`) });
    // A Sleep is not a Wait: choosing Vale again offers Wait.
    await selectCard(page, "vale", { touch });
    assert.deepEqual(await labels(page), ["Wait"]);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function shared(width) {
  const world = dispatchShared({
    op: "create",
    save: encodeSave(createWorld()),
  }).world;
  world.actors.vale.sleeping = {
    since: world.turn,
    place: world.actors.vale.place,
    present: [],
  };
  let queue = [];
  const page = await browser.newPage({
    viewport: { width, height: width === 390 ? 844 : 900 },
    reducedMotion: "reduce",
    hasTouch: width === 390,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/auth/account", (route) =>
    route.fulfill({ json: { authenticated: true } }),
  );
  await page.route(/\/card-game\/shared\/worlds\/asleep(?:\/command)?$/, (r) =>
    r.fulfill({
      json: {
        ...dispatchShared({
          op: "view",
          world,
          actor: "vale",
          claimed: ["vale"],
          present: ["vale"],
        }),
        id: "asleep",
        version: "full-card-world/9",
        claimed: [1, 0, 0, 0, 0, 0, 0, 0],
        present: [1, 0, 0, 0, 0, 0, 0, 0],
        now: Date.now(),
        queue,
        history: [],
      },
    }),
  );
  try {
    await page.goto(`${origin}/?world=asleep`);
    await page.waitForFunction(() => document.body.inert === false);
    const touch = width === 390;
    await selectCard(page, "vale", { touch });
    assert.deepEqual(await labels(page), ["Wake Vale"]);
    assert.equal(
      await page.locator("#card-actions button").textContent(),
      "Wake Vale",
    );
    assert.equal(await page.locator("#action-beat .quest-ground").count(), 1);
    await selectCard(page, world.actors.vale.place, { touch });
    assert.deepEqual(await labels(page), ["Sleep on"]);
    await page.screenshot({ path: resolve(output, `asleep-${width}.png`) });
    await page.keyboard.press("Escape");
    // Its play in flight is a Thinking card with the sleeping art.
    queue = [{ id: "sleep-on", actor: "vale", status: "waiting" }];
    await page.waitForFunction(
      () =>
        !document.querySelector("#story-status").hidden &&
        /vale-sleeping/.test(
          document.querySelector("#speaker-portrait img")?.src || "",
        ),
    );
    await page.screenshot({ path: resolve(output, `thinking-${width}.png`) });
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

try {
  for (const width of [1440, 390]) {
    await local(width);
    await shared(width);
    console.log(`Sleep passed at ${width}px.`);
  }
} finally {
  await browser.close();
  server.close();
}
