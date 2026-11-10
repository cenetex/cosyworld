// The dialogue is a depth stack of beats: the current beat in front, one
// earlier beat behind. Checks arrival in front, stepping back and forward in
// time, finishing a line with a tap, the live count, keys, and reduced motion
// at desktop and phone widths. See v2/docs/card-table/dialogue-beats.md.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  addLog,
  createWorld,
  encodeSave,
  holdChoice,
  legalActions,
  play,
} from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { SPEECH_OCCASIONS } from "../card-game/speech-occasions.mjs";
import {
  stackHits,
  selectCard,
  clearSelection,
  smokeWidths,
} from "./card-browser-helpers.mjs";

const itemReplies = SPEECH_OCCASIONS.includes("action");

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
// Every leaving copy is released when its motion ends: stepping back and
// forward many times leaves the page holding no more nodes than before.
// Chromium never freed a copy whose pictures were let go after it left.
async function nodesAfterSteps(page, stepBack, steps) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const nodes = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    const { metrics } = await cdp.send("Performance.getMetrics");
    return metrics.find((metric) => metric.name === "Nodes").value;
  };
  const step = async (move, speaker) => {
    await move();
    await page.waitForFunction(
      (speaker) =>
        document.querySelector("#speaker").textContent === speaker &&
        !document.querySelector(".beat-ghost, .beat-card[data-motion]"),
      speaker,
    );
  };
  const cycle = async () => {
    await step(stepBack, "Vale");
    await step(() => page.locator("#dialogue-advance").click(), "Pip");
  };
  await cycle();
  const start = await nodes();
  for (let i = 0; i < steps; i++) await cycle();
  const grown = (await nodes()) - start;
  await cdp.detach();
  return grown;
}
let fixture = enableMotives(createWorld({ opening: true, seed: 17 }));
// Stowing opens the mirror without a turn or spending Pip's first ask.
holdChoice(fixture, "vale", { item: null, revision: fixture.revision });
fixture = play(
  fixture,
  legalActions(fixture).find((a) => a.kind === "move" && a.target === "pond"),
).state;
fixture.items.bell.holder = "vale";
const save = encodeSave(fixture);
const npcFixture = structuredClone(fixture);
addLog(npcFixture, "Vale", "The lantern swings.", {
  actorId: "vale",
  entityId: "vale",
  locationId: "pond",
  kind: "dialogue",
  generated: true,
});
for (const verb of ["threaten", "guard"])
  addLog(npcFixture, "World", `Pip ${verb}s.`, {
    actorId: "moth",
    targetId: "vale",
    itemId: "lamp",
    verb,
    kind: "action",
    locationId: "pond",
    fromLocationId: "pond",
    witnesses: ["vale", "moth"],
  });
const npcSave = encodeSave(npcFixture);
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const lines = {
  vale: "Pip, wait. Will you tell me what you saw out on the water tonight?",
  moth: "I'm getting out of here before the lamp gutters. Ask me again by daylight.",
};
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  });
  await mkdir(output, { recursive: true });
  for (const width of smokeWidths([1440, 390]))
    for (const motion of ["no-preference", "reduce"]) {
      const key = `cosyworld.reflected-shore.v1.beat-${width}-${motion}`;
      const page = await browser.newPage({
        viewport: { width, height: width > 700 ? 900 : 844 },
        reducedMotion: motion,
      });
      page.setDefaultTimeout(20000);
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
      let itemReply = null;
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
              text:
                (id === "vale" && itemReply) ||
                lines[id] ||
                `${id} speaks on turn ${input.turn}.`,
            })),
          }),
        });
      });
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?table=beat-${width}-${motion}`,
      );
      const front = () => page.locator("#speaker").textContent();
      const words = () => page.locator("#dialogue-text").textContent();
      const readItemReply = async (action) => {
        await page.waitForFunction(
          (text) =>
            document.querySelector("#dialogue-text").textContent === text,
          itemReply,
        );
        assert.equal(await front(), "Vale");
        if (
          await page.locator('#dialogue-advance[data-revealing="true"]').count()
        )
          await page.locator("#dialogue-advance").click();
        assert.equal(
          await words(),
          itemReply,
          "The first tap finishes the item reply",
        );
        await page.locator("#beat-behind").evaluate((button) => button.click());
        assert.equal(
          await page.locator("#speech-row").getAttribute("data-beat"),
          "action",
        );
        assert.match(
          await page.locator("#beat-captions").textContent(),
          action,
        );
      };
      // Talk to Pip: Vale's beat arrives in front, then Pip's in front of it.
      await page.locator('#hand [data-card="moth"]').click();
      await page
        .locator('#card-actions .card-primary:not([data-revealing="true"])')
        .click();
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
        // Choosing a card keeps the writing speech in front.
        await page.evaluate(() =>
          document.querySelector('#hand [data-card="moth"]').click(),
        );
        assert.equal(await page.locator("#action-beat").isVisible(), false);
        assert.equal(
          await page
            .locator("#dialogue-advance")
            .getAttribute("data-revealing"),
          "true",
        );
        await page.keyboard.press("Escape");
        await page.locator("#dialogue-advance").click();
        assert.equal(await words(), lines.vale);
      }
      // Tapping the speaker portrait on a finished card moves the exchange on to Pip.
      await page.waitForFunction(
        () =>
          document.querySelector("#dialogue-advance").dataset.revealing ===
          "false",
      );
      if (motion === "reduce") {
        await page.waitForTimeout(3000);
        assert.equal(await words(), lines.vale);
      }
      await page.locator("#speaker-portrait").click();
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
      // peeking above the front card.
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
        };
      });
      assert(layout.narrower, "The card behind is smaller than the front.");
      assert(
        layout.peek > 12 && layout.peek <= 32,
        `One line of the card behind peeks out: ${layout.peek}`,
      );
      assert(layout.nameOnTop, "The speaker's name sits above the speech.");
      assert(layout.fullWidth, "The speech runs the card's full width.");
      assert(layout.wholeLine, "The front card shows the whole line.");
      if (width < 700) {
        // The peek, name row and two-line reply fit the fixed box.
        assert(
          layout.stack <= 100,
          `The phone stack stays compact: ${layout.stack}`,
        );
      }
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${output}/live-${width}-${motion}.png` });
      // Tap behind: back in time. Vale comes forward; the live count shows.
      // Vale's arrival at the pond opens this visit, as one action line
      // behind Vale's speech.
      const back = await watchStep(page, stepBack, `back-${width}-${motion}`, {
        front: true,
        behind: true,
      });
      // The arrival card behind shows its latest inscribed effect.
      assert.match(await behind.textContent(), /^\s*Vale\S/u);
      assert.equal(await front(), "Vale");
      assert.equal(await words(), lines.vale);
      assert(await page.locator("#live-line").isVisible());
      assert.match(
        await page.locator("#live-line").textContent(),
        /live\s*·\s*1/u,
      );
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${output}/back-${width}-${motion}.png` });
      // ↑ steps back to the arrival line, then stays put at the visit's
      // first beat while the stack has focus.
      await page.locator("#dialogue-advance").focus();
      await page.keyboard.press("ArrowUp");
      await page.waitForFunction(() =>
        /arrived from/u.test(
          document.querySelector("#beat-captions").textContent,
        ),
      );
      assert.equal(
        await page.locator("#speech-row").getAttribute("data-beat"),
        "action",
      );
      await page.keyboard.press("ArrowUp");
      await page.waitForTimeout(200);
      assert.match(
        await page.locator("#live-line").textContent(),
        /live\s*·\s*2/u,
        "Nothing lies before the first beat.",
      );
      // ↓ comes forward to live; step back to Vale again.
      await page.keyboard.press("ArrowDown");
      await page.waitForFunction(() =>
        /live\s*·\s*1/u.test(document.querySelector("#live-line").textContent),
      );
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
      const grown = await nodesAfterSteps(page, stepBack, 12);
      assert(grown < 60, `Leaving copies are released: ${grown} nodes kept`);
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
      // The item result keeps its own card behind any avatar reply.
      const beforeHold = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)),
        key,
      );
      await selectCard(page, "lamp");
      const afterHold = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)),
        key,
      );
      assert.equal(afterHold.actors.vale.heldItem, "lamp");
      assert.equal(afterHold.items.lamp.lit, true);
      assert.equal(afterHold.turn, beforeHold.turn);
      assert.deepEqual(
        afterHold.log,
        beforeHold.log,
        "holding makes no action beat",
      );
      await clearSelection(page);
      await selectCard(page, "bell");
      await selectCard(page, "pond");
      const actionFont = await page
        .locator('#card-actions [data-action="drop"]')
        .evaluate((button) => getComputedStyle(button).font);
      const dropReply = "I set the bell down beside the pond.";
      itemReply = dropReply;
      await page
        .locator(
          '#card-actions [data-action="drop"]:not([data-revealing="true"])',
        )
        .click();
      await page.keyboard.press("Escape");
      if (itemReplies) await readItemReply(/put down/u);
      else if (motion !== "reduce") {
        await page.locator("#beat-captions [data-primary].inscribe").waitFor();
        // A tap on the prior card goes Back even while the result is typing.
        await behind.evaluate((button) => button.click());
        assert.equal(await front(), "Pip");
        assert.equal(await words(), lines.moth);
        await page.locator("#live-line").click();
      }
      await page.waitForFunction(
        () =>
          /put down/u.test(
            document.querySelector("#beat-captions").textContent,
          ) && !document.querySelector(".inscribe"),
      );
      assert.equal(await front(), "Vale");
      assert.equal(
        await page.locator("#speech-row").getAttribute("data-beat"),
        "action",
      );
      assert.match(await behind.textContent(), /getting out of here/u);
      assert.equal(
        await page
          .locator("#beat-captions [data-primary]")
          .evaluate((caption) => getComputedStyle(caption).font),
        actionFont,
        "Ready and settled action captions share their font",
      );
      if (itemReplies) await page.locator("#live-line").click();
      // The front target finishes a new result in place; rereading keeps it whole.
      itemReply = "I pick the bell up again and look at Pip.";
      await clearSelection(page);
      await selectCard(page, "bell");
      await page
        .locator(
          '#card-actions [data-action="take"]:not([data-revealing="true"])',
        )
        .click();
      await page.keyboard.press("Escape");
      if (itemReplies) await readItemReply(/took/u);
      await page.waitForFunction(() =>
        /took/u.test(document.querySelector("#beat-captions").textContent),
      );
      if (motion !== "reduce" && !itemReplies) {
        await page.locator("#beat-captions [data-primary].inscribe").waitFor();
        await page.locator("#speech-row").evaluate((card) => card.click());
      }
      assert.match(
        await page.locator("#beat-captions").textContent(),
        /Vale took the Bell/u,
      );
      assert.equal(await page.locator("#beat-captions .inscribe").count(), 0);
      await behind.evaluate((button) => button.click());
      if (itemReplies) {
        assert.equal(await words(), dropReply);
        await behind.evaluate((button) => button.click());
      }
      assert.match(
        await page.locator("#beat-captions").textContent(),
        /put down/u,
      );
      assert.equal(await page.locator("#beat-captions .inscribe").count(), 0);
      await page.locator("#live-line").click();
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
      // A new game clears the stack: the panel fades out as a copy over
      // 200 ms, which is then released, instead of vanishing.
      assert.equal(await page.locator(".dialogue").isHidden(), false);
      const cleared = await page.evaluate(async () => {
        document.querySelector("#confirm-reset").click();
        const ghost = document.querySelector("body > .beat-ghost");
        const fade = ghost?.getAnimations()[0];
        await fade?.finished;
        return [fade?.effect.getTiming().duration, ghost?.isConnected];
      });
      assert.deepEqual(cleared, [200, false], "the cleared stack fades");
      assert.equal(await page.locator(".dialogue").isHidden(), true);
      // An NPC action uses the same main type and keeps face-down items unnamed.
      await page.evaluate(({ key, save }) => localStorage.setItem(key, save), {
        key,
        save: npcSave,
      });
      await page.reload();
      const npcCaption = page.locator("#beat-captions [data-primary]");
      await npcCaption.waitFor();
      assert.equal(await front(), "Pip");
      assert.equal(
        await npcCaption.textContent(),
        "Pip squared up to Vale over something.",
      );
      assert.equal(
        await page.locator("#beat-captions .beat-caption").count(),
        2,
      );
      assert.equal(
        await npcCaption.evaluate((caption) => getComputedStyle(caption).font),
        actionFont,
      );
      if (motion !== "reduce") {
        assert.equal(
          await page
            .locator("#dialogue-advance")
            .getAttribute("data-revealing"),
          "true",
        );
        await page.locator("#speech-row").evaluate((card) => card.click());
      }
      assert.equal(await page.locator("#beat-captions .inscribe").count(), 0);
      await behind.evaluate((button) => button.click());
      assert.equal(await words(), "The lantern swings.");
      await page.locator("#live-line").click();
      assert.equal(
        await npcCaption.textContent(),
        "Pip squared up to Vale over something.",
      );
      assert.equal(await page.locator("#beat-captions .inscribe").count(), 0);
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`beat stack ok at ${width} (${motion})`);
    }
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
