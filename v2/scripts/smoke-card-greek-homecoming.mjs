import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  currentActor,
  encodeSave,
  legalActions,
} from "../card-game/world.mjs";
import { needsVoyage, nextVoyagePlay } from "../../test/helpers/voyage.mjs";
import { profiles } from "../card-game/memory.mjs";
import { questCards, questCardId } from "../card-game/quest-cards.mjs";
import { narrativeContext } from "../card-game/narrative.mjs";
import { openingFixture } from "../../test/helpers/greek-opening.mjs";
import {
  openDoorAction,
  openDoorInvitation,
} from "../../test/helpers/open-door.mjs";
import { homecomingSteps } from "../../test/helpers/greek-homecoming.mjs";
import {
  clearSelection,
  selectCard,
  topicForChoice,
} from "./card-browser-helpers.mjs";

const output = new URL("../../output/greek-homecoming/", import.meta.url);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [1440, 390]) {
    const berth = width === 1440 ? "family" : "open";
    const reading = width === 1440 ? "basket" : "berth";
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
        save: encodeSave(openingFixture("refusal").closed),
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
        if (await page.locator("#unveil-dialog[open]").count())
          await page.keyboard.press("Escape");
        else if (await page.locator("#dialogue-advance").isVisible())
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
    const checkReportCards = async (world) => {
      const saved = structuredClone(world);
      saved.quests.hands.vale = ["agora", "eleusis"].map(
        (place) => `greek-drama:story-quest-greek-homecoming-return:${place}`,
      );
      const reports = questCards(saved);
      assert.equal(reports.length, 2);
      const ids = reports.map((report) => questCardId(saved, report));
      assert.equal(
        new Set(ids).size,
        2,
        "each return card has its own display ID",
      );
      const reportPage = await browser.newPage({
        viewport: { width, height: width === 390 ? 844 : 900 },
        reducedMotion: "reduce",
        hasTouch: width === 390,
      });
      const reportTable = `homecoming-reports-${width}`;
      const reportKey = `cosyworld.reflected-shore.v1.${reportTable}`;
      reportPage.on("pageerror", (error) => errors.push(error.message));
      try {
        await reportPage.addInitScript(
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
            key: reportKey,
            save: encodeSave(saved),
            seen: Object.keys(profiles),
          },
        );
        await reportPage.goto(`${origin}/?table=${reportTable}`);
        await reportPage.waitForSelector('#hand[data-cooling="false"] .card');
        await reportPage.reload();
        await reportPage.waitForSelector('#hand[data-cooling="false"] .card');
        // Both return reports stay saved; neither becomes a hand card.
        assert.equal(await reportPage.locator("#hand [data-quest]").count(), 0);
        for (const id of ids)
          assert.equal(
            await reportPage.locator(`#hand [data-card="${id}"]`).count(),
            0,
          );
        // Since #1451 Talk carries one want line, not the report titles; the
        // reports stay in Vale's saved hand, checked after the reload below.
        const facts = narrativeContext(saved)
          .entities.find((entity) => entity.id === "vale")
          .facts.join(" ");
        assert.doesNotMatch(
          facts,
          /What I want most now|I also want to pursue/,
        );
        const reloaded = await reportPage.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)),
          reportKey,
        );
        assert.deepEqual(reloaded.quests.hands.vale, saved.quests.hands.vale);
        await reportPage.screenshot({
          path: new URL(`reports-${width}.png`, output).pathname,
          fullPage: true,
        });
      } finally {
        await reportPage.close();
      }
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
      const topic = topicForChoice(fields.choiceId);
      const action = topic
        ? openDoorAction(before, "talk", { target: topic.speaker })
        : openDoorAction(before, kind, fields);
      const cards = action.cards?.length
        ? action.cards
        : [action.item || action.target || "vale"];
      if (kind === "drop" && !cards.includes(fields.target))
        cards.push(fields.target);
      await clearSelection(page);
      for (const id of [...new Set(cards)])
        await selectCard(page, id, { touch: width === 390 });
      const selector = topic
        ? `#card-actions [data-action="talk"]`
        : fields.choiceId
          ? `#card-actions [data-choice="${fields.choiceId}"]`
          : `#card-actions [data-action="${kind}"]`;
      await page.locator(selector).first().click();
      await settle();
      const after = await state();
      assert.equal(after.turn, before.turn + 1, `${kind} commits once`);
      if (fields.choiceId)
        assert.equal(
          after.packs["greek-drama"].receipts[fields.choiceId],
          after.turn,
        );
      if (kind === "accompany") {
        assert.equal(after.actors.vale.place, fields.destination);
        assert.equal(after.actors[fields.target].place, fields.destination);
      }
      assert.ok(questCards(after).length <= 2, "two quest cards fit the hand");
    };
    try {
      await page.goto(`${origin}/?table=${table}`);
      await settle();
      await step({
        kind: "choose",
        choiceId: openDoorInvitation(await state()).choiceId,
      });
      await step({ kind: "drop", item: "lamp", target: "greek-courtyard" });
      for (const action of homecomingSteps({ berth, reading })) {
        await step(action);
        if (action.choiceId === "greek-open-door-eleusis-care")
          await checkReportCards(await state());
        if (action.choiceId === `greek-homecoming-report-piraeus-${berth}`) {
          const world = await state();
          assert.notEqual(
            world.packs["greek-drama"].flags["greek-open-door-colonus-done"],
            true,
          );
          assert.notEqual(
            world.packs["greek-drama"].flags["greek-open-door-marathon-done"],
            true,
          );
          await capture("early-dione-return");
        }
        if (action.choiceId === "greek-homecoming-agree-journey") {
          await capture("agreed-journey");
          const world = await state();
          const quest = questCards(world, "greek-household-witness").find(
            (card) =>
              card.key === "greek-drama:story-quest-greek-homecoming-household",
          );
          assert.ok(quest, "Myrine holds her journey card");
          assert.equal(
            await page.locator("#hand [data-quest]").count(),
            0,
            "Myrine's journey stays out of the hand",
          );
          await capture("myrine-quest");
          await page.keyboard.press("Escape");
          const before = await state();
          await page.reload();
          await settle();
          assert.deepEqual(
            (await state()).packs,
            before.packs,
            "agreement survives reload",
          );
        }
        if (action.kind === "accompany") await capture("household-at-quay");
        if (action.choiceId === `greek-homecoming-receive-${berth}`)
          await capture("received-household");
        if (action.choiceId === `greek-homecoming-read-${reading}-${berth}`)
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
        "completed reading survives reload",
      );
      assert.deepEqual(
        (await state()).questCompletions,
        completed.questCompletions,
        "rewards remain once",
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
        `Homecoming: ${width}px, ${berth} care, ${reading} reading, distinct report cards, early return, consent, real travel, custody, and reload passed.`,
      );
    } finally {
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
