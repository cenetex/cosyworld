import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { selectCard, tapCard } from "./card-browser-helpers.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const output = new URL("../../output/quest-trade/", import.meta.url);
await mkdir(output, { recursive: true });
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/card-game/text", (route) => {
      const input = route.request().postDataJSON();
      return route.fulfill({
        json: {
          revision: input.revision,
          model: "quest-trade-fixture",
          entries: input.entities.map(({ id }) => ({
            id,
            text: "Thank you for considering my offer.",
          })),
        },
      });
    });
    await page.addInitScript(() => {
      localStorage.setItem("cosyworld.dialogue.sound", "off");
      localStorage.setItem("cosyworld.room-music", '{"enabled":false}');
    });
    const ready = async () => {
      for (let i = 0; i < 500; i++) {
        const advance = page.locator("#dialogue-advance");
        if (
          (await advance.isVisible()) &&
          /Finish reading|Continue to the next beat/u.test(
            await advance.getAttribute("aria-label"),
          )
        ) {
          await advance.click();
          await page.waitForTimeout(40);
          continue;
        }
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
        if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        await page.waitForTimeout(40);
      }
      throw new Error("Quest Trade hand stayed busy");
    };
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    for (const trust of [1, 0]) {
      const world = createWorld({ seed: 7 });
      delete world.opening;
      world.actors.vale.place = world.actors.keeper.place = "pond";
      world.actors.moth.place = "attic";
      world.actors.keeper.trust.vale = trust;
      world.items.oil.holder = "keeper";
      world.items.bell.holder = world.items.cloth.holder = "vale";
      world.items.lamp.holder = "attic";
      const want = (kind, target) => ({ kind, target, since: 0, refusals: 0 });
      world.actors.keeper.want = want("item", "bell");
      world.actors.vale.want = want("item", "oil");
      const table = `quest-trade-${width}-${trust}`;
      const key = `cosyworld.reflected-shore.v1.${table}`;
      const load = async (save) => {
        await page.evaluate(
          ({ key, save }) => {
            localStorage.setItem(key, save);
            localStorage.setItem(
              `${key}.seen`,
              JSON.stringify([
                "vale",
                "keeper",
                "pond",
                "bell",
                "cloth",
                "oil",
              ]),
            );
          },
          { key, save },
        );
        await page.goto(
          `http://127.0.0.1:${server.address().port}/?table=${table}`,
        );
        await ready();
      };
      const state = () =>
        page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
      const button = (kind) =>
        page.locator(
          `#card-actions [data-action="${kind}"]:not([data-revealing="true"])`,
        );
      const goal = () =>
        page.locator('#hand .want-card[data-quest-id="quest:0"]');
      await load(encodeSave(world));
      await selectCard(page, "bell");
      await selectCard(page, "keeper");
      await button("give").click();
      await ready();
      const afterGift = await state();
      assert.equal(afterGift.actors.keeper.heldItem, "bell");
      assert.equal(afterGift.items.oil.holder, "keeper");
      if (!trust) {
        // Open the whole quest stack, then keep the chosen payment through Focus.
        afterGift.actors.vale.under = [afterGift.actors.vale.want];
        afterGift.actors.vale.want = want("place", "station");
        await load(JSON.stringify(afterGift));
      }
      const fold = page.locator("#hand .quest-fold");
      if (await fold.isVisible()) await selectCard(page, "vale");
      await tapCard(goal());
      await ready();
      await page.waitForFunction(() =>
        document.querySelector('#hand .want-card[aria-pressed="true"]'),
      );
      if (trust) {
        await page
          .locator('[data-drop-quest]:not([data-revealing="true"])')
          .waitFor();
        assert.match(await page.locator("#action-beat").innerText(), /Oil/u);
        assert.equal(await button("trade").count(), 0);
        assert.equal(await page.locator("[data-drop-quest]").count(), 1);
      }
      await selectCard(page, "cloth");
      if (!trust) {
        const turn = (await state()).turn;
        await tapCard(
          page.locator('#hand .want-card[data-quest-id="quest:1"]'),
        );
        await button("trade").waitFor();
        assert.equal((await state()).turn, turn, "Focus keeps the turn");
        assert.equal((await state()).actors.vale.want.target, "oil");
      }
      await button("trade").waitFor();
      if (trust) {
        // A second tap lowers the payment; the quest keeps its full details.
        await tapCard(page.locator('#hand [data-card="cloth"]'));
        assert.equal(await button("trade").count(), 0);
        assert.equal(await goal().getAttribute("aria-pressed"), "true");
        await page
          .locator('[data-drop-quest]:not([data-revealing="true"])')
          .waitFor();
        assert.match(await page.locator("#action-beat").innerText(), /Oil/u);
        await tapCard(page.locator('#hand [data-card="cloth"]'));
      }
      await button("trade").waitFor();
      assert.equal(await page.locator("#card-actions button").count(), 1);
      const text = await page.locator("#action-beat").innerText();
      for (const name of ["Black cloth", "Oil flask", "keeper"])
        assert.ok(text.includes(name), text);
      assert.equal(
        await page
          .locator('#hand [data-card="cloth"]')
          .getAttribute("aria-pressed"),
        "true",
      );
      await page.screenshot({
        path: new URL(`offer-${width}-${trust}.png`, output).pathname,
      });
      await button("trade").click();
      await ready();
      const result = await state();
      assert.equal(
        result.log.findLast((event) => event.verb === "trade").accepted,
        Boolean(trust),
      );
      assert.equal(result.items.oil.holder, trust ? "vale" : "keeper");
      assert.equal(result.items.cloth.holder, trust ? "keeper" : "vale");
      console.log(
        `Quest Trade ${trust ? "accepted" : "refused"}, explicit payment and first-tap details passed at ${width}px.`,
      );
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
