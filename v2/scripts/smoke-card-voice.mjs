import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  clearSelection,
  revealCard,
  selectCard,
} from "./card-browser-helpers.mjs";
// Vale wakes knowing only the cards his player has uncovered (#1575).
const wake = async (page) => {
  for (const id of ["vale", "lamp", "attic"]) await revealCard(page, id);
  await clearSelection(page);
};

const type = process.env.CARD_BROWSER || "chromium";
const browser = await { chromium, webkit }[type].launch({ headless: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const output = new URL(`../../output/card-voice-${type}/`, import.meta.url);
await mkdir(output, { recursive: true });
try {
  for (const width of [1440, 390, 320]) {
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
    // The opening starts lit (#1653), so the first play douses the lamp.
    let heldLight;
    await page.route("**/card-game/text", (route) => {
      const input = route.request().postDataJSON();
      requests.push(input);
      if (input.outcome.card.kind === "snuff" && !heldLight) {
        heldLight = { route, input };
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
        if (await page.locator("#unveil-dialog[open]").count())
          await page.keyboard.press("Escape");
        else if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        await page.waitForTimeout(50);
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
      }
      throw Error("Voice flow stayed busy");
    };
    const playCards = async (kind, ids) => {
      const before = requests.length;
      // A held item stays raised after its play; start each play fresh.
      await page.keyboard.press("Escape");
      for (const id of ids) await selectCard(page, id);
      await page.locator(`#card-actions [data-action="${kind}"]`).click();
      await finish();
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
    try {
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?table=voice-${width}`,
      );
      await wake(page);
      await page.waitForSelector("#dialogue-text .speech-letter");
      assert.equal(await page.locator("#speaker").innerText(), "Vale");
      // A new game asks the model for Vale's first line: no action, Vale alone.
      assert.equal(
        await page.locator("#dialogue-text").textContent(),
        reaction("arrive"),
      );
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
      await selectCard(page, "lamp");
      await page.locator('#card-actions [data-action="snuff"]').click();
      await finish(); // The delayed request releases the hand after scene preparation.
      assert(heldLight);
      assert.equal(await page.locator("#speaker").innerText(), "Vale");
      assert.equal(await page.locator("#dialogue-text").textContent(), "");
      // Holding the lamp meets Vale's quest on the first play; the scene
      // request carries that outcome.
      assert.deepEqual(heldLight.input.outcome.card.wantMet, {
        kind: "item",
        target: "lamp",
      });
      await playCards("light", ["lamp"]);
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
      await heldLight.route
        .fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(response(heldLight.input)),
        })
        .catch(() => {});
      await page.waitForTimeout(100);
      const saved = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)),
        key,
      );
      assert(
        !saved.log.some((line) => line.text === reaction("snuff")),
        "Stale dialogue stays out of the current turn",
      );
      await playCards("wait", ["attic"]);
      await playCards("drop", ["lamp", "attic"]);
      await playCards("take", ["lamp"]);
      if (width === 390) {
        // A quick first Put out reply also crosses the discovery and quest cues.
        await page.locator("#toolbar-menu-button").click();
        await page.locator("#avatar-move").click();
        await page.locator("#avatar-new-world").click();
        await page.locator("#confirm-reset").click();
        await finish();
        await playCards("snuff", ["lamp"]);
      }
      if (width < 700) {
        // Step back through the beat stack to Vale's long reply.
        for (
          let line = 0;
          line < 8 && (await page.locator("#speaker").innerText()) !== "Vale";
          line++
        ) {
          await page
            .locator("#beat-behind")
            .click({ position: { x: 80, y: 6 } });
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
        `Opening, Put out replacement, quest completion, Stay, Put down and Take speech passed in ${type} at ${width}px.`,
      );
    } finally {
      await page.close();
    }
  }
  // When the model gives no opening line, Vale is silent ("…") and Retry
  // still asks the model for his words.
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
    await wake(page);
    await page.waitForFunction(
      () => document.querySelector("#dialogue-text")?.textContent.length > 0,
    );
    // No scripted line (#1600): a failed first line is the silent "…".
    await page.waitForFunction(
      () => document.querySelector("#dialogue-text").textContent.trim() === "…",
    );
    assert.ok(requests.length >= 1);
    assert.ok(await page.locator("#story-retry").isVisible());
    let lines = await valeLines();
    assert.equal(lines.length, 0, "The silent beat is never saved");
    failing = false;
    await page.locator("#story-retry").click();
    await page.waitForFunction(() =>
      /Hello\?/.test(document.querySelector("#dialogue-text").textContent),
    );
    lines = await valeLines();
    assert.equal(lines.length, 1, "The model line follows the silence");
    assert.equal(lines[0].text, "Dust and a dark mirror. Hello?");
    assert.equal(lines[0].fallback, undefined);
    assert.deepEqual(errors, []);
    console.log(`Opening silence and retry passed in ${type}.`);
  } finally {
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
