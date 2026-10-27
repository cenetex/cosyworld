import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave, decodeSave } from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { addQuestRecord } from "../card-game/shared-quests.mjs";
import { questCards, questCardId } from "../card-game/quest-cards.mjs";
import { openingFixture } from "../../test/helpers/greek-opening.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

const output = new URL("../../output/card-shared-quests/", import.meta.url);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    const world = enableMotives(createWorld(), {
      questPrograms: true,
      personalQuests: true,
    });
    world.items.lamp.holder = "vale";
    const quest = addQuestRecord(world, {
      holder: { kind: "item", id: "lamp" },
      participants: ["vale", "moth"],
      program: {
        id: "shared-water",
        name: "Meet by the water",
        steps: [{ items: [], avatars: [], location: "pond" }],
      },
    });
    const table = `shared-quests-${width}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
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
          JSON.stringify({ seen, read: seen }),
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
        seen: [quest.key, ...questCards(world).map((q) => q.key)],
      },
    );
    await page.route("**/card-game/text", (route) => {
      const input = route.request().postDataJSON();
      return route.fulfill({
        json: {
          revision: input.revision,
          model: "shared-quest-smoke",
          entries: input.entities.map((e) => ({
            id: e.id,
            text: "We can meet beside the water.",
          })),
        },
      });
    });
    const saved = async () =>
      decodeSave(await page.evaluate((key) => localStorage.getItem(key), key));
    const finish = async () => {
      for (let i = 0; i < 150; i++) {
        if (await page.locator("#unveil-dialog[open]").count())
          await page.keyboard.press("Escape");
        else if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        await page.waitForTimeout(60);
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
      }
      throw Error("Shared quest exchange stayed busy");
    };
    const view = (state, holder) =>
      questCards(state, holder).find((q) => q.key === quest.key);
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=${table}`,
    );
    await finish();
    await selectCard(page, questCardId(world, view(world, "vale")));
    assert.equal((await saved()).revision, world.revision);
    assert.deepEqual(
      await page.locator("#card-actions button").allTextContents(),
      ["Drop"],
    );
    let state = await saved();
    assert(state.quests.records[quest.key].participants.includes("vale"));
    assert.deepEqual(state.quests.records[quest.key].holder, {
      kind: "item",
      id: "lamp",
    });
    for (const holder of ["vale", "lamp"]) {
      const card = view(state, holder);
      assert(card);
      const id = questCardId(state, card);
      if (
        (await page
          .locator(`#hand [data-card="${id}"]`)
          .getAttribute("aria-pressed")) !== "true"
      )
        await selectCard(page, id);
      assert.match(
        await page.locator("#selection-name").textContent(),
        /Meet by the water/,
      );
    }
    await page.screenshot({
      path: new URL(`holder-${width}.png`, output).pathname,
    });
    await page.reload();
    await finish();
    state = await saved();
    assert.equal(
      Object.values(state.quests.records).filter((q) => q.key === quest.key)
        .length,
      1,
    );
    await selectCard(page, "pond");
    await page.locator('#card-actions [data-action="move"]').click();
    await finish();
    state = await saved();
    for (const holder of ["vale", "lamp"]) {
      assert.equal(view(state, holder).status, "fulfilled");
      await selectCard(page, questCardId(state, view(state, holder)));
    }
    assert.equal(state.quests.records[quest.key].step, 1);
    await page.screenshot({
      path: new URL(`fulfilled-${width}.png`, output).pathname,
    });
    assert.deepEqual(errors, []);
    await page.close();
    const travelled = dispatchShared({
      op: "create",
      save: encodeSave(openingFixture("refusal").waterOffer),
    }).world;
    const remote = dispatchShared({
      world: travelled,
      op: "view",
      actor: "mara",
      claimed: ["vale", "mara"],
      present: ["vale", "mara"],
    }).world;
    const remoteTable = `remote-quest-${width}`;
    const remoteKey = `cosyworld.reflected-shore.v1.${remoteTable}`;
    const remotePage = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    await remotePage.addInitScript(
      ({ key, save }) => {
        localStorage.setItem(key, save);
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false }),
        );
      },
      { key: remoteKey, save: encodeSave(remote) },
    );
    await remotePage.route("**/card-game/text", (route) => {
      const input = route.request().postDataJSON();
      return route.fulfill({
        json: {
          revision: input.revision,
          model: "shared-quest-smoke",
          entries: input.entities.map((e) => ({
            id: e.id,
            text: "I am here at home.",
          })),
        },
      });
    });
    await remotePage.goto(
      `http://127.0.0.1:${server.address().port}/?table=${remoteTable}`,
    );
    await remotePage.locator('#hand [data-card="mara"]').waitFor();
    assert.equal(
      await remotePage.locator('#hand [data-quest^="greek-drama:"]').count(),
      0,
    );
    assert.equal(
      await remotePage
        .locator('#hand [data-card^="story-quest-greek-"]')
        .count(),
      0,
    );
    assert.equal(
      await remotePage
        .locator('#card-actions [data-action="join-quest"]')
        .count(),
      0,
    );
    await remotePage.screenshot({
      path: new URL(`mara-home-${width}.png`, output).pathname,
    });
    await remotePage.close();
  }
  console.log(
    "Shared holder cards, Drop-only controls, reload and one completion passed at desktop and phone widths.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
