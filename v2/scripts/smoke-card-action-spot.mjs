// A ready play's buttons sit under the dialogue, above a hand that does not
// move, and nothing between the hand and the screen edge clips its cards.
// Vale takes the Burial Decree at the Theban Palace Forecourt (one "the" in
// the caption) and offers it to Creon.
import { selectCard } from "./card-browser-helpers.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";

const output = new URL("../../output/action-spot/", import.meta.url);
await mkdir(output, { recursive: true });
const world = createWorld();
world.actors.vale.place = "greek-palace";
world.items["greek-decree"].holder = "greek-palace";
const server = createServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  headless: true,
  args: ["--mute-audio"],
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : {}),
});
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
    [844, 390],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // Hold each reply until released, so the pending play can be seen.
    let release;
    await page.route("**/card-game/text", async (route) => {
      const c = route.request().postDataJSON();
      await new Promise((r) => (release = r));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          revision: c.revision,
          model: "action-spot-fixture",
          entries: c.entities.map(({ id }) => ({ id, text: "So be it." })),
        }),
      });
    });
    const key = `cosyworld.reflected-shore.v1.action-spot-${width}`;
    await page.addInitScript(
      ({ key, save }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false, volume: 0 }),
        );
      },
      { key, save: encodeSave(world) },
    );
    const box = (selector) =>
      page
        .locator(selector)
        .first()
        .evaluate((e) => {
          const r = e.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
        });
    // Every card's frame reaches the hand's foot: nothing cuts it short.
    // The hand's top padding is clear room for a lean or a lift that rises
    // under the action row; the row itself ends above the cards' row.
    async function handUncut() {
      const { clipped, handBottom } = await page.evaluate(() => {
        const el = document.querySelector("#hand");
        const hand = el.getBoundingClientRect();
        const row = hand.top + parseFloat(getComputedStyle(el).paddingTop);
        const panel = document.querySelector(".action-panel");
        const p = panel.hidden ? null : panel.getBoundingClientRect();
        return {
          handBottom: hand.bottom,
          clipped:
            p &&
            p.bottom > row + 1 &&
            p.left < hand.right &&
            p.right > hand.left,
        };
      });
      assert(!clipped, "the action row overlaps the hand");
      assert(handBottom >= height - 2, `hand ends at ${handBottom}`);
    }
    const shot = (name) =>
      page.screenshot({
        path: new URL(`${name}-${width}.png`, output).pathname,
      });
    const port = server.address().port;
    await page.goto(`http://127.0.0.1:${port}/?table=action-spot-${width}`);
    await page
      .locator('#hand [data-card="greek-decree"]')
      .waitFor({ state: "attached" });
    release?.();
    await page.waitForTimeout(800);
    release?.();
    const restHand = await box("#hand");
    await handUncut();
    await shot("idle");

    await selectCard(page, "greek-decree");
    await page.locator("#card-actions .card-primary").waitFor();
    await page.waitForTimeout(400);
    const button = await box("#card-actions .card-primary"),
      dialogue = await box(".dialogue"),
      hand = await box("#hand"),
      // The highest card, the chosen one lifted with its lean.
      cardsTop = await page.evaluate(() =>
        Math.min(
          ...[
            ...document.querySelectorAll("#hand .card-frame:not([hidden])"),
          ].map((f) => f.getBoundingClientRect().top),
        ),
      );
    assert(button.top >= dialogue.bottom - 1, "button under the dialogue");
    assert(
      button.bottom <= cardsTop + 1,
      `button above the hand: ends ${button.bottom}, cards at ${cardsTop}`,
    );
    assert(button.bottom <= height, "button on screen");
    assert(Math.abs(hand.bottom - restHand.bottom) < 2, "hand stays put");
    await handUncut();
    await shot("ready");

    await page.locator("#card-actions .card-primary").click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".beat-caption, .dialogue")].some((e) =>
        /took the Burial Decree/.test(e.textContent),
      ),
    );
    const captions = await page.locator(".dialogue").innerText();
    assert(!/the the/i.test(captions), captions);
    release?.();
    await page.waitForTimeout(600);
    release?.();
    await page.keyboard.press("Escape");
    await selectCard(page, "greek-decree");
    await selectCard(page, "greek-creon");
    const give = page.locator("#card-actions .card-primary");
    assert.match(await give.innerText(), /Give/);
    await page.waitForTimeout(400);
    const offer = await box("#card-actions .card-primary"),
      spoken = await box(".dialogue");
    // On phones and tablets the dialogue lies over the hand's foot (#1897),
    // so the offer sits above it; elsewhere it sits under it.
    assert(
      offer.top >= spoken.bottom - 1 || offer.bottom <= spoken.top + 1,
      `offer clear of the dialogue: ${JSON.stringify([offer, spoken])}`,
    );
    await handUncut();
    await shot("ready-dialogue");
    await give.click();
    await page.waitForTimeout(150);
    await handUncut();
    await shot("pending");
    release?.();
    await page.waitForTimeout(600);
    release?.();
    await handUncut();
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("action spot ok");
} finally {
  await browser.close();
  server.close();
}
