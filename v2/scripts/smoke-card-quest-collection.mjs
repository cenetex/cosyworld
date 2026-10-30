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
import { questCards } from "../card-game/quest-cards.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

function fixture() {
  const world = enableMotives(createWorld(), { personalQuests: true });
  world.actors.moth.place = world.actors.vale.place;
  world.items.lamp.holder = "vale";
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
    const player = questCards(world);
    const key = `cosyworld.reflected-shore.v1.quest-stack-${width}`;
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ key, save, seen }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
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
    const requests = [];
    await page.route("**/card-game/text", (route) => {
      const input = route.request().postDataJSON();
      requests.push(input);
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
    assert.equal(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)).items.lamp.holder,
        key,
      ),
      "vale",
    );
    // The hand holds people, items and places only.
    assert.equal(await page.locator("#hand .quest-frame").count(), 0);
    assert.equal(await page.locator("#hand [data-quest]").count(), 0);
    assert.equal(await page.locator("#hand .quest-preview").count(), 0);
    const order = await page
      .locator("#hand [data-card]")
      .evaluateAll((cards) => cards.map((card) => card.dataset.card));
    assert(order.includes("lamp"));
    assert(!order.some((id) => id.startsWith("quest-card:")));
    assert(!order.includes("player-quest"));
    assert.equal(
      await page.locator('#card-actions [data-action="drop-quest"]').count(),
      0,
    );
    assert.equal(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)).revision,
        key,
      ),
      world.revision,
    );
    await page.screenshot({
      path: new URL(`hand-${width}.png`, output).pathname,
    });
    // Talk carries a want to the model as one narration fact.
    await page.keyboard.press("Escape");
    await selectCard(page, "moth");
    const before = requests.length;
    await page.locator('#card-actions [data-action="talk"]').click();
    await page.waitForFunction(
      ({ key, revision }) =>
        JSON.parse(localStorage.getItem(key)).revision > revision,
      { key, revision: world.revision },
    );
    for (let i = 0; i < 100 && requests.length === before; i++)
      await page.waitForTimeout(50);
    const talk = requests.at(-1);
    assert(talk, "Talk sent a dialogue request");
    // Vale holds the lamp, so only Pip still wants it.
    for (const [actor, want] of [
      ["vale", null],
      ["moth", "lamp"],
    ]) {
      const facts = talk.entities.find((e) => e.id === actor).facts;
      assert.equal(
        facts.includes("I want the Lamp."),
        want !== null,
        `${actor} says what they want`,
      );
      assert(!facts.some((fact) => fact.startsWith("What I want most now")));
      assert(facts.length <= 16);
    }
    const saved = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      key,
    );
    for (const quest of player)
      assert(saved.life.actors.vale.collection.cards.includes(quest.key));
    assert.equal(questCards(saved).length, 2);
    await page.reload();
    await page.waitForSelector('#hand [data-card="vale"]');
    assert.equal(await page.locator("#hand .quest-frame").count(), 0);
    const reloaded = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      key,
    );
    assert.deepEqual(
      collectionCards(reloaded, "vale").map((q) => q.key),
      collectionCards(saved, "vale").map((q) => q.key),
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "Quest-free hand, the Talk want fact, saved quests and reload passed at desktop and phone widths.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
