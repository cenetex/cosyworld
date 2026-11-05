// Locked cards describe their quests through the existing action beat.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { lockedQuest } from "../card-game/locked-box.mjs";
import { profiles } from "../card-game/memory.mjs";
import { revealCard, tapCard } from "./card-browser-helpers.mjs";
const output = new URL("../../output/lock-quests/", import.meta.url);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  for (const [width, height] of [
    [1920, 1080],
    [1440, 900],
    [390, 844],
    [360, 740],
  ]) {
    for (const [id, place, count] of [
      ["greek-provisions", "greek-harbor", 5],
      ["greek-bread", "greek-courtyard", 4],
      ["greek-cithaeron", "greek-battlefield", 1],
    ]) {
      const world = createWorld();
      world.packs["greek-drama"].scope = "full";
      world.actors.vale.place = place;
      const expected = lockedQuest(world, id);
      assert(expected, `${id} is locked`);
      const page = await browser.newPage({
        viewport: { width, height },
        hasTouch: width < 700,
        reducedMotion: "reduce",
      });
      const key = `cosyworld.reflected-shore.v1.lock-${id}-${width}`;
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
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
        { key, save: encodeSave(world), seen: Object.keys(profiles) },
      );
      await page.route("**/card-game/text", (r) =>
        r.fulfill({ status: 503, body: "" }),
      );
      await page.route("**/card-game/reflections", (r) =>
        r.fulfill({ status: 503, body: "" }),
      );
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?table=lock-${id}-${width}`,
      );
      await page
        .locator(`#hand [data-card="${id}"]`)
        .waitFor({ state: "attached" });
      await tapCard(await revealCard(page, id));
      const text = page.locator(".action-beat-text");
      assert.equal(await text.textContent(), expected.text);
      assert.equal(
        await page.locator(".action-beat-cards > img").count(),
        count,
      );
      const button = page.locator('#card-actions [data-blocked="gate"]');
      if (await button.count()) {
        assert.equal(await button.textContent(), "Locked");
        assert(await button.isDisabled());
      }
      const fits = await text.evaluate((n) => {
        const r = document.createRange();
        r.selectNodeContents(n);
        return (
          r.getBoundingClientRect().height <=
          n.getBoundingClientRect().height + 1
        );
      });
      assert(fits, `complete quest at ${width}: ${expected.text}`);
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".action-beat-cards img")].every(
          (i) => i.complete && i.naturalWidth > 0,
        ),
      );
      await page.waitForTimeout(900);
      const pictures = await page
        .locator(".action-beat-cards > img")
        .evaluateAll((nodes) =>
          nodes.map((n) => ({
            src: n.src.split("/").at(-1),
            width: n.getBoundingClientRect().width,
            height: n.getBoundingClientRect().height,
            display: getComputedStyle(n).display,
          })),
        );
      assert(
        pictures.every((p) => p.width > 0 && p.height >= 30),
        "ingredient pictures are drawn",
      );
      await page.screenshot({
        path: new URL(`${id}-${width}.png`, output).pathname,
      });
      assert.equal(
        await page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)).turn,
          key,
        ),
        world.turn,
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      `Lock quests, ingredient pictures and unchanged turns passed at ${width}px.`,
    );
  }
} finally {
  await browser.close();
  server.close();
}
