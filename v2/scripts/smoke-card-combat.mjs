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

function fixture() {
  let s = enableMotives(atticOpening());
  s = play(
    s,
    legalActions(s).find((a) => a.kind === "light"),
  ).state;
  s.actors.moth.place = "pond";
  s = play(
    s,
    legalActions(s).find((a) => a.kind === "move" && a.target === "pond"),
  ).state;
  // Pip has the upper hand: Vale's next guard still loses the standoff.
  s.standoffs = [
    {
      challenger: "moth",
      defender: "vale",
      location: "pond",
      item: "lamp",
      opened: s.turn - 1,
      answered: true,
      resolve: { vale: 1, moth: 4 },
      guarding: { vale: false, moth: false },
      struck: { vale: true, moth: true },
    },
  ];
  return s;
}

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const output = new URL("../../output/combat/", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [width, height, motion] of [
    [1440, 900, "no-preference"],
    [390, 844, "no-preference"],
    [390, 844, "reduce"],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: motion,
    });
    page.setDefaultTimeout(15000);
    const table = `combat-${width}-${motion}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
    const report = { width, motion, errors: [] };
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
      { key, save: encodeSave(fixture()) },
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
    await page.locator('#hand [data-card="moth"]').waitFor();
    // Standing resolve shows under both fighters before the play.
    await page.waitForFunction(
      () => document.querySelectorAll("#cast .combat-pips").length === 2,
    );
    // Vale with Pip raised offers Guard during the standoff.
    await selectCard(page, "vale");
    await selectCard(page, "moth");
    await page.locator("#card-actions button", { hasText: /^Guard/ }).click();
    // The telegraph and the rules line appear on stage before the new place.
    await page.locator("#combat-caption:not([hidden])").waitFor();
    report.telegraph = await page.locator("#combat-caption").textContent();
    await page.waitForFunction(() =>
      /loses 1 resolve/.test(
        document.querySelector("#combat-caption").textContent,
      ),
    );
    report.word = await page
      .locator('#cast [data-avatar="vale"] .combat-word')
      .last()
      .textContent();
    await page.locator("#defeat-dialog[open]").waitFor();
    assert.equal(
      await page
        .locator('#cast [data-avatar="vale"]')
        .getAttribute("data-pose"),
      "beaten",
    );
    assert.equal(
      await page.locator("#defeat-title").textContent(),
      "Pip drove you off",
    );
    assert.match(
      await page.locator("#defeat-changes").textContent(),
      /You dropped the Lamp\./,
    );
    assert.match(
      await page.locator("#combat-announcement").textContent(),
      /Pip drove you off/,
    );
    // The player decides when to move on; the place has not changed yet.
    await page.waitForTimeout(600);
    assert.equal(await page.locator("#defeat-dialog[open]").count(), 1);
    assert.equal(await page.locator("#travel.travelling").count(), 0);
    await page.screenshot({
      path: new URL(`defeat-${width}-${motion}.png`, output).pathname,
    });
    await page.locator("#defeat-dialog [data-combat-continue]").click();
    if (motion === "reduce") {
      await page.waitForFunction(() =>
        /You come to at /.test(document.querySelector(".dialogue").textContent),
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
    const log = await page.locator("#messages").textContent();
    assert.match(log, /Pip lunged at Vale\./);
    assert.match(log, /Vale was beaten and (sent home|fell back to )/);
    assert.match(log, /You came to at /);
    assert.equal(await page.locator(".combat-dim").count(), 0);
    assert.equal(
      await page.locator("#combat-caption:not([hidden])").count(),
      0,
    );
    // One voice answers the defeat.
    await page.waitForFunction(() => Boolean(window.document.body));
    assert.ok(request, "The arrival asked for words");
    assert.equal(request.speakers.length, 1);
    await page.screenshot({
      path: new URL(`arrival-${width}-${motion}.png`, output).pathname,
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    assert.equal(overflow, false, "No horizontal scroll");
    assert.deepEqual(report.errors, []);
    report.passed = true;
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
  console.log(JSON.stringify(results, null, 2));
}
