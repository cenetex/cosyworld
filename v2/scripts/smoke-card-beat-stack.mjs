// The dialogue is a depth stack of beats: the current beat in front, one
// earlier beat behind. Checks arrival in front, stepping back and forward in
// time, finishing a line with a tap, the live count, keys, and reduced motion
// at desktop and phone widths. See v2/docs/card-table/dialogue-beats.md.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  createWorld,
  encodeSave,
  legalActions,
  play,
} from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";

const output = process.env.BEAT_STACK_OUTPUT || "output/beat-stack";
let fixture = enableMotives(createWorld({ opening: true }));
for (const kind of ["light", "move"])
  fixture = play(
    fixture,
    legalActions(fixture).find(
      (a) => a.kind === kind && (kind !== "move" || a.target === "pond"),
    ),
  ).state;
const save = encodeSave(fixture);
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const lines = {
  vale: "Pip, wait. Will you tell me what you saw out on the water tonight?",
  moth: "I'm getting out of here before the lamp gutters. Ask me again by daylight.",
};
let browser;
try {
  browser = await chromium.launch({ headless: true });
  await mkdir(output, { recursive: true });
  for (const width of [1440, 390])
    for (const motion of ["no-preference", "reduce"]) {
      const key = `cosyworld.reflected-shore.v1.beat-${width}-${motion}`;
      const page = await browser.newPage({
        viewport: { width, height: width > 700 ? 900 : 844 },
        reducedMotion: motion,
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(
        ({ key, save }) => {
          if (!localStorage.getItem(key)) localStorage.setItem(key, save);
          localStorage.setItem(
            `${key}.seen`,
            JSON.stringify(["vale", "moth", "keeper", "lamp", "attic", "pond"]),
          );
          // Record the stack's motion so reduced motion can be checked.
          window.stackMotion = [];
          const animate = Element.prototype.animate;
          Element.prototype.animate = function (frames, options) {
            if (this.closest?.(".beat-stack"))
              window.stackMotion.push(JSON.stringify(frames));
            return animate.call(this, frames, options);
          };
        },
        { key, save },
      );
      await page.route("**/card-game/text", async (route) => {
        const input = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            revision: input.revision,
            model: "browser-fixture",
            entries: input.entities.map(({ id }) => ({
              id,
              text: lines[id] || `${id} speaks on turn ${input.turn}.`,
            })),
          }),
        });
      });
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?table=beat-${width}-${motion}`,
      );
      const front = () => page.locator("#speaker").textContent();
      const words = () => page.locator("#dialogue-text").textContent();
      // Talk to Pip: Vale's beat arrives in front, then Pip's in front of it.
      await page.locator('#hand [data-card="moth"]').click();
      await page.locator("#card-actions .card-primary").click();
      await page
        .waitForFunction(
          () => document.querySelector("#dialogue-text").textContent.length > 0,
        )
        .catch(async (error) => {
          await page.screenshot({
            path: `${output}/failed-${width}-${motion}.png`,
          });
          console.log(
            await page.evaluate(() => [
              document.querySelector("#speaker").textContent,
              document.querySelector(".dialogue").outerHTML.slice(0, 3000),
            ]),
          );
          throw error;
        });
      assert.equal(await front(), "Vale");
      if (motion !== "reduce") {
        // A tap on the front card finishes the line being written.
        assert.equal(
          await page
            .locator("#dialogue-advance")
            .getAttribute("data-revealing"),
          "true",
        );
        await page.locator("#dialogue-advance").click();
        assert.equal(await words(), lines.vale);
      }
      // Tapping a finished front card moves the exchange on to Pip.
      await page.waitForFunction(
        () =>
          document.querySelector("#dialogue-advance").dataset.revealing ===
          "false",
      );
      await page.locator("#dialogue-advance").click();
      await page.waitForFunction(
        () => document.querySelector("#speaker").textContent === "Pip",
      );
      await page.locator("#dialogue-advance").click();
      await page.waitForFunction(
        (text) => document.querySelector("#dialogue-text").textContent === text,
        lines.moth,
      );
      await page.waitForFunction(
        () => document.querySelector("#hand").dataset.cooling === "false",
      );
      // The earlier beat peeks behind, with the speech on one line.
      const behind = page.locator("#beat-behind");
      assert(await behind.isVisible(), "An earlier beat waits behind.");
      assert.match(await behind.textContent(), /Vale\s*Pip, wait\./u);
      assert.equal(await page.locator("#live-line").isVisible(), false);
      if (width < 700) {
        const box = await behind.boundingBox();
        assert(
          box.height <= 32,
          `The phone behind card is one line: ${box.height}`,
        );
        const stack = await page.evaluate(() => {
          const a = document
            .querySelector("#beat-behind")
            .getBoundingClientRect();
          const b = document
            .querySelector("#speech-row")
            .getBoundingClientRect();
          return b.bottom - a.top;
        });
        // No taller than the old dialogue box with the same two-line reply.
        assert(stack <= 90, `The phone stack stays compact: ${stack}`);
      }
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${output}/live-${width}-${motion}.png` });
      // Tap behind: back in time. Vale comes forward; the live count shows.
      await behind.click();
      await page.waitForFunction(
        () => document.querySelector("#speaker").textContent === "Vale",
      );
      assert.equal(await words(), lines.vale);
      assert(await page.locator("#live-line").isVisible());
      assert.match(
        await page.locator("#live-line").textContent(),
        /live\s*·\s*1/u,
      );
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${output}/back-${width}-${motion}.png` });
      // ↑ steps further back while the stack has focus; ↓ comes forward.
      const before = await page.locator("#live-line").textContent();
      await page.locator("#dialogue-advance").focus();
      await page.keyboard.press("ArrowUp");
      const deeper = await page.locator("#live-line").textContent();
      if (deeper !== before) {
        assert.match(deeper, /·\s*2/u);
        await page.keyboard.press("ArrowDown");
        await page.waitForFunction(() =>
          /·\s*1/u.test(document.querySelector("#live-line").textContent),
        );
      }
      // Tap front: forward in time, back to live.
      await page.locator("#dialogue-advance").click();
      await page.waitForFunction(
        () => document.querySelector("#speaker").textContent === "Pip",
      );
      assert.equal(await page.locator("#live-line").isVisible(), false);
      // ● live returns from any depth.
      await behind.click();
      await page.locator("#live-line").click();
      await page.waitForFunction(
        () => document.querySelector("#speaker").textContent === "Pip",
      );
      assert.equal(await page.locator("#live-line").isVisible(), false);
      // A play leaves focus with the hand.
      assert.equal(
        await page.locator("#previous-line, #next-line").count(),
        0,
        "No previous and next arrows.",
      );
      const motionFrames = await page.evaluate(() => window.stackMotion);
      assert(motionFrames.length > 0, "The stack moved.");
      if (motion === "reduce")
        assert(
          motionFrames.every((frames) => !frames.includes("transform")),
          `Reduced motion crossfades only: ${motionFrames.find((f) => f.includes("transform"))}`,
        );
      else
        assert(
          motionFrames.some((frames) => frames.includes("transform")),
          "Cards move in depth.",
        );
      // Memory holds the same beats, opened on purpose.
      await page.evaluate(() =>
        document.querySelector("#history-button").click(),
      );
      const memory = await page.locator("#messages").innerText();
      assert.match(memory, /Pip, wait\./u);
      assert.match(memory, /getting out of here/u);
      await page.screenshot({
        path: `${output}/memory-${width}-${motion}.png`,
      });
      await page.locator('[data-close="history-dialog"]').click();
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`beat stack ok at ${width} (${motion})`);
    }
} finally {
  await browser?.close();
  server.close();
}
