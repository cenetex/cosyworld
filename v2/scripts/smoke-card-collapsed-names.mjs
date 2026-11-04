import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { availableCards } from "../card-game/cards.mjs";
import { splitNameWords } from "./card-browser-helpers.mjs";

// A resting hand shows only its cards' art: the name labels and their shade
// are faded out, and they fade back in (instantly under reduced motion) when
// a card is chosen and the hand rises. Each card button keeps its accessible
// name either way.
const output = new URL("../../output/card-collapsed-names/", import.meta.url);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const world = createWorld();
world.items.cloth.holder = "vale";

const labels = () =>
  [...document.querySelectorAll("#hand .card-frame:not([hidden]) > .card")]
    .filter((card) => card.querySelector(".name")?.textContent)
    .map((card) => {
      const name = card.querySelector(".name"),
        style = getComputedStyle(name);
      return {
        id: card.dataset.card,
        aria: card.getAttribute("aria-label") ?? "",
        text: name.textContent,
        shown: style.opacity !== "0" && style.visibility !== "hidden",
        transition: style.transitionDuration,
      };
    });

try {
  const sizes = { 390: 844, 1440: 900 };
  for (const motion of ["reduce", "no-preference"])
    for (const [size, height] of Object.entries(sizes)) {
      const width = Number(size),
        tag = `${width}-${motion}`;
      const key = `cosyworld.reflected-shore.v1.collapsed-names-${tag}`;
      const page = await browser.newPage({
        viewport: { width, height },
        reducedMotion: motion,
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/card-game/text", (route) =>
        route.fulfill({ status: 503, json: { error: "fixture" } }),
      );
      await page.addInitScript(
        ({ key, save, seen }) => {
          localStorage.setItem(key, save);
          localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
          localStorage.setItem("cosyworld.dialogue.sound", "off");
        },
        { key, save: encodeSave(world), seen: availableCards(world) },
      );
      const origin = `http://127.0.0.1:${server.address().port}`;
      await page.goto(`${origin}/?table=collapsed-names-${tag}`);
      const vale = page.locator('#hand [data-card="vale"]');
      await vale.waitFor();
      const settle = async (shown) => {
        await page.mouse.move(0, 0);
        await page.waitForFunction(
          (shown) =>
            [...document.querySelectorAll("#hand .card .name")]
              .filter((name) => name.textContent)
              .every(
                (name) =>
                  getComputedStyle(name).opacity === (shown ? "1" : "0"),
              ),
          shown,
        );
        const cards = await page.evaluate(labels);
        assert.ok(cards.length >= 2, `${tag} cards with names`);
        for (const card of cards) {
          assert.equal(card.shown, shown, `${tag} ${card.id} name shown`);
          assert.ok(
            card.aria.startsWith(`${card.text},`),
            `${tag} ${card.id} accessible name ${card.aria}`,
          );
          assert.equal(
            card.transition,
            motion === "reduce" ? "0s" : "0.12s",
            `${tag} ${card.id} fade`,
          );
        }
        return cards;
      };
      assert.equal(
        await page.evaluate(() => document.body.dataset.handExpanded),
        "false",
      );
      await settle(false);
      await page.screenshot({
        path: new URL(`${tag}-collapsed.png`, output).pathname,
      });
      // Accessible names come from the card buttons, not the faded label.
      const role = await page
        .getByRole("button", { name: /^Vale, avatar/ })
        .count();
      assert.equal(role, 1, `${tag} Vale button by its accessible name`);
      await vale.click();
      await settle(true);
      // A raised name breaks only between words, the game's longest ones too.
      assert.deepEqual(await splitNameWords(page), [], `${tag} names`);
      const names = await page.evaluate(() =>
        [...document.querySelectorAll("#hand .card .name")].map(
          (name) => name.textContent,
        ),
      );
      await page.evaluate(() => {
        const longest = [
          "The Exposed Battlefield",
          "Agamemnon's Tomb",
          "Concordance Tidelands",
          "Hoppy Cat Universe",
        ];
        document
          .querySelectorAll("#hand .card .name")
          .forEach((name, i) => (name.textContent = longest[i % 4]));
      });
      assert.deepEqual(await splitNameWords(page), [], `${tag} long names`);
      await page.evaluate((names) => {
        document
          .querySelectorAll("#hand .card .name")
          .forEach((name, i) => (name.textContent = names[i]));
      }, names);
      await page.screenshot({
        path: new URL(`${tag}-raised.png`, output).pathname,
      });
      // A tap on the scene folds the hand, and the names fade again.
      await page.mouse.click(width / 2, 120);
      await settle(false);
      assert.deepEqual(errors, []);
      await page.close();
    }
  console.log(
    "Collapsed names: resting hands show art only; raised hands show names; aria names stay.",
  );
} finally {
  await browser.close();
  server.close();
}
