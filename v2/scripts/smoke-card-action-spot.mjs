// A ready play is a beat in front of the dialogue: what the play will do,
// as one tap target. The spoken beat fades behind it, nothing sits between
// the dialogue and the hand, and the hand never moves for it. Vale takes the
// Burial Decree at the Theban Palace Forecourt (one "the" in the caption)
// and offers it to Creon.
import { readyActionButton, selectCard } from "./card-browser-helpers.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { cardLevel, levelTier } from "../card-game/rarity.mjs";

async function naturalItemRatio(image) {
  await image.waitFor({ state: "visible" });
  await image.evaluate((img) => img.decode());
  const size = await image.evaluate((img) => ({
    natural: img.naturalWidth / img.naturalHeight,
    shown: parseFloat(getComputedStyle(img).width) / parseFloat(getComputedStyle(img).height),
  }));
  assert(Math.abs(size.shown - size.natural) < 0.01,
    `item ratio ${size.shown} matches source ${size.natural}`);
}

const output = new URL("../../output/action-spot/", import.meta.url);
await mkdir(output, { recursive: true });
const world = createWorld();
world.actors.vale.place = "greek-palace";
world.items["greek-decree"].holder = "greek-palace";
// Creon is Rare, so a play with him edges its box in his tier's colour.
world.actors["greek-creon"].level = 25;
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
  for (const [width, height, motion = "no-preference"] of [
    [1440, 900],
    [1900, 1000],
    [765, 760],
    [390, 844],
    [390, 844, "reduce"],
    [844, 390, "reduce"],
  ]) {
    const name = `${width}-${motion}`;
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: motion,
    });
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // An occupied seat lets the menu borrow the beat without changing the
    // chosen hand or leaving this local table.
    await page.route("**/auth/account", (route) =>
      route.fulfill({ json: { authenticated: true } }),
    );
    await page.route(/\/card-game\/shared\/worlds$/, (route) =>
      route.fulfill({
        json: {
          worlds: [
            {
              id: "spare",
              owner: true,
              actor: null,
              held: [0, 1, 0, 0, 0, 0, 0, 0],
              seed: 2,
            },
          ],
        },
      }),
    );
    // Hold each reply until released, so the pending play can be seen.
    let holding = false;
    const heldReplies = new Set();
    const holdReply = () => {
      holding = true;
      const response = page.waitForResponse("**/card-game/text");
      return async () => {
        holding = false;
        for (const release of heldReplies) release();
        const reply = await response;
        assert.equal(await reply.finished(), null, "fixture reply completed");
        return reply.request().postDataJSON();
      };
    };
    await page.route("**/card-game/text", async (route) => {
      const c = route.request().postDataJSON();
      if (holding) {
        await new Promise((resolve) => {
          const release = () => {
            heldReplies.delete(release);
            resolve();
          };
          heldReplies.add(release);
        });
      }
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
    const key = `cosyworld.reflected-shore.v1.action-spot-${name}`;
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
    const settled = () =>
      page.waitForFunction(
        () => !document.querySelector(".beat-ghost, .beat-card[data-motion]"),
      );
    // The action beat sits in front of the dialogue and takes the taps; the
    // spoken beat, if any, peeks dimmed above it; the dock holds no row.
    async function actionBeat(label) {
      await settled();
      const beat = await page.evaluate(() => {
        const panel = document.querySelector(".action-panel"),
          front = document.querySelector("#speech-row"),
          button = panel.querySelector(".card-primary"),
          p = panel.getBoundingClientRect(),
          b = button.getBoundingClientRect(),
          f = front.getBoundingClientRect(),
          hit = document.elementFromPoint(
            (b.left + b.right) / 2,
            (b.top + b.bottom) / 2,
          );
        return {
          inDialogue: Boolean(panel.closest(".dialogue")),
          dockRow: document.querySelector(".play-dock .action-panel"),
          caption: button.textContent,
          tier: panel.dataset.tier,
          edge: getComputedStyle(panel).borderTopColor,
          cards: panel.querySelectorAll(
            ".action-beat-cards img:not(.quest-ground)",
          ).length,
          // Square-ish, as the beat cards are: no pill.
          corner: parseFloat(getComputedStyle(button).borderTopLeftRadius),
          buttonInside: b.top >= p.top && b.bottom <= p.bottom + 1,
          takesTaps: button.contains(hit),
          spoken: !front.hidden,
          peek: p.top - f.top,
          dim: Number(getComputedStyle(front).opacity),
          frontTaps: front.contains(
            document.elementFromPoint((f.left + f.right) / 2, f.top + 4),
          ),
        };
      });
      assert(beat.inDialogue && !beat.dockRow, `${label}: a dialogue beat`);
      assert(beat.buttonInside, `${label}: its button is inside it`);
      assert(beat.takesTaps, `${label}: its button takes taps`);
      assert(beat.corner <= 8, `${label}: a ${beat.corner}px corner`);
      if (beat.spoken) {
        assert(beat.peek > 12 && beat.peek <= 32, `${label}: ${beat.peek}`);
        assert(beat.dim < 1, `${label}: the spoken beat is dimmed`);
        assert(beat.frontTaps, `${label}: its peeking line takes taps`);
      }
      return beat;
    }
    // Every card's frame reaches the screen's foot: nothing cuts it short.
    async function handUncut() {
      const handBottom = (await box("#hand")).bottom;
      assert(handBottom >= height - 2, `hand ends at ${handBottom}`);
    }
    const shot = (state) =>
      page.screenshot({
        path: new URL(`${state}-${name}.png`, output).pathname,
      });
    const port = server.address().port;
    const openingReply = holdReply();
    await page.goto(`http://127.0.0.1:${port}/?table=action-spot-${name}`);
    await page
      .locator('#hand [data-card="greek-decree"]')
      .waitFor({ state: "attached" });
    await openingReply();
    await page.waitForTimeout(800);
    await handUncut();
    await shot("idle");

    await selectCard(page, "greek-decree");
    await readyActionButton(page).waitFor();
    await page.waitForFunction(() =>
      !document.querySelector("#hand").getAnimations({ subtree: true }).some((animation) =>
        animation.playState === "running" && Number.isFinite(animation.effect?.getComputedTiming().endTime)),
    );
    const restHand = await box("#hand"),
      restDialogue = await box(".dialogue");
    const taking = await actionBeat("take");
    assert.match(taking.caption, /^\s*Vale takes the Burial Decree/u);
    assert.equal(taking.cards, 2, "Vale and the decree");
    // The decree is the rarest card in the take, so its tier edges the box.
    assert.equal(taking.tier, levelTier(cardLevel(world, "greek-decree")).id);
    // Selecting raised the hand; the beat appearing moves nothing more.
    await page.waitForTimeout(300);
    assert.deepEqual(await box("#hand"), restHand, "hand stays put");
    assert.deepEqual(await box(".dialogue"), restDialogue, "dialogue stays");
    await handUncut();
    await shot("ready");
    await naturalItemRatio(page.locator(".action-beat-cards .quest-thing"));
    const takingReply = holdReply();
    await page
      .locator('#card-actions .card-primary:not([data-revealing="true"])')
      .click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".beat-caption, .dialogue")].some((e) =>
        /took the Burial Decree/.test(e.textContent),
      ),
    );
    const captions = await page.locator(".dialogue").innerText();
    assert(!/the the/i.test(captions), captions);
    await takingReply();
    await page.waitForTimeout(600);
    // Taking keeps the same decree chosen and rests the committed play.
    // Opening a menu beat is an arrival, with no outgoing action to fold.
    await settled();
    const panel = page.locator(".action-panel");
    assert(await panel.isHidden(), `${name}: the taken play is at rest`);
    assert(await page.locator("#speech-row").isVisible());
    await page.locator("#beat-behind").click({ position: { x: 24, y: 6 } });
    await settled();
    assert(
      await page
        .locator('#speaker-portrait .quest-thing[data-entity="greek-decree"]')
        .isVisible(),
      `${name}: the taken decree stays in the action art`,
    );
    await shot("taken");
    await naturalItemRatio(page.locator("#speaker-portrait .quest-thing"));
    await page.locator("#live-line").click();
    await settled();
    await page.locator("#toolbar-menu-button").click();
    await page
      .locator('#world-menu [data-slot="spare"] [data-avatar="mara"] button')
      .click();
    await settled();
    assert(await panel.isVisible(), `${name}: the borrowed beat arrives`);
    assert.equal(await panel.getAttribute("data-avatar"), "mara");
    assert.match(await panel.innerText(), /Mara\nSomeone · Exploring /);
    assert.deepEqual(errors, [], `${name}: borrowing after play is safe`);
    await page.locator("#toolbar-menu-button").click();
    await panel.waitFor({ state: "hidden" });
    await settled();
    assert(await panel.isHidden(), `${name}: closing restores the rest`);
    await page.keyboard.press("Escape");
    await selectCard(page, "greek-decree");
    await selectCard(page, "greek-creon");
    const give = page.locator("#card-actions .card-primary");
    await readyActionButton(page).waitFor();
    assert.match(await give.getAttribute("aria-label"), /Give/);
    const offering = await actionBeat("give");
    assert.equal(offering.cards, 3, "Vale, the decree and Creon");
    assert(offering.spoken, "the spoken beat waits behind the offer");
    assert.equal(offering.tier, taking.tier, "the decree outranks Rare Creon");
    await handUncut();
    await shot("ready-dialogue");
    const givingReply = holdReply();
    await give.and(page.locator(':not([data-revealing="true"])')).click();
    await page.waitForTimeout(150);
    await handUncut();
    await shot("pending");
    const given = await givingReply();
    // Receiving the response is not the same as reading its dialogue. Wait
    // for this turn's words, then advance them as a player before choosing
    // Creon; choosing early deliberately holds the last reply for Continue.
    await page.waitForFunction(
      ({ key, turn }) => {
        const saved = JSON.parse(localStorage.getItem(key));
        return saved.log.some((entry) => entry.generated && entry.turn === turn);
      },
      { key, turn: given.turn },
    );
    assert.equal(
      await page.evaluate((key) =>
        JSON.parse(localStorage.getItem(key)).items["greek-decree"].holder,
      key),
      "greek-creon",
      "Give committed before returning to Talk",
    );
    for (let step = 0; step < 100; step++) {
      if (await page.locator('#hand[data-cooling="false"]').count()) break;
      const advance = page.locator(
        '#dialogue-advance:is([aria-label="Finish reading"], [aria-label="Continue to the next beat"])',
      );
      if (await advance.isVisible()) await advance.click();
      await page.waitForTimeout(40);
    }
    await page.locator('#hand[data-cooling="false"]').waitFor();
    await handUncut();
    // The peeking beat is Back. Live returns to the same ready action.
    await page.keyboard.press("Escape");
    await selectCard(page, "greek-creon");
    await readyActionButton(page, "talk").waitFor();
    await actionBeat("talk");
    const speech = page.locator("#speech-row");
    const words = await page.locator("#dialogue-text").textContent();
    await speech.click({ position: { x: 36, y: 6 } });
    await panel.waitFor({ state: "hidden" });
    assert.equal(await page.locator("#dialogue-text").textContent(), words);
    const live = page.locator("#live-line");
    assert.match(await live.innerText(), /live\s*·\s*1/u);
    await live.click();
    await panel.waitFor();
    assert(await give.isVisible());
    await settled();
    await page.locator('#hand [data-card="greek-creon"]').focus();
    await page.keyboard.press("ArrowUp");
    await panel.waitFor({ state: "hidden" });
    await page.keyboard.press("ArrowDown");
    await panel.waitFor();
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("action spot ok");
} finally {
  await browser.close();
  server.close();
}
