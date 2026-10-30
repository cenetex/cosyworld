import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { encodeSave, legalActions } from "../card-game/world.mjs";
import { profiles } from "../card-game/memory.mjs";
import { packDefinition } from "../card-game/pack-registry.mjs";
import {
  openDoorStart,
  openDoorAction,
} from "../../test/helpers/open-door.mjs";
import { selectCard } from "./card-browser-helpers.mjs";
import { needsVoyage, nextVoyagePlay } from "../../test/helpers/voyage.mjs";

const output = new URL("../../output/greek-travel/", import.meta.url);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [1440, 390]) {
    const table = `greek-travel-${width}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
    const fixture = openDoorStart();
    fixture.playerActorId = "mara";
    fixture.sharedVersion = 1;
    fixture.controlledActors = ["vale", "mara"];
    fixture.presentActors = ["mara"];
    fixture.actors.mara.place = "greek-athens-harbor";
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 900 },
      reducedMotion: "reduce",
      hasTouch: width === 390,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400 && r.url().includes("/assets/"))
        errors.push(`${r.status()} ${r.url()}`);
    });
    await page.addInitScript(
      ({ key, save, seen }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false }),
        );
      },
      { key, save: encodeSave(fixture), seen: Object.keys(profiles) },
    );
    await page.route("**/card-game/text", async (route) => {
      const input = route.request().postDataJSON();
      await route.fulfill({
        json: {
          revision: input.revision,
          model: "greek-travel-browser-fixture",
          entries: input.entities.map(({ id }) => ({
            id,
            text: "The road lies ahead of us.",
          })),
        },
      });
    });
    const state = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    const settle = async () => {
      await page.waitForSelector("#hand .card");
      for (let n = 0; n < 300; n++) {
        if (await page.locator("#unveil-dialog[open]").count())
          await page.keyboard.press("Escape");
        else if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        assert.equal(await page.locator("#story-retry").isVisible(), false);
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
        await page.waitForTimeout(40);
      }
      throw new Error(`Journey remained busy at ${width}px`);
    };
    const step = async (kind, target) => {
      await settle();
      // Aboard, a port is a voyage: the course card, a round at sea, Disembark.
      for (
        let n = 0;
        n < 12 && kind === "move" && needsVoyage(await state(), "mara", target);
        n++
      ) {
        const next = nextVoyagePlay(await state(), "mara", target);
        await step(next.kind, next.target);
      }
      if (target === "greek-ship")
        for (
          let n = 0;
          n < 32 &&
          !legalActions(await state()).some(
            (a) => a.kind === "move" && a.target === target,
          );
          n++
        )
          await step("wait");
      const before = await state();
      const action = openDoorAction(before, kind, target ? { target } : {});
      await page.keyboard.press("Escape");
      await selectCard(page, action.cards[0] || "mara", {
        touch: width === 390,
      });
      await page
        .locator(`#card-actions [data-action="${kind}"]`)
        .first()
        .click();
      await settle();
      const after = await state();
      assert.equal(after.turn, before.turn + 1);
      if (kind === "move") assert.equal(after.actors.mara.place, target);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
    };
    await page.goto(`${origin}/?table=${table}`);
    await settle();
    assert.match(
      await page.locator("#backdrop").getAttribute("src"),
      /athens-harbor-open-berth(?:-night)?\.webp/,
    );
    await page.screenshot({
      path: new URL(`athens-empty-${width}.png`, output).pathname,
      fullPage: true,
    });
    for (const target of [
      "greek-ship",
      "greek-piraeus",
      "greek-road-athens-piraeus",
      "greek-athens",
      "greek-road-athens-eleusis",
      "greek-eleusis",
      "greek-road-athens-eleusis",
      "greek-athens",
      "greek-athens-harbor",
      "greek-ship",
      "greek-harbor",
      "greek-courtyard",
    ]) {
      await step("move", target);
      const road = packDefinition("greek-drama").places[target]?.road;
      if (road) {
        await selectCard(page, target, { touch: width === 390 });
        const visibleOrder = await page
          .locator("#hand [data-card]")
          .evaluateAll(
            (cards, ids) =>
              cards
                .map((card) => card.dataset.card)
                .filter((id) => ids.includes(id)),
            ["mara", road[0], target, road[1]],
          );
        assert.deepEqual(visibleOrder, ["mara", road[0], target, road[1]]);
      }
      if (
        [
          "greek-athens-harbor",
          "greek-road-athens-eleusis",
          "greek-athens",
          "greek-piraeus",
        ].includes(target)
      ) {
        await page.waitForFunction(() =>
          [...document.querySelectorAll("#backdrop")].every(
            (img) => img.complete && img.naturalWidth > 0,
          ),
        );
        await page.screenshot({
          path: new URL(`${target}-${width}.png`, output).pathname,
          fullPage: true,
        });
      }
      if (target === "greek-road-athens-eleusis") {
        const before = await state();
        await page.reload();
        await settle();
        assert.equal(
          (await state()).actors.mara.place,
          before.actors.mara.place,
        );
        await selectCard(page, "greek-athens", { touch: width === 390 });
        assert.equal(
          await page
            .locator('#hand [data-card="greek-athens"]')
            .getAttribute("aria-pressed"),
          "true",
        );
        await page.keyboard.press("Escape");
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      `Greek travel: ${width}px, Mara first, roads between their ends, direct town visits, empty Athens berth, reload, and return passed.`,
    );
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
