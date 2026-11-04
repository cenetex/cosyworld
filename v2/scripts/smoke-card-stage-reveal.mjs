// The stage shows only what its player has revealed (stage-reveal.mjs). A
// new world opens on Vale alone, on black: the lamp, the attic and anything
// else new lie face down in the hand and nowhere in the scene, and no
// unrevealed name shows. Tapping a card reveals it: the lamp fades into
// Vale's hand and the attic comes up out of the black, in either order.
//
//   node v2/scripts/smoke-card-stage-reveal.mjs [screenshot-dir]
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { profiles } from "../card-game/memory.mjs";
import { revealCard, smokeWidths } from "./card-browser-helpers.mjs";

const output = new URL(
  process.argv[2]
    ? `file://${process.argv[2].replace(/\/?$/u, "/")}`
    : "../../output/stage-reveal/",
  import.meta.url,
);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const width of smokeWidths([1440, 390]))
    for (const [order, reduced] of [
      [["lamp", "attic"], false],
      [["attic", "lamp"], true],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height: width === 390 ? 844 : 900 },
        reducedMotion: reduced ? "reduce" : "no-preference",
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/card-game/text", (route) => {
        const input = route.request().postDataJSON();
        return route.fulfill({
          json: {
            revision: input.revision,
            model: "stage-reveal-fixture",
            entries: input.entities.map(({ id }) => ({ id, text: "Awake." })),
          },
        });
      });
      const shot = async (name) => {
        if (reduced) return;
        await page.waitForTimeout(1100);
        await page.screenshot({
          path: new URL(`${name}-${width}.png`, output).pathname,
        });
      };
      // What the scene shows, and the names of the hand's face-down cards.
      const view = () =>
        page.evaluate(() => {
          const hand = [...document.querySelectorAll("#hand .card")];
          return {
            cast: [...document.querySelectorAll("#cast .portrait")].map(
              (el) => el.dataset.avatar,
            ),
            floor: document.querySelectorAll("#floor-items > *").length,
            held: [...document.querySelectorAll(".portrait-held-item")].length,
            black: document.getElementById("stage").dataset.placeCovered,
            down: hand
              .filter((el) => el.dataset.unrevealed === "true")
              .map((el) => el.dataset.card),
            text: document.body.innerText,
          };
        });
      const noLeaks = ({ down, text }) => {
        for (const id of down)
          assert.ok(
            !text.includes(profiles[id]?.name ?? "\u0000"),
            `${id} is face down but named`,
          );
      };

      await page.goto(`http://127.0.0.1:${server.address().port}/?intro=1`);
      // The new-world title; Escape goes straight in, on Vale's card.
      await page.waitForSelector('.title-intro[data-phase="ack"]');
      await page.keyboard.press("Escape");
      await page.waitForSelector(
        '#hand .card[data-card="vale"][data-unrevealed="false"]',
        { state: "attached" },
      );
      await page.waitForSelector('#cast .portrait[data-avatar="vale"]', {
        state: "attached",
      });
      let seen = await view();
      assert.deepEqual(seen.cast, ["vale"]);
      assert.equal(seen.black, "true");
      assert.equal(seen.floor, 0);
      assert.equal(seen.held, 0);
      for (const id of ["lamp", "attic"]) assert.ok(seen.down.includes(id));
      noLeaks(seen);
      await shot("01-opening-vale-alone");

      // Either order: each tap reveals one thing into the scene.
      for (const [step, id] of order.entries()) {
        await revealCard(page, id);
        await page.waitForSelector(
          `#hand .card[data-card="${id}"][data-unrevealed="false"]`,
        );
        seen = await view();
        assert.deepEqual(seen.cast, ["vale"]);
        if (id === "lamp") assert.equal(seen.held, 1, "the lamp in his hand");
        if (id === "attic") assert.equal(seen.black, "false");
        noLeaks(seen);
        await shot(`0${step + 2}-revealed-${id}`);
      }
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`Stage reveal: ${width}px, ${order.join(" then ")} passed.`);
    }
} finally {
  await browser?.close();
  server.close();
}
