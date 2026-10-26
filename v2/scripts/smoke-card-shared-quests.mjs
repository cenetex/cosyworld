import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave, decodeSave } from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { addQuestRecord } from "../card-game/shared-quests.mjs";
import { questCards, questCardId } from "../card-game/quest-cards.mjs";
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
      holder: { kind: "place", id: "station" },
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
    await selectCard(page, questCardId(world, view(world, "station")));
    assert.equal((await saved()).revision, world.revision);
    await page.locator('#card-actions [data-action="join-quest"]').click();
    await finish();
    let state = await saved();
    assert(state.quests.records[quest.key].participants.includes("vale"));
    await selectCard(page, questCardId(state, view(state, "vale")));
    await page.getByRole("button", { name: /Share with lamp/i }).click();
    await finish();
    state = await saved();
    assert.deepEqual(state.quests.records[quest.key].holder, {
      kind: "item",
      id: "lamp",
    });
    for (const holder of ["vale", "lamp"]) {
      const card = view(state, holder);
      assert(card);
      await selectCard(page, questCardId(state, card));
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
  }
  console.log(
    "Shared holder cards, Help, Share, reload and one completion passed at desktop and phone widths.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
