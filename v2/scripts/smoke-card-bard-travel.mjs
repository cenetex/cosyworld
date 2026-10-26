import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  createWorld,
  encodeSave,
  play,
  legalActions,
} from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { addQuestRecord } from "../card-game/shared-quests.mjs";
import { recordQuestCompletion } from "../card-game/quest-completions.mjs";
import { questCards, questCardId } from "../card-game/quest-cards.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

const singer = "greek-rhapsode";
function fixture() {
  let s = enableMotives(createWorld(), { personalQuests: true });
  s.sharedVersion = 1;
  s.controlledActors = ["vale"];
  s.presentActors = ["vale"];
  s.actors.vale.place = "theatre";
  s.actors[singer].place = "theatre";
  s.items.mask.holder = "theatre";
  const q = addQuestRecord(s, {
    holder: { kind: "place", id: "pond" },
    program: {
      id: "shore-deed",
      name: "A deed by the shore",
      steps: [{ items: [], avatars: [], location: "pond" }],
    },
  });
  q.completedTurn = s.turn;
  q.step = 1;
  recordQuestCompletion(s, q, { actorId: "keeper", locationId: "pond" });
  s = play(
    s,
    legalActions(s).find((a) => a.kind === "wait"),
  ).state;
  return s;
}
const output = new URL("../../output/card-bard-travel/", import.meta.url);
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
    const helpKey = world.roamingQuests[singer].blocked.questKey;
    const helpCard = questCards(world, "theatre").find(
      (q) => q.key === helpKey,
    );
    assert(helpCard);
    const key = `cosyworld.reflected-shore.v1.bard-${width}`;
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
      {
        key,
        save: encodeSave(world),
        seen: questCards(world).map((q) => q.key),
      },
    );
    await page.route("**/card-game/text", (route) => {
      const input = route.request().postDataJSON();
      return route.fulfill({
        json: {
          revision: input.revision,
          model: "bard-smoke",
          entries: input.entities.map((e) => ({
            id: e.id,
            text: "The door opens onto the shore.",
          })),
        },
      });
    });
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=bard-${width}`,
    );
    const journey = questCards(world, singer).find(
      (q) => q.key === world.roamingQuests[singer].questKey,
    );
    await selectCard(page, singer);
    await selectCard(page, questCardId(world, journey));
    assert(
      await page
        .locator("#hand")
        .innerText()
        .then((text) => text.includes("Visit Black pond")),
    );
    await page.screenshot({
      path: new URL(`journey-${width}.png`, output).pathname,
    });
    await selectCard(page, "theatre");
    await selectCard(page, questCardId(world, helpCard));
    await page.locator('#card-actions [data-action="join-quest"]').click();
    await page.waitForFunction(
      ({ key, helpKey }) =>
        JSON.parse(localStorage.getItem(key)).quests.records[
          helpKey
        ].participants.includes("vale"),
      { key, helpKey },
    );
    await selectCard(page, "mask");
    await page.locator('#card-actions [data-action="take"]').click();
    await page.waitForFunction(
      ({ key, singer }) =>
        JSON.parse(localStorage.getItem(key)).actors[singer].place === "pond",
      { key, singer },
    );
    let saved = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      key,
    );
    assert.equal(saved.items.mask.holder, "vale");
    assert.equal(saved.quests.records[helpKey].completion.cause.kind, "help");
    await page.reload();
    await page.waitForSelector('#hand [data-card="vale"]');
    await selectCard(page, "pond");
    await page.locator('#card-actions [data-action="move"]').click();
    await page.waitForFunction(
      (key) =>
        JSON.parse(localStorage.getItem(key)).actors.vale.place === "pond",
      key,
    );
    saved = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      key,
    );
    assert.equal(saved.actors[singer].place, "pond");
    assert.equal(
      saved.quests.records[saved.roamingQuests[singer].questKey]
        .completedTurn !== null,
      true,
    );
    await selectCard(page, singer);
    await page.screenshot({
      path: new URL(`arrival-${width}.png`, output).pathname,
    });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "Bard quest cards, shared Help, item-gated travel, arrival and reload passed at desktop and phone widths.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
