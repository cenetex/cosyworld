// The painted backdrop fills the stage and the cast stands whole on it, at the
// Steam Clock (whose badger shares the painting's coordinates) and at the pond.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { clearSelection, selectCard } from "./card-browser-helpers.mjs";

const output = new URL("../../output/stage-fill/", import.meta.url);
await mkdir(output, { recursive: true });

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  // Reach each place the way a player does: light the lamp, cross to the pond,
  // fetch the bell from the station and ring twice to reveal the clearing.
  for (const [place, plays] of [
    ["pond", ["lamp", "pond"]],
    [
      "clearing",
      ["lamp", "pond", "station", "bell", "pond", "bell", "bell", "clearing"],
    ],
  ]) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/card-game/text", async (route) => {
      const c = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          revision: c.revision,
          model: "stage-fill-fixture",
          entries: c.entities.map(({ id }) => ({ id, text: "Hm." })),
        }),
      });
    });
    const ready = async () => {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        if (await page.locator("#unveil-dialog[open]").count())
          await page.locator("#unveil-take").click();
        else if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
        await page.waitForTimeout(30);
      }
      throw Error("hand remained busy");
    };
    await page.goto(`${origin}/?table=stage-fill-${place}`);
    await page.locator('[data-card="lamp"]').waitFor({ state: "attached" });
    for (const id of plays) {
      await ready();
      await clearSelection(page);
      await selectCard(page, id);
      await page.locator("#card-actions .card-primary").click();
      await ready();
    }
    await clearSelection(page);
    assert.equal(await page.evaluate(() => document.body.dataset.place), place);
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".stage img")]
          .filter((image) => image.getClientRects().length > 0)
          .every((image) => image.complete && image.naturalWidth > 0),
      );
      await page.waitForTimeout(200);
      const m = await page.evaluate(() => {
        const box = (el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        };
        const resident = document.body.dataset.stage === "resident";
        const stage = box(document.querySelector("#stage"));
        const backdrop = resident
          ? document.querySelector("#stage-picture .backdrop")
          : document.querySelector("#backdrop");
        // What of the painting shows: clipped by its picture frame and the stage.
        const clip = resident
          ? box(document.querySelector("#stage-picture"))
          : stage;
        const b = box(backdrop);
        const visible = {
          left: Math.max(b.left, clip.left, stage.left),
          top: Math.max(b.top, clip.top, stage.top),
          right: Math.min(b.right, clip.right, stage.right),
          bottom: Math.min(b.bottom, clip.bottom, stage.bottom),
        };
        const figures = resident
          ? [document.querySelector("#resident-sprite")]
          : [...document.querySelectorAll("#cast .portrait img")].filter(
              (image) => image.getClientRects().length > 0,
            );
        return {
          resident,
          stage,
          visible,
          dock: box(document.querySelector(".play-dock")),
          dialogue: box(document.querySelector(".dialogue")),
          figures: figures.map(box),
        };
      });
      await page.screenshot({
        path: new URL(`${place}-${width}.png`, output).pathname,
      });
      const where = `${place} at ${width}x${height}`;
      assert.equal(m.resident, place === "clearing", where);
      // A hand that leaves part of the bottom edge open shows the painting
      // there; a full-width dock with the dialogue above it covers the rest.
      const open =
        m.dock.left > m.stage.left + 1 || m.dock.right < m.stage.right - 1;
      const floor = m.resident && !open ? m.dialogue.top : m.stage.bottom;
      assert(m.visible.left <= m.stage.left + 1, `${where}: backdrop left`);
      assert(m.visible.right >= m.stage.right - 1, `${where}: backdrop right`);
      assert(m.visible.top <= m.stage.top + 1, `${where}: backdrop top`);
      assert(
        m.visible.bottom >= floor - 1,
        `${where}: backdrop reaches ${floor}, ends at ${m.visible.bottom}`,
      );
      assert(m.figures.length > 0, `${where}: someone stands on the stage`);
      for (const figure of m.figures) {
        assert(figure.bottom > m.stage.top, `${where}: figure on stage`);
        assert(
          figure.bottom <= m.visible.bottom + 1,
          `${where}: figure cut at ${m.visible.bottom}, feet at ${figure.bottom}`,
        );
      }
    }
    assert.deepEqual(errors, [], place);
    await page.close();
  }
  console.log(
    "Stage fill smoke passed: Steam Clock and pond backdrops fill the stage with whole figures at 1440 and 390.",
  );
} finally {
  await browser.close();
  server.close();
}
