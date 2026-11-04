import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { availableCards } from "../card-game/cards.mjs";

// Choosing the avatar shows what it carries and its quests as two stacks
// beside it (#2256). A stack's top card fans it; a card chosen from a fan
// moves left; the avatar folds them back, then lowers.
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const output = new URL("../../output/avatar-stacks/", import.meta.url);
await mkdir(output, { recursive: true });
const world = createWorld();
world.actors.vale.place = "greek-sanctuary";
world.actors.vale.visited.push("pond");
world.crossings["pond-greek-harbor"].discovered = true;
for (const id of ["greek-funeral-cloth", "greek-decree", "lamp"])
  world.items[id].holder = "vale";
const want = (kind, target, step) => ({
  kind,
  target,
  ...(step && { step }),
  since: 0,
  refusals: 0,
});
world.actors.vale.want = want("item", "greek-decree", {
  verb: "give",
  to: "greek-guard",
});
world.actors.vale.under = [
  want("item", "lamp", { verb: "give", to: "greek-ismene" }),
  want("place", "greek-gate"),
];
try {
  for (const [width, height, reducedMotion] of [
    [1440, 900, "no-preference"],
    [390, 844, "reduce"],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion,
      hasTouch: width === 390,
    });
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const table = `avatar-stacks-${width}`,
      key = `cosyworld.reflected-shore.v1.${table}`;
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
      { key, save: encodeSave(world), seen: availableCards(world) },
    );
    await page.route("**/card-game/text", (route) =>
      route.fulfill({ status: 400, json: {} }),
    );
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=${table}`,
    );
    await page.waitForFunction(
      () => document.querySelector("#hand").dataset.cooling === "false",
    );
    // The row as shown: each card, * when raised, + when its stack is open.
    const row = () =>
      page.evaluate(() =>
        [...document.querySelectorAll("#hand > .card-frame:not([hidden])")]
          .map((frame) => {
            const card = frame.querySelector(".card");
            return (
              (card.dataset.card ?? card.dataset.questId) +
              (frame.dataset.raised === "true" ? "*" : "") +
              (card.getAttribute("aria-expanded") === "true" ? "+" : "")
            );
          })
          .join(" "),
      );
    const labels = () => page.locator("#card-actions button").allInnerTexts();
    const tap = async (selector) => {
      const card = page.locator(`#hand ${selector}`);
      if (width === 390) await card.tap({ position: { x: 40, y: 16 } });
      else await card.click({ position: { x: 40, y: 16 } });
      await page.waitForTimeout(500);
    };
    let step = 0;
    const expect = async (name, cards, actions) => {
      assert.equal(await row(), cards, name);
      if (actions) assert.deepEqual(await labels(), actions, name);
      await page.screenshot({
        path: new URL(`${width}-${++step}-${name}.png`, output).pathname,
      });
    };
    const rest = "greek-ismene greek-sanctuary";
    const vale = '[data-card="vale"]';
    await tap(vale);
    await expect("stacks", `vale*+ greek-funeral-cloth quest:0 ${rest}`, [
      "Wait",
    ]);
    // Each stack shows its top card, the rest face down behind it.
    assert.equal(
      await page
        .locator('#hand [data-holder="vale"]:not([hidden]) > .place-edge')
        .count(),
      4,
    );
    await tap('[data-card="greek-funeral-cloth"]');
    const items = "greek-funeral-cloth+ greek-decree lamp";
    await expect("items-fanned", `vale*+ ${items} quest:0 ${rest}`);
    await tap('[data-card="lamp"]');
    await expect(
      "item-chosen",
      `vale+ lamp* greek-funeral-cloth+ greek-decree quest:0 ${rest}`,
      ["Light"],
    );
    // Opening the quests folds the things; a chosen quest moves left.
    await tap('.want-card[data-quest-id="quest:0"]');
    await expect(
      "quests-fanned",
      `vale+ lamp* greek-funeral-cloth quest:0+ quest:1 quest:2 ${rest}`,
    );
    await tap('.want-card[data-quest-id="quest:0"]');
    await expect(
      "quest-chosen",
      `vale+ quest:0* greek-funeral-cloth quest:1+ quest:2 ${rest}`,
      ["Drop quest"],
    );
    // Tapping the chosen quest again only lowers it.
    await tap('.want-card[data-quest-id="quest:0"]');
    assert.equal(
      await row(),
      `vale+ greek-funeral-cloth quest:0+ quest:1 quest:2 ${rest}`,
    );
    await tap(vale);
    await expect("folded-back", `vale*+ greek-funeral-cloth quest:0 ${rest}`);
    await tap(vale);
    await expect("lowered", `vale ${rest}`, []);
    assert.deepEqual(errors, []);
    console.log(
      `Avatar stacks: fold, fan, choose, lower, fold back and deselect passed at ${width}px (${reducedMotion}).`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
