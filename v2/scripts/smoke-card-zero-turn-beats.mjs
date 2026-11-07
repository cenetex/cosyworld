// A pack change waits behind the reply already being read. The next card
// play commits after Continue, while the return message stays in history.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { newWant, setQuests } from "../card-game/want.mjs";
import {
  openSettings,
  closeSettings,
  pressSetting,
  selectCard,
  clearSelection,
  readyActionButton,
  tapCard,
} from "./card-browser-helpers.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const results = [];
function fixture() {
  const s = createWorld();
  s.turn = s.revision = 3;
  s.actors.vale.place = s.actors.moth.place = "station";
  s.actors.vale.visited.push("pond");
  s.actors.keeper.place = "pond";
  s.actors.moth.want = s.actors.keeper.want = null;
  s.items.cloth.holder = "station";
  setQuests(s.actors.vale, [
    newWant("item", "oil", 0),
    newWant("person", "keeper", 0),
  ]);
  return s;
}
const saved = (page, key) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
async function readThrough(page, key, revision) {
  for (let i = 0; i < 8; i++) {
    if ((await saved(page, key)).revision > revision) return;
    await page.locator("#speech-row").click();
    await page.waitForTimeout(250);
  }
  await page.waitForFunction(
    ({ key, revision }) =>
      JSON.parse(localStorage.getItem(key)).revision > revision,
    { key, revision },
  );
}
try {
  for (const width of [1440, 390])
    for (const kind of ["take", "talk", "move", "focus"]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
      });
      page.setDefaultTimeout(12000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const table = `zero-turn-${width}-${kind}`,
        key = `cosyworld.reflected-shore.v1.${table}`;
      const world = fixture();
      await page.addInitScript(
        ({ key, save, seen }) => {
          localStorage.setItem(key, save);
          localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
          localStorage.setItem("cosyworld.dialogue.sound", "off");
          localStorage.setItem(
            "cosyworld.room-music",
            JSON.stringify({ enabled: false }),
          );
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
        const c = route.request().postDataJSON();
        return route.fulfill({
          json: {
            revision: c.revision,
            model: "browser-fixture",
            entries: c.entities.map(({ id }) => ({
              id,
              text:
                id === "vale"
                  ? "I will keep the lamp close."
                  : "There is room beside the lamp.",
            })),
          },
        });
      });
      await page.goto(`${origin}/?table=${table}`);
      await page.locator("#hand .card").first().waitFor();
      if (kind !== "focus") {
        await selectCard(page, "moth");
        await readyActionButton(page, "talk").click();
        await page.waitForFunction(() =>
          /continue/i.test(
            document.querySelector("#speech-hint")?.textContent || "",
          ),
        );
      }
      await openSettings(page);
      await pressSetting(page, "pack-sea");
      await pressSetting(page, "pack-sea");
      await closeSettings(page);
      if (kind !== "focus")
        assert.doesNotMatch(
          await page.locator("#speech-row").textContent(),
          /returns as it was/,
        );
      const before = await saved(page, key);
      assert(
        before.log.some(
          (e) => e.verb === "pack" && /returns as it was/.test(e.text),
        ),
      );
      await clearSelection(page);
      if (kind === "focus") {
        await selectCard(page, "vale");
        const lower = page.locator('#hand [data-quest-id="quest:1"].want-card');
        const fold = page.locator("#hand .quest-fold");
        if (await fold.isVisible()) await fold.click();
        if (!(await lower.isVisible()))
          await tapCard(
            page.locator('#hand [data-quest-id="quest:0"].want-card'),
          );
        await lower.click();
      } else {
        await selectCard(
          page,
          { take: "cloth", talk: "moth", move: "pond" }[kind],
        );
        await readyActionButton(page, kind).click();
      }
      await readThrough(page, key, before.revision);
      const after = await saved(page, key);
      assert.equal(
        after.revision,
        before.revision + 1,
        `${width} ${kind} commits once`,
      );
      assert.equal(after.turn, before.turn + Number(kind !== "focus"));
      assert(after.log.some((e) => e.verb === kind && e.seq > before.eventSeq));
      if (kind === "take") assert.equal(after.items.cloth.holder, "vale");
      if (kind === "move") assert.equal(after.actors.vale.place, "pond");
      if (kind === "focus") {
        assert.equal(after.actors.vale.want.target, "keeper");
        await page.locator('#card-actions [data-drop-quest="0"]').waitFor();
        assert.equal(
          await page
            .locator('#hand .want-card[aria-pressed="true"]')
            .getAttribute("data-quest-id"),
          "quest:0",
        );
        assert.doesNotMatch(
          await page.locator(".dialogue").textContent(),
          /turns to another quest/,
        );
      }
      assert.deepEqual(errors, []);
      results.push({ width, kind, revision: after.revision, turn: after.turn });
      await page.close();
    }
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  server.close();
}
