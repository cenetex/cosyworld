import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { installQuestCollection, programsFor } from "../card-game/quests.mjs";
import {
  registerPersonalQuest,
  collectionCards,
} from "../card-game/shared-quests.mjs";
import { questCards, questCardId } from "../card-game/quest-cards.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

function fixture() {
  const world = enableMotives(createWorld(), { personalQuests: true });
  world.actors.moth.place = world.actors.vale.place;
  for (const actor of ["vale", "moth"]) {
    installQuestCollection(world, actor);
    const collection = world.life.actors[actor].collection;
    const record = registerPersonalQuest(world, actor, {
      key: `${actor}:quest:${collection.next++}`,
      program: structuredClone(programsFor(world, actor)[1]),
      step: 0,
      origin: {
        kind: "talk",
        other: actor === "vale" ? "moth" : "vale",
        item: null,
        place: "station",
        turn: world.turn,
      },
      createdTurn: world.turn,
      completedTurn: null,
    });
    collection.cards.push(record.key);
  }
  return world;
}
const output = new URL("../../output/card-quest-collection/", import.meta.url);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    const world = fixture();
    const player = questCards(world),
      npc = questCards(world, "moth");
    const pending = questCardId(world, player[1]),
      npcTop = questCardId(world, npc[0]);
    const key = `cosyworld.reflected-shore.v1.quest-stack-${width}`;
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ key, save, seen }) => {
        localStorage.setItem(key, save);
        localStorage.setItem(
          `${key}.quests`,
          JSON.stringify({ seen, read: [] }),
        );
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false }),
        );
      },
      { key, save: encodeSave(world), seen: player.map((q) => q.key) },
    );
    await page.route("**/card-game/text", (route) => {
      const input = route.request().postDataJSON();
      return route.fulfill({
        json: {
          revision: input.revision,
          model: "quest-smoke",
          entries: input.entities.map((e) => ({
            id: e.id,
            text: "There is something worth thinking about.",
          })),
        },
      });
    });
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=quest-stack-${width}`,
    );
    await selectCard(page, "vale");
    const frames = page.locator('#hand .quest-frame[data-holder="vale"]');
    assert.equal(await frames.count(), 2);
    assert.equal(await frames.nth(1).getAttribute("data-stacked"), "true");
    const order = await page
      .locator("#hand [data-card]")
      .evaluateAll((cards) => cards.map((card) => card.dataset.card));
    assert(order.indexOf("lamp") < order.indexOf("player-quest"));
    assert(order.indexOf("player-quest") < order.indexOf(pending));
    await page.screenshot({
      path: new URL(`stack-${width}.png`, output).pathname,
    });
    await selectCard(page, "player-quest");
    assert.equal(await frames.nth(1).getAttribute("data-stacked"), "false");
    await selectCard(page, pending);
    assert.equal(
      await page.locator('#card-actions [data-action="drop-quest"]').count(),
      1,
    );
    assert.equal(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)).revision,
        key,
      ),
      world.revision,
    );
    await page.screenshot({
      path: new URL(`browse-${width}.png`, output).pathname,
    });
    await selectCard(page, "moth");
    await selectCard(page, npcTop);
    assert.equal(
      await page.locator('#card-actions [data-action="drop-quest"]').count(),
      0,
    );
    assert.equal(
      await page.locator('#hand .quest-frame[data-holder="moth"]').count(),
      2,
    );
    await selectCard(page, "player-quest");
    await selectCard(page, pending);
    await page.locator('#card-actions [data-action="drop-quest"]').click();
    await page.waitForFunction(
      ({ key, active }) =>
        JSON.parse(localStorage.getItem(key)).quests.records[active].droppedBy
          ?.vale !== undefined,
      { key, active: player[1].key },
    );
    const saved = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      key,
    );
    assert(saved.life.actors.vale.collection.cards.includes(player[0].key));
    assert.equal(questCards(saved).length, 1);
    assert.equal(questCards(saved)[0].key, player[0].key);
    await page.reload();
    await selectCard(page, "vale");
    assert.equal(
      await page.locator('#hand .quest-frame[data-holder="vale"]').count(),
      1,
    );
    assert.equal(
      collectionCards(saved, "vale").find((q) => q.key === player[1].key).step,
      0,
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "Two-card quest stacks, Drop, saved history, reload and NPC browsing passed at desktop and phone widths.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
