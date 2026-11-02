import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { currentActor, encodeSave, legalActions } from "../card-game/world.mjs";
import { needsVoyage, nextVoyagePlay } from "../../test/helpers/voyage.mjs";
import { profiles } from "../card-game/memory.mjs";
import {
  openDoorAction,
  openDoorStart,
  playOpenDoor,
} from "../../test/helpers/open-door.mjs";
import { homecomingSteps } from "../../test/helpers/greek-homecoming.mjs";
import {
  clearSelection,
  selectCard,
  smokeWidths,
} from "./card-browser-helpers.mjs";

const output = new URL("../../output/greek-homecoming/", import.meta.url);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const width of smokeWidths([1440, 390])) {
    // smoke-card-open-door walks the whole Open Door chapter in the browser,
    // so this journey starts from a save just after Thaleia takes the list
    // and ends when Myrine's signed list reaches Dione.
    const steps = homecomingSteps();
    const start = steps.findIndex((a) => a.target === "greek-quay-host");
    const end = steps.findIndex(
      (a) => a.item === "greek-return-list" && a.target === "greek-baker",
    );
    let world = openDoorStart();
    for (const { kind, ...fields } of steps.slice(0, start + 1))
      world = playOpenDoor(world, kind, fields);
    const table = `homecoming-${width}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 900 },
      reducedMotion: "reduce",
      hasTouch: width === 390,
    });
    const errors = [],
      failedAssets = [],
      requests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400 && new URL(r.url()).pathname.includes("/assets/"))
        failedAssets.push(r.url());
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
      {
        key,
        save: encodeSave(world),
        seen: Object.keys(profiles),
      },
    );
    await page.route("**/card-game/text", async (route) => {
      const input = route.request().postDataJSON();
      requests.push(input);
      await route.fulfill({
        json: {
          revision: input.revision,
          model: "homecoming-browser-fixture",
          entries: input.entities.map(({ id }) => ({
            id,
            text:
              input.disclosures?.find((fact) => fact.speaker === id)?.text ||
              "I have brought my own words home.",
          })),
        },
      });
    });
    const state = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    const settle = async () => {
      await page.waitForSelector("#hand .card");
      for (let n = 0; n < 300; n++) {
        if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        assert.equal(
          await page.locator("#story-retry").isVisible(),
          false,
          "fixture speech resolves",
        );
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
        await page.waitForTimeout(40);
      }
      throw new Error(
        `Homecoming stayed busy at ${width}: ${errors.join("; ")}`,
      );
    };
    const capture = async (label) => {
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "page fits screen",
      );
      await page.waitForFunction(() =>
        [...document.querySelectorAll("#backdrop, #cast img")].every(
          (img) => img.complete && img.naturalWidth > 0,
        ),
      );
      await page.screenshot({
        path: new URL(`${label}-${width}.png`, output).pathname,
        fullPage: true,
      });
    };
    const step = async ({ kind, ...fields }) => {
      await settle();
      // Aboard, a port is a voyage: the course card, a round at sea, Disembark.
      for (let n = 0; n < 12 && kind === "move"; n++) {
        const world = await state();
        if (!needsVoyage(world, currentActor(world), fields.target)) break;
        const next = nextVoyagePlay(world, currentActor(world), fields.target);
        await step(next.target ? next : { kind: next.kind });
      }
      if (kind === "move" && fields.target === "greek-ship") {
        for (
          let wait = 0;
          wait < 32 &&
          !legalActions(await state()).some(
            (a) => a.kind === "move" && a.target === "greek-ship",
          );
          wait++
        )
          await step({ kind: "wait" });
      }
      const before = await state();
      const action = openDoorAction(before, kind, fields);
      const cards = action.cards?.length
        ? [...action.cards]
        : [action.item || action.target || "vale"];
      if (kind === "drop" && !cards.includes(fields.target))
        cards.push(fields.target);
      await clearSelection(page);
      for (const id of [...new Set(cards)])
        await selectCard(page, id, { touch: width === 390 });
      await page
        .locator(`#card-actions [data-action="${kind}"]`)
        .first()
        .click();
      await settle();
      const after = await state();
      assert.equal(after.turn, before.turn + 1, `${kind} commits once`);
      if (kind === "accompany") {
        assert.equal(after.actors.vale.place, fields.destination);
        assert.equal(after.actors[fields.target].place, fields.destination);
      }
      assert.equal(after.quests, undefined, "no quest records return");
    };
    try {
      await page.goto(`${origin}/?table=${table}`);
      await settle();
      for (const action of steps.slice(start + 1, end + 1)) {
        const prior = (await state()).packs["greek-drama"].receipts;
        await step(action);
        const now = await state();
        const done = (id) =>
          now.packs["greek-drama"].receipts[id] !== undefined &&
          prior[id] === undefined;
        if (done("greek-homecoming-report-eleusis-pledge")) {
          assert.notEqual(
            now.packs["greek-drama"].flags["greek-open-door-marathon-done"],
            true,
          );
          await capture("early-dione-return");
        }
        if (done("greek-homecoming-agree-journey")) {
          await capture("agreed-journey");
          assert.equal(
            await page.locator("#hand [data-quest]").count(),
            0,
            "Myrine's journey stays out of the hand",
          );
          await capture("myrine-quest");
          await page.keyboard.press("Escape");
          await page.reload();
          await settle();
          assert.deepEqual(
            (await state()).packs,
            now.packs,
            "agreement survives reload",
          );
        }
        if (action.kind === "accompany") await capture("household-at-quay");
        if (done("greek-homecoming-receive-family"))
          await capture("received-household");
        if (done("greek-homecoming-report-piraeus-family"))
          await capture("dione-witness-reading");
      }
      const completed = await state();
      assert.equal(
        completed.packs["greek-drama"].flags["greek-homecoming-witness-heard"],
        true,
      );
      assert.equal(
        completed.items["greek-return-list"].holder,
        "greek-courtyard",
      );
      assert.equal(
        completed.actors["greek-household-witness"].place,
        "greek-piraeus",
      );
      await page.reload();
      await settle();
      assert.deepEqual(
        (await state()).packs,
        completed.packs,
        "the signed list survives reload",
      );
      assert.deepEqual(
        (await state()).log.filter((e) => e.verb === "want_met"),
        completed.log.filter((e) => e.verb === "want_met"),
        "met quests remain once",
      );
      assert.ok(
        requests.some((r) =>
          r.entities.some((e) => e.id === "greek-household-witness"),
        ),
        "Myrine participates in speech",
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(failedAssets, []);
      console.log(
        `Homecoming: ${width}px, the household's care, early return, consent, real travel, custody, and the signed list passed.`,
      );
    } finally {
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
