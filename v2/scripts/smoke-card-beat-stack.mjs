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
import { stackHits } from "./card-browser-helpers.mjs";

const output = process.env.BEAT_STACK_OUTPUT || "output/beat-stack";
// Set to save start, middle and end frames of each step.
const frames = process.env.BEAT_MOTION_FRAMES;
// Step the stack and watch every frame of the move: the stack and the front
// card keep their layout box, and the leaving card fades as a copy. Once it
// settles, the front card takes clicks, and so does the card behind unless
// the front is the visit's first beat (`behind: null`).
async function watchStep(
  page,
  step,
  name,
  hits = { front: true, behind: true },
) {
  await page.waitForFunction(
    () => !document.querySelector(".beat-ghost, .beat-card[data-motion]"),
  );
  await page.evaluate(() => {
    const stack = document.querySelector(".beat-stack"),
      front = document.querySelector("#speech-row");
    const box = () => [
      stack.offsetHeight,
      front.offsetTop,
      front.offsetWidth,
      front.offsetHeight,
      document.querySelector("#dialogue-text").offsetHeight,
    ];
    window.stepWatch = { boxes: [], motions: new Set(), ghosts: 0 };
    let frame = 0;
    const sample = () => {
      const watch = window.stepWatch;
      watch.start ||= Boolean(stack.querySelector(".beat-ghost"));
      if (watch.start) watch.boxes.push(box().join());
      if (front.dataset.motion) watch.motions.add(front.dataset.motion);
      watch.ghosts = Math.max(
        watch.ghosts,
        stack.querySelectorAll(".beat-ghost").length,
      );
      if (frame++ < 40) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await step();
  if (frames) {
    // Hold the move still to photograph its start, middle and end.
    for (const [at, ms] of [
      ["start", 0],
      ["mid", 120],
      ["end", 280],
    ]) {
      await page.evaluate((ms) => {
        for (const run of document.querySelector(".beat-stack").getAnimations({
          subtree: true,
        })) {
          run.pause();
          run.currentTime = Math.min(ms, run.effect.getTiming().duration - 1);
        }
      }, ms);
      await page.screenshot({
        path: `${frames}/${name}-${at}.png`,
        clip: await page.locator(".beat-stack").evaluate((stack) => {
          const box = stack.getBoundingClientRect();
          return {
            x: Math.max(0, box.left - 16),
            y: Math.max(0, box.top - 60),
            width: Math.min(innerWidth, box.width + 32),
            height: box.height + 90,
          };
        }),
      });
    }
    await page.evaluate(() => {
      for (const run of document
        .querySelector(".beat-stack")
        .getAnimations({ subtree: true }))
        if (run.effect.getTiming().iterations === 1) run.finish();
    });
  }
  await page.waitForTimeout(800);
  const watch = await page.evaluate(() => ({
    boxes: [...new Set(window.stepWatch.boxes)],
    motions: [...window.stepWatch.motions],
    ghosts: window.stepWatch.ghosts,
    left: document.querySelectorAll(".beat-ghost, .beat-card[data-motion]")
      .length,
  }));
  assert.equal(watch.boxes.length, 1, `${name}: no layout jump ${watch.boxes}`);
  assert.equal(watch.left, 0, `${name}: the move settles`);
  assert.deepEqual(
    await stackHits(page),
    hits,
    `${name}: the cards take clicks`,
  );
  return watch;
}
let fixture = enableMotives(createWorld({ opening: true }));
// The opening starts lit: douse it to open the mirror (#1653). Relighting it
// at the pond would spend Pip's ask for the lamp before the talk.
for (const kind of ["snuff", "move"])
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
          addEventListener("DOMContentLoaded", () =>
            new MutationObserver((changes) => {
              for (const { target } of changes)
                if (target.dataset.motion)
                  window.stackMotion.push(target.dataset.motion);
            }).observe(document.querySelector(".beat-stack"), {
              attributes: true,
              subtree: true,
              attributeFilter: ["data-motion"],
            }),
          );
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
      // The earlier beat is a card behind, with the speech on one line
      // peeking above the front card. The action sits under the speech.
      // Phones keep both inside the fixed box over the hand (#1897).
      const behind = page.locator("#beat-behind");
      const stepBack = () => behind.click({ position: { x: 80, y: 6 } });
      assert(await behind.isVisible(), "An earlier beat waits behind.");
      assert.match(await behind.textContent(), /Vale\s*Pip, wait\./u);
      assert.equal(await page.locator("#live-line").isVisible(), false);
      const layout = await page.evaluate(() => {
        const box = (selector) =>
          document.querySelector(selector).getBoundingClientRect();
        const back = box("#beat-behind"),
          card = box("#speech-row"),
          text = box("#dialogue-text"),
          name = box("#speaker"),
          caption = box("#beat-captions"),
          words = document.querySelector("#dialogue-text");
        return {
          nameOnTop: name.height > 0 && name.bottom <= text.top + 1,
          fullWidth: text.left - card.left < 24 && card.right - text.right < 24,
          wholeLine: [words, document.querySelector("#dialogue-advance")].every(
            (box) => box.scrollHeight <= box.clientHeight + 1,
          ),
          peek: card.top - back.top,
          narrower: back.width < card.width,
          stack: card.bottom - back.top,
          captionBelow: caption.top >= text.bottom - 1,
          captionLines: Math.round(
            caption.height /
              parseFloat(
                getComputedStyle(document.querySelector(".beat-caption"))
                  .lineHeight,
              ),
          ),
        };
      });
      assert(layout.narrower, "The card behind is smaller than the front.");
      assert(
        layout.peek > 12 && layout.peek <= 32,
        `One line of the card behind peeks out: ${layout.peek}`,
      );
      assert(layout.captionBelow, "The action caption sits under the speech.");
      assert(layout.nameOnTop, "The speaker's name sits above the speech.");
      assert(layout.fullWidth, "The speech runs the card's full width.");
      assert(layout.wholeLine, "The front card shows the whole line.");
      if (width < 700) {
        assert.equal(layout.captionLines, 1, "The phone caption is one line.");
        // The peek, name row, a two-line reply and one caption line, in
        // the fixed box.
        assert(
          layout.stack <= 100,
          `The phone stack stays compact: ${layout.stack}`,
        );
      }
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${output}/live-${width}-${motion}.png` });
      // Tap behind: back in time. Vale comes forward; the live count shows.
      // Vale's line opens this visit to the pond: the first quest waits for
      // the pond (#1768), so no earlier beat is left to sit behind it.
      const back = await watchStep(page, stepBack, `back-${width}-${motion}`, {
        front: true,
        behind: null,
      });
      assert.equal(await front(), "Vale");
      assert.equal(await words(), lines.vale);
      assert(await page.locator("#live-line").isVisible());
      assert.match(
        await page.locator("#live-line").textContent(),
        /live\s*·\s*1/u,
      );
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${output}/back-${width}-${motion}.png` });
      // ↑ at the visit's first beat stays put while the stack has focus.
      await page.locator("#dialogue-advance").focus();
      await page.keyboard.press("ArrowUp");
      await page.waitForTimeout(200);
      assert.equal(
        await front(),
        "Vale",
        "Nothing lies before the first beat.",
      );
      assert.match(
        await page.locator("#live-line").textContent(),
        /live\s*·\s*1/u,
      );
      // ↓ comes forward to live; step back to Vale again.
      await page.keyboard.press("ArrowDown");
      await page.waitForFunction(
        () => document.querySelector("#speaker").textContent === "Pip",
      );
      assert.equal(await page.locator("#live-line").isVisible(), false);
      await page.waitForFunction(
        () => !document.querySelector(".beat-ghost, .beat-card[data-motion]"),
      );
      await stepBack();
      await page.waitForFunction(
        () => document.querySelector("#speaker").textContent === "Vale",
      );
      await page.waitForFunction(
        () => !document.querySelector(".beat-ghost, .beat-card[data-motion]"),
      );
      // Tap front: forward in time, back to live.
      const forward = await watchStep(
        page,
        () => page.locator("#dialogue-advance").click(),
        `forward-${width}-${motion}`,
      );
      assert.equal(await front(), "Pip");
      // Both directions fade the leaving card out as an inert copy.
      assert.deepEqual(
        [back.motions, forward.motions],
        motion === "reduce" ? [[], []] : [["return"], ["arrive"]],
      );
      assert(back.ghosts > 0 && forward.ghosts > 0, "The old card fades.");
      assert.equal(await page.locator("#live-line").isVisible(), false);
      // ● live returns from any depth.
      await stepBack();
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
      // Cards move by named CSS motions; only the leaving ghost uses frames.
      const depth = ["arrive", "return", "recede", "emerge"];
      if (motion === "reduce")
        assert(
          motionFrames.every(
            (step) => !depth.includes(step) && !step.includes("transform"),
          ),
          `Reduced motion crossfades only: ${motionFrames}`,
        );
      else
        assert(
          motionFrames.some((step) => depth.includes(step)),
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
