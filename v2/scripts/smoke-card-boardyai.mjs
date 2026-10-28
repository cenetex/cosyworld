import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { questCards, questCardId } from "../card-game/quest-cards.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const output = new URL("../../output/card-boardyai/", import.meta.url);
await mkdir(output, { recursive: true });
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    const seed = dispatchShared({
      op: "create",
      save: encodeSave(enableMotives(createWorld(), { personalQuests: true })),
    }).world;
    const started = dispatchShared({
      op: "play",
      world: seed,
      actor: "vale",
      claimed: ["vale", "mara"],
      present: ["vale", "mara"],
      action: { key: "wait:vale::" },
    }).world;
    const world = dispatchShared({
      op: "view",
      world: started,
      actor: "vale",
      claimed: ["vale", "mara"],
      present: ["vale", "mara"],
    }).world;
    const quest = questCardId(world, questCards(world, "boardyai")[0]);
    const table = `boardyai-${width}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ key, save }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false }),
        );
      },
      { key, save: encodeSave(world) },
    );
    await page.route("**/card-game/text", (route) => {
      const input = route.request().postDataJSON();
      return route.fulfill({
        json: {
          revision: input.revision,
          model: "boardy-smoke",
          entries: input.entities.map((e) => ({
            id: e.id,
            text: "Who would you like to meet?",
          })),
        },
      });
    });
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=${table}`,
    );
    await page.locator('#hand [data-card="boardyai"]').waitFor();
    await page.locator('#cast [data-avatar="boardyai"]').waitFor();
    await selectCard(page, "boardyai");
    await selectCard(page, quest);
    const card = page.locator(`#hand [data-card="${quest}"]`);
    await page
      .locator("#hand img")
      .evaluateAll((images) => Promise.all(images.map((img) => img.decode())));
    assert(
      await card.evaluate((face) => {
        const purpose = face
          .querySelector(".quest-purpose")
          .getBoundingClientRect();
        const bounds = face.getBoundingClientRect();
        return purpose.bottom <= bounds.bottom && purpose.bottom <= innerHeight;
      }),
      "the selected quest fits on screen",
    );
    assert.equal(await card.getAttribute("data-quest-status"), "active");
    assert.match(await card.textContent(), /Help Vale and Mara meet/);
    const portrait = page.locator('#cast [data-avatar="boardyai"] img').first();
    assert(
      await portrait.evaluate((img) => img.complete && img.naturalWidth > 0),
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: new URL(`quest-${width}.png`, output).pathname,
    });
    await page.keyboard.press("Escape");
    await selectCard(page, "boardyai");
    await page.locator('#card-actions [data-action="talk"]').click();
    await page.waitForFunction((key) => {
      const saved = JSON.parse(localStorage.getItem(key));
      return (
        saved.turn === 2 &&
        saved.log.some((e) => e.generated && e.actorId === "boardyai")
      );
    }, key);
    const settle = async () => {
      for (let i = 0; i < 180; i++) {
        if (await page.locator("#unveil-dialog[open]").count())
          await page.keyboard.press("Escape");
        else if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        await page.waitForTimeout(60);
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) ===
            "false" &&
          (await page.locator("#card-actions").getAttribute("aria-busy")) ===
            "false"
        )
          return;
      }
      throw Error("BoardyAI's visit stayed busy.");
    };
    await settle();
    for (const [id, kind, turn, place] of [
      ["boardyai-calling-card", "take", 3, "station"],
      ["boardyai-parlour", "move", 4, "boardyai-parlour"],
      ["station", "move", 5, "station"],
    ]) {
      await page.keyboard.press("Escape");
      await selectCard(page, id);
      await page.locator(`#card-actions [data-action="${kind}"]`).click();
      await page.waitForFunction(
        ({ key, turn }) => JSON.parse(localStorage.getItem(key)).turn === turn,
        { key, turn },
      );
      await settle();
      assert.equal(
        await page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)).actors.vale.place,
          key,
        ),
        place,
      );
      if (place === "boardyai-parlour")
        await page.screenshot({
          path: new URL(`parlour-${width}.png`, output).pathname,
        });
    }
    await page.reload();
    await page.locator('#hand [data-card="vale"]').waitFor();
    await selectCard(page, "boardyai-calling-card");
    assert.equal(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)).turn,
        key,
      ),
      5,
    );
    assert.equal(
      await page.locator('#hand [data-card="boardyai-calling-card"]').count(),
      1,
    );
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `BoardyAI avatar, quest, conversation, calling card, home, return and reload passed at ${width}x${height}.`,
    );
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
