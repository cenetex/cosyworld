// The stage shows only what its player has revealed (stage-reveal.mjs). A
// new world opens on Vale alone, on black: the lamp, the attic and anything
// else new lie face down in the hand and nowhere in the scene, and no
// unrevealed name shows. Tapping a card reveals it: the lamp fades into
// Vale's hand and the attic comes up out of the black, in either order.
// Then the opening's first play, Put out, darkens the room and the pond
// arrives face down (opening.mjs).
//
//   node v2/scripts/smoke-card-stage-reveal.mjs [screenshot-dir]
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { profiles } from "../card-game/memory.mjs";
import {
  revealCard,
  selectCard,
  smokeWidths,
} from "./card-browser-helpers.mjs";

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
      page.setDefaultTimeout(20000);
      const errors = [];
      let openingRoute = null;
      const openings = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/card-game/text", (route) => {
        const input = route.request().postDataJSON();
        if (input.waking) {
          openings.push(input);
          if (reduced) {
            openingRoute = route;
            return;
          }
        }
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
            buttons: [...document.querySelectorAll("#card-actions button")]
              .filter((el) => el.checkVisibility())
              .map((el) => el.textContent),
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
      await page.waitForTimeout(100);
      assert.equal(
        openings.length,
        1,
        "the avatar wakes while the room is black",
      );
      assert.deepEqual(openings[0].speakers, ["vale"]);
      assert.deepEqual(openings[0].covered, ["attic"]);
      assert.equal(openings[0].scenery, false);
      assert.ok(!openings[0].entities.some(({ id }) => id === "lamp"));
      if (!reduced) {
        await page.waitForFunction(() =>
          document
            .querySelector("#dialogue-text")
            ?.textContent.includes("Awake."),
        );
        assert.equal((await view()).black, "true");
      }
      await shot("01-opening-vale-alone");

      // Either order: each tap reveals one thing into the scene.
      for (const [step, id] of order.entries()) {
        // The quiet Reveal button turns the last card down as a tap does.
        if (step === 1 && reduced) {
          if ((await page.locator("#hand [aria-pressed=true]").count()) === 0)
            await selectCard(page, "vale");
          await page
            .locator('#card-actions [data-quiet="true"]', { hasText: "Reveal" })
            .click();
        } else await revealCard(page, id);
        await page.waitForSelector(
          `#hand .card[data-card="${id}"][data-unrevealed="false"]`,
        );
        seen = await view();
        assert.deepEqual(seen.cast, ["vale"]);
        if (id === "lamp") assert.equal(seen.held, 1, "the lamp in his hand");
        if (id === "attic") assert.equal(seen.black, "false");
        // The opening offers no play while a card is down (opening.mjs).
        if (step === 0) assert.ok(!seen.buttons.some((b) => b !== "Reveal"));
        noLeaks(seen);
        await shot(`0${step + 2}-revealed-${id}`);
      }
      // Then its first real play: Put out darkens the room, and the card
      // the rules bring arrives face down, nowhere on stage.
      const putOut = page.locator('#card-actions [data-action="snuff"]');
      await putOut.waitFor();
      await shot("04-put-out-offered");
      await putOut.click();
      if (reduced) {
        // Keep generation beyond the hand's grace, then queue Put out.
        // The waking line belongs to turn zero even when the player moves on.
        await page.waitForTimeout(3200);
        assert.equal(
          await page.evaluate(
            () =>
              JSON.parse(localStorage.getItem("cosyworld.reflected-shore.v1"))
                .turn,
          ),
          0,
        );
        await openingRoute.fulfill({
          json: {
            revision: openings[0].revision,
            model: "stage-reveal-fixture",
            entries: openings[0].entities.map(({ id }) => ({
              id,
              text: "Awake.",
            })),
          },
        });
      }
      await page.waitForFunction(
        () => document.body.dataset.lamplit === "false",
      );
      // The pond, the attic's one way on, lies face down at the row's right
      // end (#2272).
      await page.waitForSelector(
        '#hand > .card-frame:last-child > .card[data-card="pond"][data-unrevealed="true"]',
      );
      seen = await view();
      assert.deepEqual(seen.cast, ["vale"]);
      assert.equal(seen.floor, 0);
      noLeaks(seen);
      const words = await page.evaluate(() =>
        JSON.parse(
          localStorage.getItem("cosyworld.reflected-shore.v1"),
        ).log.filter((entry) => entry.generated && entry.kind === "dialogue"),
      );
      assert.ok(
        words.some((entry) => entry.turn === 0 && entry.text === "Awake."),
      );
      assert.equal(openings.length, 1);
      await shot("05-room-dark-new-card");
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`Stage reveal: ${width}px, ${order.join(" then ")} passed.`);
    }
  for (const width of smokeWidths([1440, 390]))
    for (const failed of [false, true]) {
      const page = await browser.newPage({
        viewport: { width, height: width === 390 ? 844 : 900 },
        reducedMotion: "reduce",
      });
      page.setDefaultTimeout(20000);
      const key = "cosyworld.reflected-shore.v1.title-free";
      let requests = 0;
      await page.route("**/card-game/text", (route) => {
        requests++;
        const input = route.request().postDataJSON();
        return route.fulfill({
          status: failed ? 400 : 200,
          json: failed
            ? { error: "Opening fixture unavailable." }
            : {
                revision: input.revision,
                model: "stage-reveal-fixture",
                entries: input.entities.map(({ id }) => ({
                  id,
                  text: "Awake.",
                })),
              },
        });
      });
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?table=title-free`,
      );
      await revealCard(page, "vale");
      await page.waitForFunction(
        ({ key, failed }) =>
          failed
            ? localStorage.getItem(`${key}.words-failed`) === "0"
            : JSON.parse(localStorage.getItem(key)).log.some(
                (entry) => entry.generated && entry.kind === "dialogue",
              ),
        { key, failed },
      );
      assert.equal(
        await page.locator("#stage").getAttribute("data-place-covered"),
        "true",
      );
      assert.equal(requests, 1);
      await page.reload();
      await page.waitForSelector(
        '#hand [data-card="vale"][data-unrevealed="false"]',
      );
      await page.waitForTimeout(400);
      assert.equal(requests, 1, "reload keeps the completed opening outcome");
      await page.close();
      console.log(
        `Title-free opening: ${width}px, ${failed ? "failed" : "spoken"} reload passed.`,
      );
    }
} finally {
  await browser?.close();
  server.close();
}
