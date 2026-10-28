import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave, people } from "../card-game/world.mjs";
import { questCards } from "../card-game/quest-cards.mjs";
import { profiles } from "../card-game/memory.mjs";
import { humanAvatarIds } from "../card-game/human-cast.mjs";

await import("./smoke-card-touch-pairing.mjs");

const output = new URL("../../output/card-holder-collapse/", import.meta.url);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  // Another player can leave while their avatar is selected on this screen.
  // The real polling client must lower that avatar before it returns.
  for (const [width, reducedMotion] of [
    [1440, "reduce"],
    [390, "reduce"],
    [1440, "no-preference"],
    [390, "no-preference"],
  ]) {
    const world = createWorld();
    world.sharedVersion = 1;
    world.playerActorId = "vale";
    world.controlledActors = ["vale", "mara"];
    world.presentActors = ["vale", "mara"];
    world.actors.vale.place = "pond";
    world.actors.mara.place = "pond";
    world.items.float.holder = "mara";
    const snapshot = {
      actor: "vale",
      world,
      now: Date.now(),
      actions: [],
      queue: [],
      history: [],
      claimed: humanAvatarIds.map((id) => ["vale", "mara"].includes(id)),
      present: humanAvatarIds.map((id) => ["vale", "mara"].includes(id)),
    };
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 900 },
      reducedMotion,
    });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.addInitScript(
        ({ seen, quests }) => {
          const key = "cosyworld.reflected-shore.v1.shared.remote-stack.vale";
          localStorage.setItem(key + ".seen", JSON.stringify(seen));
          localStorage.setItem(
            key + ".quests",
            JSON.stringify({ seen: quests, read: quests }),
          );
          localStorage.setItem("cosyworld.dialogue.sound", "off");
          localStorage.setItem(
            "cosyworld.room-music",
            JSON.stringify({ enabled: false }),
          );
          // A command reply can bring an actor back before the farewell ends.
          const interval = window.setInterval;
          window.setInterval = (run, delay, ...args) =>
            interval(
              run,
              run.name === "sync" && delay === 1000 ? 80 : delay,
              ...args,
            );
        },
        {
          seen: Object.keys(profiles),
          quests: Object.keys(people).flatMap((id) =>
            questCards(world, id).map((q) => q.key),
          ),
        },
      );
      await page.route("**/auth/account", (route) =>
        route.fulfill({ json: { authenticated: true } }),
      );
      await page.route("**/card-game/shared/worlds/remote-stack**", (route) =>
        route.fulfill({ json: snapshot }),
      );
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?world=remote-stack`,
      );
      const avatar = page.locator('#hand [data-card="mara"]');
      await avatar.scrollIntoViewIfNeeded();
      await avatar.click();
      assert.equal(await avatar.getAttribute("aria-expanded"), "true");
      snapshot.queue = [
        { id: "thinking-play", actor: "vale", status: "working" },
      ];
      world.actors.mara.place = "station";
      world.revision++;
      snapshot.now = Date.now();
      await avatar.waitFor({ state: "detached" });
      await page.waitForFunction(
        () =>
          !document.querySelector(
            '#cast [data-avatar="mara"]:not([data-removing="true"])',
          ),
      );
      assert.match(await page.locator("#story-status").innerText(), /Thinking/);
      assert.equal(
        await page.locator("#stage").getAttribute("data-presented-revision"),
        await page.locator("#hand").getAttribute("data-presented-revision"),
      );
      world.actors.mara.place = "pond";
      world.revision++;
      snapshot.now = Date.now();
      await avatar.waitFor({ state: "visible" });
      assert.equal(await avatar.getAttribute("aria-pressed"), "false");
      assert.equal(await avatar.getAttribute("aria-expanded"), "false");
      assert.equal(
        await page.locator('#hand [data-card="float"]').isVisible(),
        false,
      );
      await page.locator("#cast").evaluate(async (cast) => {
        await Promise.allSettled(
          cast
            .getAnimations({ subtree: true })
            .filter((animation) =>
              Number.isFinite(animation.effect?.getComputedTiming().endTime),
            )
            .map((animation) => animation.finished),
        );
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      });
      const portrait = page.locator('#cast [data-avatar="mara"]');
      assert.equal(await portrait.count(), 1);
      assert.equal(await portrait.getAttribute("data-removing"), null);
      assert.equal(await portrait.getAttribute("aria-hidden"), "false");
      assert(
        await portrait.evaluate(
          (figure) => Number(getComputedStyle(figure).opacity) >= 0.99,
        ),
      );
      await avatar.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: new URL(`remote-return-${width}-${reducedMotion}.png`, output)
          .pathname,
      });
      assert.deepEqual(errors, []);
      console.log(
        `shared-${width}-${reducedMotion}: remote departure lowers the avatar and preserves its returning portrait and item stack`,
      );
    } catch (error) {
      await page.screenshot({
        path: new URL(`remote-return-${width}-failure.png`, output).pathname,
      });
      throw error;
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
