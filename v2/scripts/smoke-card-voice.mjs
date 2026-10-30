import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { selectCard } from "./card-browser-helpers.mjs";
import { playerQuest } from "../card-game/quest-cards.mjs";

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
    let heldLight;
    await page.route("**/card-game/text", (route) => {
      const input = route.request().postDataJSON();
      requests.push(input);
      if (input.outcome.card.kind === "light" && !heldLight) {
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
      assert.equal(opening.items.lamp.lit, false);
      const openingQuest = playerQuest(opening);
      assert(openingQuest, "The opening has an active quest");
      await selectCard(page, "lamp");
      await page.locator('#card-actions [data-action="light"]').click();
      await finish(); // The delayed request releases the hand after scene preparation.
      assert(heldLight);
      assert.equal(await page.locator("#speaker").innerText(), "Vale");
      assert.equal(await page.locator("#dialogue-text").textContent(), "");
      await playCards("snuff", ["lamp"]);
      // A replaced slow reply keeps the completion; the next Talk context
      // names it instead of a completion dialog.
      assert.notEqual(
        await page.evaluate(
          ({ key, quest }) =>
            JSON.parse(localStorage.getItem(key)).quests.records[quest]
              .completedTurn,
          { key, quest: openingQuest.key },
        ),
        null,
      );
      assert.match(
        requests
          .at(-1)
          .entities.find((e) => e.id === "vale")
          .facts.join(" "),
        new RegExp(`I just finished ${openingQuest.title}`),
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
        !saved.log.some((line) => line.text === reaction("light")),
        "Stale dialogue stays out of the current turn",
      );
      await playCards("wait", ["attic"]);
      await playCards("drop", ["lamp", "attic"]);
      await playCards("take", ["lamp"]);
      if (width === 390) {
        // A quick first Light reply also crosses the discovery and quest cues.
        await page.locator("#toolbar-menu-button").click();
        await page.locator("#menu-button").click();
        await page.locator("#new-game").click();
        await page.locator("#confirm-reset").click();
        await finish();
        await playCards("light", ["lamp"]);
      }
      if (width < 700) {
        // Read Vale's long reply through the player history controls.
        for (
          let line = 0;
          line < 8 && (await page.locator("#speaker").innerText()) !== "Vale";
          line++
        ) {
          await page.locator("#previous-line").click();
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
            .evaluate((text) => text.scrollTop > 0),
          "A long reply still scrolls inside the dialogue",
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
        `Opening, Light replacement, quest completion, Stay, Put down and Take speech passed in ${type} at ${width}px.`,
      );
    } finally {
      await page.close();
    }
  }
  // When the model gives no opening line, the authored line is shown. It is
  // marked as a fallback, so Retry still asks the model for Vale's words.
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
    await page.waitForFunction(
      () => document.querySelector("#dialogue-text")?.textContent.length > 0,
    );
    await page.waitForFunction(() =>
      /It's cold up here/.test(
        document.querySelector("#dialogue-text").textContent,
      ),
    );
    assert.ok(requests.length >= 1);
    assert.ok(await page.locator("#story-retry").isVisible());
    let lines = await valeLines();
    assert.equal(lines.length, 1);
    assert.equal(lines[0].fallback, true);
    failing = false;
    await page.locator("#story-retry").click();
    await page.waitForFunction(() =>
      /Hello\?/.test(document.querySelector("#dialogue-text").textContent),
    );
    lines = await valeLines();
    assert.equal(lines.length, 1, "The model line replaces the fallback");
    assert.equal(lines[0].text, "Dust and a dark mirror. Hello?");
    assert.equal(lines[0].fallback, undefined);
    assert.deepEqual(errors, []);
    console.log(`Opening fallback and retry passed in ${type}.`);
  } finally {
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
