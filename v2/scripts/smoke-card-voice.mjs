import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  clearSelection,
  revealCard,
  revealOpening,
  selectCard,
  startNewGame,
  smokeWidths,
  readyActionButton,
} from "./card-browser-helpers.mjs";
// Vale wakes knowing only the cards his player has uncovered (#1575).
const wake = async (page) => {
  // The lamp stays chosen and lit: lowering it would put it out.
  await revealOpening(page);
};

const type = process.env.CARD_BROWSER || "chromium";
const browser = await { chromium, webkit }[type].launch({ headless: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const output = new URL(`../../output/card-voice-${type}/`, import.meta.url);
await mkdir(output, { recursive: true });
try {
  for (const width of smokeWidths([1440, 390, 320])) {
    const page = await browser.newPage({
      viewport: {
        width,
        height: width === 320 ? 568 : width === 390 ? 844 : 900,
      },
      reducedMotion: width === 320 ? "reduce" : "no-preference",
    });
    page.setDefaultTimeout(20000);
    const key = `cosyworld.reflected-shore.v1.voice-${width}`,
      errors = [],
      requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("cosyworld.dialogue.sound", "off");
      localStorage.setItem(
        "cosyworld.room-music",
        JSON.stringify({ enabled: false }),
      );
    });
    const reaction = (kind) =>
      `My reaction to ${kind}. The room holds a little warmth. I wonder who has passed through that mirror, and whether they left a light burning for someone to find their way home.`;
    const response = (input) => ({
      revision: input.revision,
      model: "voice-fixture",
      entries: input.entities.map(({ id }) => ({
        id,
        text:
          id === "vale"
            ? reaction(input.outcome.card.kind)
            : "There is time to look around.",
      })),
    });
    let heldWait;
    await page.route("**/card-game/text", (route) => {
      const input = route.request().postDataJSON();
      requests.push(input);
      if (input.outcome.card.kind === "wait" && !heldWait) {
        heldWait = { route, input };
        return;
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(response(input)),
      });
    });
    const finish = async () => {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        await page.waitForTimeout(50);
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
      }
      throw Error("Voice flow stayed busy");
    };
    const playCards = async (kind, ids, speaks = true) => {
      const before = requests.length;
      await clearSelection(page);
      for (const id of ids) await selectCard(page, id);
      await readyActionButton(page, kind).click();
      await finish();
      if (!speaks)
        return assert.equal(requests.length, before, `${kind} stays silent`);
      assert.equal(requests.length, before + 1, `${kind} requests speech once`);
      assert.equal(requests.at(-1).speakers[0], "vale");
      assert.equal(requests.at(-1).outcome.card.kind, kind);
      const world = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)),
        key,
      );
      assert(
        world.log.some(
          (line) =>
            line.turn === world.turn &&
            line.actorId === "vale" &&
            line.kind === "dialogue" &&
            line.text === reaction(kind),
        ),
      );
      const frame = await page.evaluate(() => {
        const stage = document.querySelector("#stage"),
          dialogue = document
            .querySelector(".dialogue")
            .getBoundingClientRect(),
          portrait = document
            .querySelector("#speaker-portrait")
            .getBoundingClientRect();
        return {
          scrollX: stage.scrollLeft,
          scrollY: stage.scrollTop,
          left: dialogue.left,
          right: dialogue.right,
          portraitLeft: portrait.left,
          portraitRight: portrait.right,
        };
      });
      assert.equal(
        frame.scrollX,
        0,
        `${kind} keeps the scene fixed horizontally`,
      );
      assert.equal(
        frame.scrollY,
        0,
        `${kind} keeps the scene fixed vertically`,
      );
      assert(frame.left >= 0 && frame.right <= width, "Dialogue stays in view");
      assert(
        frame.portraitLeft >= frame.left && frame.portraitRight <= frame.right,
        "The speaker stays beside the text",
      );
    };
    const quietLamp = async () => {
      const saved = () => page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)), key,
      );
      const before = await saved(), count = requests.length;
      await clearSelection(page);
      await finish();
      const stowed = await saved();
      assert.equal(stowed.actors.vale.heldItem, null);
      assert.equal(stowed.items.lamp.lit, false);
      await selectCard(page, "lamp");
      await finish();
      const held = await saved();
      assert.equal(held.actors.vale.heldItem, "lamp");
      assert.equal(held.items.lamp.lit, true);
      for (const state of [stowed, held]) {
        assert.equal(state.turn, before.turn, "Holding does not spend a turn");
        assert.equal(state.items.lamp.fuelRooms, before.items.lamp.fuelRooms);
      }
      assert.equal(requests.length, count, "Holding and stowing ask for no speech");
    };
    try {
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?table=voice-${width}`,
      );
      await wake(page);
      await page.waitForSelector("#dialogue-text .speech-letter");
      assert.equal(await page.locator("#speaker").innerText(), "Vale");
      // A new game asks the model for Vale's first line: no action, Vale alone.
      const first = await page.locator("#dialogue-text").textContent();
      assert(reaction("arrive").includes(first.trim()), first);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].turn, 0);
      assert.equal(requests[0].action, null);
      assert.deepEqual(requests[0].speakers, ["vale"]);
      await finish();
      await page.reload();
      await finish();
      assert.equal(requests.length, 1, "Reload keeps the generated opening");
      const opening = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)),
        key,
      );
      assert.equal(
        opening.log.filter((line) => line.generated && line.kind === "dialogue")
          .length,
        1,
        "Reload keeps one opening line",
      );
      assert.equal(opening.turn, 0);
      assert.equal(opening.actors.vale.place, "attic");
      assert.equal(opening.items.lamp.lit, true);
      await quietLamp();
      // The player's first quest waits for the Black Pond (#1768).
      assert.equal(opening.actors.vale.want, null, "The attic holds no quest");
      // Stage Vale past the pond with the quest of holding the lamp he holds.
      await page.evaluate((key) => {
        const s = JSON.parse(localStorage.getItem(key));
        const vale = s.actors.vale;
        vale.visited = [...new Set([...vale.visited, "pond"])];
        vale.want = {
          kind: "item",
          target: "lamp",
          since: s.turn,
          refusals: 0,
        };
        localStorage.setItem(key, JSON.stringify(s));
      }, key);
      await page.reload();
      await finish();
      assert.equal(requests.length, 1, "Staging the quest asks for no speech");
      await clearSelection(page);
      await selectCard(page, "attic");
      await readyActionButton(page, "wait").click();
      await finish(); // The delayed request releases the hand after scene preparation.
      assert(heldWait);
      assert.equal(await page.locator("#speaker").innerText(), "Vale");
      assert.equal(await page.locator("#dialogue-text").textContent(), "");
      assert.deepEqual(heldWait.input.outcome.card.wantMet, {
        kind: "item",
        target: "lamp",
      });
      await playCards("wait", ["vale"], false);
      // A replaced slow reply keeps the met quest in the saved history.
      assert.ok(
        await page.evaluate(
          (key) =>
            JSON.parse(localStorage.getItem(key)).log.some(
              (e) => e.verb === "want_met" && e.actorId === "vale",
            ),
          key,
        ),
      );
      await heldWait.route
        .fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(response(heldWait.input)),
        })
        .catch(() => {});
      await page.waitForTimeout(100);
      const saved = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)),
        key,
      );
      assert(
        !saved.log.some((line) => line.text === reaction("wait")),
        "Stale dialogue stays out of the current turn",
      );
      await playCards("drop", ["lamp", "attic"]);
      await playCards("take", ["lamp"]);
      if (width === 390) {
        await startNewGame(page);
        await wake(page);
        await finish();
        await quietLamp();
        await playCards("wait", ["attic"], false);
      }
      if (width === 320) {
        for (
          let line = 0;
          line < 8 &&
          !/My reaction to/.test(
            await page.locator("#dialogue-text").textContent(),
          );
          line++
        ) {
          // ↑ steps back; phones hide the card behind (#1897).
          await page.evaluate(() => document.activeElement?.blur());
          await page.keyboard.press("ArrowUp");
        }
        assert.match(
          await page.locator("#dialogue-text").textContent(),
          /My reaction to/,
        );
        await page.locator("#dialogue-advance").focus();
        await page.keyboard.press("End");
        assert(
          await page
            .locator("#dialogue-text")
            .evaluate(
              (text) =>
                text.scrollHeight <= text.clientHeight + 1 ||
                text.scrollTop > 0,
            ),
          // The card grows to about seven lines (#1599); longer still scrolls.
          "A long reply is shown whole or scrolls inside the dialogue",
        );
        assert.equal(
          await page.locator("#stage").evaluate((stage) => stage.scrollLeft),
          0,
        );
        await page.keyboard.press("Home");
      }
      await page.screenshot({
        path: new URL(`vale-${width}.png`, output).pathname,
      });
      assert.deepEqual(errors, []);
      console.log(
        `Opening, quiet lamp holding, delayed Wait replacement, quest history, Put down and Take speech passed in ${type} at ${width}px.`,
      );
    } finally {
      await page.close();
    }
  }
  // When the model gives no opening line, Vale is silent ("…"); nothing
  // asks again and no Retry shows.
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.setDefaultTimeout(40000);
  const key = "cosyworld.reflected-shore.v1.voice-fallback",
    errors = [],
    requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("cosyworld.dialogue.sound", "off");
    localStorage.setItem(
      "cosyworld.room-music",
      JSON.stringify({ enabled: false }),
    );
  });
  let failing = true;
  await page.route("**/card-game/text", (route) => {
    const input = route.request().postDataJSON();
    requests.push(input);
    if (failing)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Model unavailable." }),
      });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        revision: input.revision,
        model: "voice-fixture",
        entries: input.entities.map(({ id }) => ({
          id,
          text: id === "vale" ? "Dust and a dark mirror. Hello?" : "Dust.",
        })),
      }),
    });
  });
  const saved = () =>
    page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
  const valeLines = async () =>
    (await saved()).log.filter(
      (line) => line.kind === "dialogue" && line.actorId === "vale",
    );
  try {
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=voice-fallback`,
    );
    await revealCard(page, "vale");
    await page.waitForFunction(
      () => document.querySelector("#dialogue-text")?.textContent.length > 0,
    );
    // No scripted line (#1600): a failed first line is the silent "…".
    await page.waitForFunction(
      () => document.querySelector("#dialogue-text").textContent.trim() === "…",
    );
    assert.ok(requests.length >= 1);
    // The "…" is the whole failure: no note, no Retry, and nothing asks again.
    assert.equal(await page.locator("#story-retry, #story-error").count(), 0);
    assert.doesNotMatch(
      await page.locator("body").innerText(),
      /didn.t arrive|\bRetry\b/u,
    );
    const lines = await valeLines();
    assert.equal(lines.length, 0, "The silent beat is never saved");
    const asked = requests.length;
    failing = false;
    await page.waitForTimeout(1500);
    assert.equal(requests.length, asked, "a failed first line is not re-asked");
    assert.equal(
      await page.locator("#dialogue-text").textContent(),
      "…",
      "the silent beat stays",
    );
    assert.deepEqual(errors, []);
    console.log(`Opening silence without retry passed in ${type}.`);
  } finally {
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
