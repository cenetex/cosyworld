// A lost standoff, seen in the browser: telegraph, hit, defeat card, Continue,
// then the "You come to at" title at the new place. Desktop, phone and
// reduced motion.
import { atticOpening } from "../../test/fixtures/card-attic-opening.mjs";
import { selectCard } from "./card-browser-helpers.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { encodeSave, legalActions, nameOf, play } from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { combatPortrait } from "../card-game/combat-portraits.mjs";

function fixture(opponent) {
  let s = enableMotives(atticOpening());
  s = play(
    s,
    legalActions(s).find((a) => a.kind === "snuff"),
  ).state;
  s.actors[opponent].place = "pond";
  s = play(
    s,
    legalActions(s).find((a) => a.kind === "move" && a.target === "pond"),
  ).state;
  // The opponent has the upper hand: Vale's next brace loses the standoff.
  s.standoffs = [
    {
      challenger: opponent,
      defender: "vale",
      location: "pond",
      item: "lamp",
      opened: s.turn - 1,
      answered: true,
      resolve: { vale: 1, [opponent]: 4 },
      guarding: { vale: true, [opponent]: false },
      struck: { vale: true, [opponent]: true },
      steppedBack: { vale: false, [opponent]: false },
    },
  ];
  return s;
}

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const output = new URL("../../output/combat/", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const results = [];
try {
  for (const [width, height, motion, opponent] of [
    "moth",
    "greek-antigone",
  ].flatMap((id) => [
    [1440, 900, "no-preference", id],
    [390, 844, "no-preference", id],
    [390, 844, "reduce", id],
  ])) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: motion,
    });
    page.setDefaultTimeout(15000);
    const table = `combat-${opponent}-${width}-${motion}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
    const report = { opponent, width, motion, errors: [] };
    results.push(report);
    page.on("pageerror", (error) => report.errors.push(error.message));
    await page.addInitScript(
      ({ key, save }) => {
        localStorage.setItem(key, save);
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false }),
        );
      },
      { key, save: encodeSave(fixture(opponent)) },
    );
    let request;
    await page.route("**/card-game/text", async (route) => {
      request = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          revision: request.revision,
          model: "combat-fixture",
          entries: request.entities.map(({ id }) => ({
            id,
            text: `${nameOf(id)} shakes off the dust of the road.`,
          })),
        }),
      });
    });
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=${table}`,
    );
    await page.locator(`#hand [data-card="${opponent}"]`).waitFor();
    // Under threat the room is locked: no place cards and no items but the
    // demanded Lamp, which Vale may still hand over.
    assert.deepEqual(
      [
        ...new Set(
          await page.$$eval("#hand [data-card]", (cards) =>
            cards.map((card) => card.dataset.card),
          ),
        ),
      ].sort(),
      [...new Set(["lamp", "moth", opponent, "vale"])].sort(),
      "Under threat the hand holds only the people and the demanded item",
    );
    // Standing resolve shows under both fighters before the play.
    await page.waitForFunction(
      () => document.querySelectorAll("#cast .combat-pips").length === 2,
    );
    assert.match(
      await page
        .locator('#cast [data-avatar="vale"] .portrait-body > img')
        .getAttribute("data-source"),
      /vale-guard\.webp$/,
      "The saved standing guard selects its painting before another play",
    );
    // Raising both fighters offers Brace during the standoff.
    await selectCard(page, "vale");
    await selectCard(page, opponent);
    await page.evaluate(() => {
      window.combatArt = [];
      new MutationObserver(() => {
        for (const image of document.querySelectorAll(
          "#cast .portrait-body > img",
        ))
          window.combatArt.push(image.dataset.source);
      }).observe(document.querySelector("#cast"), {
        subtree: true,
        attributes: true,
        attributeFilter: ["data-source"],
      });
    });
    await page.locator("#card-actions button", { hasText: /^Brace/ }).click();
    // The hand drops away, untappable, as soon as the play commits.
    assert.deepEqual(
      await page.evaluate(() => {
        const dock = document.querySelector(".play-dock"),
          dialogue = document.querySelector(".dialogue");
        return [dock.dataset.dropped, dock.inert, dialogue.dataset.dropped];
      }),
      ["true", true, "true"],
      "The hand and the dialogue are down before the strikes resolve",
    );
    // The telegraph and the rules line appear on stage before the new place.
    await page.locator("#combat-caption:not([hidden])").waitFor();
    // From the first combat frame the two fighters face each other.
    assert.deepEqual(
      await page.evaluate(() =>
        Array.from(
          document.querySelectorAll("#cast .combat-pips"),
          (bar) => bar.parentElement.dataset.avatar,
        ).map((id, i, pair) => {
          const at = (who) => {
            const box = document
              .querySelector(`#cast [data-avatar="${who}"]`)
              .getBoundingClientRect();
            return box.left + box.width / 2;
          };
          const toward = at(pair[1 - i]) > at(id) ? "right" : "left";
          const facing = document.querySelector(`#cast [data-avatar="${id}"]`)
            .dataset.facing;
          return facing === toward;
        }),
      ),
      [true, true],
      "The fighters face each other before the first strike",
    );
    report.telegraph = await page.locator("#combat-caption").textContent();
    assert.match(
      await page
        .locator('#cast [data-avatar="vale"] .portrait-body > img')
        .getAttribute("data-source"),
      /vale-guard\.webp$/,
    );
    await page.waitForFunction(() =>
      /loses \d+ resolve/.test(
        document.querySelector("#combat-caption").textContent,
      ),
    );
    report.word = await page
      .locator('#cast [data-avatar="vale"] .combat-word')
      .last()
      .textContent();
    await page.locator("#defeat-dialog[open]").waitFor();
    report.art = [...new Set(await page.evaluate(() => window.combatArt))];
    for (const [id, pose] of [
      ["vale", "guard"],
      [opponent, "attack"],
      ["vale", "hit"],
    ]) {
      const source = combatPortrait(
        id,
        pose,
        `./assets/${id}.png`,
        id === "vale" ? "right" : "left",
      );
      if (source)
        assert.ok(
          report.art.includes(source),
          `${source} appeared in the committed combat beats`,
        );
    }
    assert.equal(
      await page
        .locator('#cast [data-avatar="vale"]')
        .getAttribute("data-pose"),
      "beaten",
    );
    assert.equal(
      await page.locator("#defeat-title").textContent(),
      `${nameOf(opponent)} drove you off`,
    );
    assert.match(
      await page.locator("#defeat-changes").textContent(),
      /You dropped the Lamp\./,
    );
    assert.match(
      await page.locator("#combat-announcement").textContent(),
      new RegExp(`${nameOf(opponent)} drove you off`, "u"),
    );
    // The player decides when to move on; the place has not changed yet.
    await page.waitForTimeout(600);
    assert.equal(await page.locator("#defeat-dialog[open]").count(), 1);
    assert.equal(await page.locator("#travel.travelling").count(), 0);
    await page.screenshot({
      path: new URL(`defeat-${opponent}-${width}-${motion}.png`, output)
        .pathname,
    });
    await page.locator("#defeat-dialog [data-combat-continue]").click();
    if (motion === "reduce") {
      assert.equal(
        await page.locator("#travel.travelling").count(),
        0,
        "Reduced motion arrives without an animated travel veil",
      );
    } else {
      await page.locator("#travel.travelling").waitFor();
      assert.equal(
        await page.locator("#travel-kicker").textContent(),
        "You come to at",
      );
      report.title = `${await page.locator("#travel-kicker").textContent()} ${await page.locator("#travel-name").textContent()}`;
    }
    const saved = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      key,
    );
    await page.waitForFunction(
      (place) => document.body.dataset.place === place,
      saved.actors.vale.place,
    );
    await page.waitForFunction(
      () => !document.querySelector("#travel.travelling"),
    );
    // Each fighter's step and the defeat join Memory as beats.
    await page.evaluate(() =>
      document.querySelector("#history-button").click(),
    );
    const log = await page.locator("#messages").textContent();
    await page.evaluate(() =>
      document.querySelector("#history-dialog").close(),
    );
    assert.ok(log.includes(`${nameOf(opponent)} struck Vale.`));
    assert.match(log, /Vale was beaten and (sent home|fell back to )/);
    assert.match(log, /You came to at /);
    assert.equal(await page.locator(".combat-dim").count(), 0);
    assert.equal(
      await page.locator('.play-dock[data-dropped="false"]').count(),
      1,
      "The hand rises once the new place is drawn",
    );
    assert.equal(
      await page.locator('.dialogue[data-dropped="false"]').count(),
      1,
      "The dialogue rises with the hand",
    );
    assert.equal(
      await page.locator("#combat-caption:not([hidden])").count(),
      0,
    );
    // One voice answers the defeat.
    await page.waitForFunction(() => Boolean(window.document.body));
    assert.ok(request, "The arrival asked for words");
    assert.equal(request.speakers.length, 1);
    await page.screenshot({
      path: new URL(`arrival-${opponent}-${width}-${motion}.png`, output)
        .pathname,
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    assert.equal(overflow, false, "No horizontal scroll");
    report.cancelled = await page.evaluate(async () => {
      const { createCombatView } = await import("/card-game/combat-view.mjs");
      const before = [
        ...document.querySelectorAll("#cast .portrait-body > img"),
      ].map((image) => image.getAttribute("src"));
      const view = createCombatView({
        stage: document.querySelector("#stage"),
        caption: document.querySelector("#combat-caption"),
        announce: document.querySelector("#combat-announcement"),
        dialog: document.querySelector("#defeat-dialog"),
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)"),
        revealLine() {},
      });
      const playing = view.play([
        { kind: "guard", actorId: "vale", targetId: "keeper" },
      ]);
      view.cleanup();
      const completed = await playing;
      const after = [
        ...document.querySelectorAll("#cast .portrait-body > img"),
      ].map((image) => image.getAttribute("src"));
      return (
        completed === false &&
        JSON.stringify(before) === JSON.stringify(after) &&
        !document.querySelector("#stage").dataset.combat
      );
    });
    assert.equal(
      report.cancelled,
      true,
      "Cancelling during preload restores the stage without starting late beats",
    );
    assert.deepEqual(report.errors, []);
    report.passed = true;
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
  console.log(JSON.stringify(results, null, 2));
}
