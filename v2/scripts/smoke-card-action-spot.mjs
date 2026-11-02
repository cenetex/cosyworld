// A ready play is a beat in front of the dialogue: what the play will do,
// with its buttons. The spoken beat fades behind it, nothing sits between
// the dialogue and the hand, and the hand never moves for it. Vale takes the
// Burial Decree at the Theban Palace Forecourt (one "the" in the caption)
// and offers it to Creon.
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
          heading: panel.querySelector(".action-beat-heading").textContent,
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
    await handUncut();
    await shot("idle");

    await selectCard(page, "greek-decree");
    await page.locator("#card-actions .card-primary").waitFor();
    const restHand = await box("#hand"),
      restDialogue = await box(".dialogue");
    const taking = await actionBeat("take");
    assert.match(taking.heading, /^\s*Vale takes the Burial Decree/u);
    // Selecting raised the hand; the beat appearing moves nothing more.
    await page.waitForTimeout(300);
    assert.deepEqual(await box("#hand"), restHand, "hand stays put");
    assert.deepEqual(await box(".dialogue"), restDialogue, "dialogue stays");
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
    const offering = await actionBeat("give");
    assert(offering.spoken, "the spoken beat waits behind the offer");
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
