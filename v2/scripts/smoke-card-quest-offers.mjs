// Quest offers are cards you can tap (rules 133, #2605). From a fresh world:
// the shut pond offers no quest and says why; Pip's Talk lays his Accept
// quest card beside him; chosen, it has exactly one button; pressing it takes
// the quest with no turn passing, the offer is gone and the held quest card
// is there; another offer then shows its reason as the button's label;
// meeting the want pays XP with no Claim; at the level's threshold the
// level-up card appears, is taken and the attic's Sleep raises the level.
//
//   node v2/scripts/smoke-card-quest-offers.mjs [screenshot-dir]
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { decodeSave, encodeSave } from "../card-game/world.mjs";
import { newWant } from "../card-game/want.mjs";
import { greekErrands } from "../../test/helpers/greek-opening.mjs";
import { journeyWorlds } from "../../test/helpers/journey.mjs";
import { questCards } from "../../test/journeys/quest-cards.mjs";
import {
  clearSelection,
  putOutOpening,
  selectCard,
  smokeWidths,
  tapCard,
} from "./card-browser-helpers.mjs";

const output = new URL(
  process.argv[2]
    ? `file://${process.argv[2].replace(/\/?$/u, "/")}`
    : "../../output/quest-offers/",
  import.meta.url,
);
await mkdir(output, { recursive: true });
const BLOCKED = "Finish or discard your quest first";
const journey = journeyWorlds(questCards);
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH,
  });
  for (const width of smokeWidths([1440, 390, 320])) {
    const height = width === 1440 ? 900 : width === 390 ? 844 : 640;
    const open = async (name, world) => {
      const page = await browser.newPage({
        viewport: { width, height },
        reducedMotion: "reduce",
      });
      page.setDefaultTimeout(20000);
      const key = `cosyworld.reflected-shore.v1.${name}-${width}`;
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      if (world)
        await page.addInitScript(
          ({ key, save, seen }) => {
            if (!localStorage.getItem(key)) {
              localStorage.setItem(key, save);
              localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
            }
            localStorage.setItem("cosyworld.dialogue.sound", "off");
          },
          {
            key,
            save: encodeSave(world),
            seen: [
              ...Object.keys(world.actors),
              ...Object.keys(world.items),
              ...Object.keys(world.locations),
            ],
          },
        );
      await page.route("**/card-game/text", (route) => {
        const context = route.request().postDataJSON();
        return route.fulfill({
          json: {
            revision: context.revision,
            model: "quest-offers-fixture",
            entries: context.entities.map(({ id }) => ({
              id,
              text: "There is room beside the lamp.",
            })),
          },
        });
      });
      const state = () =>
        page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
      const ready = async () => {
        for (let i = 0; i < 250; i++) {
          if ((await page.locator("#hand").getAttribute("data-cooling")) === "false")
            return;
          if (await page.locator("#dialogue-advance").isVisible())
            await page.locator("#dialogue-advance").click();
          await page.waitForTimeout(40);
        }
        throw new Error("The hand stayed busy.");
      };
      const shot = async (label) => {
        await page.waitForTimeout(900);
        await page.screenshot({
          path: new URL(`${label}-${width}.png`, output).pathname,
        });
      };
      // Exactly one button per chosen card, and nothing is clipped or
      // under the action bar.
      const oneButton = async () => {
        const buttons = await page.locator("#card-actions button").count();
        assert(buttons <= 1, `the action row has ${buttons} buttons`);
        return buttons;
      };
      const layout = async () => {
        const problems = await page.evaluate(() => {
          const bar = document.getElementById("action-beat").getBoundingClientRect();
          const out = [];
          for (const el of document.querySelectorAll('#hand [data-card^="quest:"]')) {
            const frame = el.parentElement;
            if (frame.hidden) continue;
            const box = el.getBoundingClientRect();
            if (box.width < 40 || box.height < 40) out.push(`${el.dataset.card} is tiny`);
            if (box.right < 0 || box.left > innerWidth + 1) continue;
            if (box.top < 0 || box.bottom > innerHeight + 2)
              out.push(`${el.dataset.card} leaves the page`);
            if (box.top < bar.bottom && box.bottom > bar.top && box.top > bar.top)
              out.push(`${el.dataset.card} lies under the action bar`);
          }
          return out;
        });
        assert.deepEqual(problems, []);
      };
      return { page, key, errors, state, ready, shot, oneButton, layout };
    };
    const offerCards = (page) => page.locator('#hand [data-card^="quest:"]');
    const label = async (page) =>
      (await page.locator("#card-actions button").first().getAttribute("data-tap-verb")) ||
      (await page.locator("#card-actions button").first().textContent());

    // 1. A fresh world: the pond is shut, offers nothing, and says why.
    {
      const t = await open("quest-offers-fresh");
      const { page } = t;
      await page.goto(`${origin}/?table=quest-offers-fresh-${width}`);
      await page.locator('[data-card="lamp"]').waitFor({ state: "attached" });
      await t.ready();
      assert.equal(await offerCards(page).count(), 0);
      // The shut pond has no quest; its one disabled button says why.
      await selectCard(page, "pond");
      assert.equal(await t.oneButton(), 1);
      const shut = page.locator("#card-actions button").first();
      assert.equal(await shut.isDisabled(), true);
      assert.equal(await shut.textContent(), "Locked");
      assert.match(await page.locator(".action-beat-text").textContent(), /lamp/iu);
      assert.equal(await offerCards(page).count(), 0);
      await t.shot("pond-shut");
      await putOutOpening(page);
      await t.ready();
      await page.waitForFunction(
        () => !document.querySelector("#hand [data-revealing]"),
      );
      assert.equal(await offerCards(page).count(), 0);
      assert.deepEqual((await t.state()).opened, { pond: ["vale"] });
      // The lamp out, the pond is open: go to Pip.
      await clearSelection(page);
      await selectCard(page, "pond");
      await page.locator("#card-actions .card-primary").click();
      await t.ready();
      assert.equal((await t.state()).actors.vale.place, "pond");
      assert.equal(await offerCards(page).count(), 0, "no offer before Pip is heard");
      await clearSelection(page);
      await selectCard(page, "moth");
      await page.locator('#card-actions [data-action="talk"]').click();
      await t.ready();
      // 2. Pip's offer card lies in the hand.
      const offer = offerCards(page);
      await offer.first().waitFor({ state: "attached" });
      assert.deepEqual(
        await offer.evaluateAll((els) => els.map((el) => el.dataset.card)),
        ["quest:from:moth"],
      );
      assert.equal(await page.locator("#hand .want-frame").count(), 0, "nothing is held yet");
      await clearSelection(page);
      const turn = (await t.state()).turn;
      await selectCard(page, "quest:from:moth");
      await t.ready();
      assert.equal(await t.oneButton(), 1);
      assert.equal(await label(page), "Accept quest");
      assert.equal(await page.locator("#card-actions button").first().isDisabled(), false);
      await t.layout();
      await t.shot("offer");
      // 3. Pressing it takes the quest and passes no turn.
      await page.locator("#card-actions button").first().click();
      await page.waitForFunction(
        () => !document.querySelector('#hand [data-card="quest:from:moth"]'),
      );
      const taken = await t.state();
      assert.equal(taken.turn, turn, "taking a quest passes no turn");
      assert.deepEqual(
        { kind: taken.actors.vale.want.kind, target: taken.actors.vale.want.target },
        { kind: "item", target: "lamp" },
      );
      assert.equal(await offerCards(page).count(), 0);
      assert.equal(await page.locator("#hand .want-frame").count(), 1, "the held quest card");
      await t.oneButton();
      // Held, it lies behind Vale; her stack opens it, with its one button.
      await clearSelection(page);
      await selectCard(page, "vale");
      const fold = page.locator("#hand .quest-fold");
      if (await fold.isVisible()) await fold.click();
      else await tapCard(page.locator('#hand [data-quest-id="quest:0"].want-card'));
      await page.locator("#hand .want-frame:not([hidden]) > .want-card").waitFor();
      assert.equal(await t.oneButton(), 1);
      await t.shot("held");
      assert.deepEqual(t.errors, []);
      await page.close();
    }

    // 4. Meeting the want pays XP and needs no Claim.
    {
      const t = await open("quest-offers-met", decodeSave(encodeSave(journey.accepted)));
      const { page } = t;
      await page.goto(`${origin}/?table=quest-offers-met-${width}`);
      await page.locator('[data-card="vale"]').waitFor({ state: "attached" });
      await t.ready();
      const xp = (await t.state()).actors.vale.xp;
      await clearSelection(page);
      await selectCard(page, "lamp");
      await selectCard(page, "moth");
      await page.locator('#card-actions [data-action="give"]').click();
      await t.ready();
      const met = await t.state();
      assert(met.actors.vale.xp > xp, "XP rose");
      assert.equal(met.actors.vale.want, null);
      assert.equal(await page.getByText(/claim/i).count(), 0);
      assert.deepEqual(t.errors, []);
      await page.close();
    }

    // 5. The level threshold deals the level-up card; take it, sleep at home.
    {
      const t = await open("quest-offers-level", decodeSave(encodeSave(journey.met)));
      const { page } = t;
      await page.goto(`${origin}/?table=quest-offers-level-${width}`);
      await page.locator('[data-card="vale"]').waitFor({ state: "attached" });
      await t.ready();
      const level = page.locator('#hand [data-card="quest:level"]');
      await level.waitFor({ state: "attached" });
      await selectCard(page, "quest:level");
      assert.equal(await t.oneButton(), 1);
      assert.equal(await label(page), "Take level up quest");
      await t.layout();
      await t.shot("level-up");
      await page.locator("#card-actions button").first().click();
      await page.waitForFunction(
        () => !document.querySelector('#hand [data-card="quest:level"]'),
      );
      const saved = await t.state();
      assert.equal(saved.actors.vale.want.quest.level, 2);
      assert.deepEqual(t.errors, []);
      await page.close();
    }

    // 6. A held quest blocks every other offer; Discard returns them.
    {
      const world = decodeSave(encodeSave(journey.told));
      world.actors.vale.want = newWant("item", "cloth", world.turn);
      const t = await open("quest-offers-blocked", world);
      const { page } = t;
      await page.goto(`${origin}/?table=quest-offers-blocked-${width}`);
      await page.locator('[data-card="vale"]').waitFor({ state: "attached" });
      await t.ready();
      await selectCard(page, "quest:from:moth");
      assert.equal(await t.oneButton(), 1);
      const button = page.locator("#card-actions button").first();
      assert.equal(await button.isDisabled(), true);
      assert.equal((await button.textContent()).trim(), BLOCKED);
      assert.doesNotMatch(await button.textContent(), /asleep/iu);
      await t.layout();
      await t.shot("blocked");
      // Discard returns the offers.
      await clearSelection(page);
      await selectCard(page, "vale");
      const fold = page.locator("#hand .quest-fold");
      if (await fold.isVisible()) await fold.click();
      else await tapCard(page.locator('#hand [data-quest-id="quest:0"].want-card'));
      assert.equal(await t.oneButton(), 1);
      const drop = page.locator("#card-actions [data-drop-quest]");
      await drop.click();
      await page.locator("#card-actions [data-drop-quest]").click();
      await t.ready();
      assert.equal((await t.state()).actors.vale.want, null);
      await selectCard(page, "quest:from:moth");
      assert.equal(await t.oneButton(), 1);
      assert.equal(await label(page), "Accept quest");
      assert.deepEqual(t.errors, []);
      await page.close();
    }

    // 7. A shut box's quest is an offer too, beside the box's own button.
    {
      const world = structuredClone(greekErrands().decree);
      world.actors.vale.place = "greek-gate";
      world.crossings["pond-greek-harbor"].discovered = true;
      for (const id of ["lamp", "cloth"]) world.items[id].holder = "pond";
      const t = await open("quest-offers-gate", world);
      const { page } = t;
      await page.goto(`${origin}/?table=quest-offers-gate-${width}`);
      await page.locator('[data-card="vale"]').waitFor({ state: "attached" });
      await t.ready();
      assert.equal(await offerCards(page).count(), 1);
      await selectCard(page, "greek-battlefield");
      assert.equal(await t.oneButton(), 1);
      assert.equal(await page.locator("#card-actions button").first().textContent(), "Locked");
      await clearSelection(page);
      await selectCard(page, "quest:box:greek-battlefield");
      assert.equal(await t.oneButton(), 1);
      assert.equal(await label(page), "Take quest");
      await t.layout();
      await t.shot("box-offer");
      await page.locator("#card-actions button").first().click();
      await page.waitForFunction(
        () => !document.querySelector('#hand [data-card="quest:box:greek-battlefield"]'),
      );
      assert.equal((await t.state()).actors.vale.want.target, "greek-creon-writ");
      assert.deepEqual(t.errors, []);
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log("Quest offer cards passed.");
