import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave, people } from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { availableCards } from "../card-game/cards.mjs";
import { questCards } from "../card-game/quest-cards.mjs";
import { profiles } from "../card-game/memory.mjs";
import { humanAvatarIds } from "../card-game/human-cast.mjs";

const browserName = process.env.CARD_BROWSER || "chromium";
const browserType = { chromium, webkit }[browserName];
assert(browserType, `Unknown CARD_BROWSER: ${browserName}`);
const output = new URL(
  `../../output/card-holder-collapse${browserName === "chromium" ? "" : `-${browserName}`}/`,
  import.meta.url,
);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await browserType.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    for (const reducedMotion of ["no-preference", "reduce"]) {
      const world = enableMotives(createWorld(), { personalQuests: true });
      world.actors.vale.place = "pond";
      world.actors.moth.place = "pond";
      world.items.cloth.holder = "vale";
      world.items.lamp.holder = "vale";
      world.items.bell.holder = "moth";
      world.items.oil.holder = "pond";
      const table = `holder-${width}-${reducedMotion}`;
      const key = `cosyworld.reflected-shore.v1.${table}`;
      const page = await browser.newPage({
        viewport: { width, height: width === 390 ? 844 : 900 },
        reducedMotion,
        hasTouch: width === 390,
      });
      page.setDefaultTimeout(10000);
      const errors = [],
        requests = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/card-game/text", (route) => {
        requests.push(route.request().postDataJSON());
        return route.fulfill({ status: 503, json: { error: "fixture" } });
      });
      await page.addInitScript(
        ({ key, save, seen, quests }) => {
          localStorage.setItem(key, save);
          localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
          localStorage.setItem(
            `${key}.quests`,
            JSON.stringify({ seen: quests, read: quests }),
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
          seen: availableCards(world),
          quests: Object.keys(people).flatMap((id) =>
            questCards(world, id).map((q) => q.key),
          ),
        },
      );
      const card = (id) => page.locator(`#hand [data-card="${id}"]`);
      const frame = (id) => card(id).locator("..");
      async function tap(id) {
        await card(id).scrollIntoViewIfNeeded();
        if (width === 390) await card(id).tap();
        else await card(id).click();
      }
      const selected = () =>
        page
          .locator('#hand .card[aria-pressed="true"]')
          .evaluateAll((cards) => cards.map((c) => c.dataset.card).sort());
      async function settleHand() {
        await page.locator("#hand").evaluate(async (hand) => {
          await Promise.allSettled(
            hand
              .getAnimations({ subtree: true })
              .filter((animation) =>
                Number.isFinite(animation.effect?.getComputedTiming().endTime),
              )
              .map((animation) => animation.finished),
          );
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
        });
      }
      async function collapsed() {
        assert.equal(await card("vale").getAttribute("aria-expanded"), "false");
        assert.equal(await frame("cloth").getAttribute("hidden"), "");
        await card("vale").scrollIntoViewIfNeeded();
        await settleHand();
        // Inspect the painted preview stack, including overlap and front-to-back order.
        const stack = await frame("vale").evaluate((frame) => {
          const card = frame.querySelector(".card"),
            face = card.getBoundingClientRect();
          return [...frame.querySelectorAll(".held-preview")].map((preview) => {
            const rect = preview.getBoundingClientRect();
            const x =
              Math.max(face.left, rect.left) +
              Math.min(face.width, rect.width) / 2;
            const y =
              Math.max(face.top, rect.top) +
              Math.min(face.height, rect.height) / 2;
            const painted = document.elementsFromPoint(x, y);
            return {
              visible: getComputedStyle(preview).display !== "none",
              overlap:
                (Math.max(
                  0,
                  Math.min(face.right, rect.right) -
                    Math.max(face.left, rect.left),
                ) *
                  Math.max(
                    0,
                    Math.min(face.bottom, rect.bottom) -
                      Math.max(face.top, rect.top),
                  )) /
                (face.width * face.height),
              behind:
                painted.indexOf(card) >= 0 &&
                (painted.indexOf(preview) < 0 ||
                  painted.indexOf(card) < painted.indexOf(preview)),
              offset:
                Math.abs(rect.left - face.left) + Math.abs(rect.top - face.top),
            };
          });
        });
        assert.equal(stack.length, 2);
        assert(
          stack.every(
            (p) => p.visible && p.overlap > 0.75 && p.behind && p.offset > 0,
          ),
          JSON.stringify(stack),
        );
        if (width === 1440) {
          const previewOffsets = () =>
            frame("vale").evaluate((frame) => {
              const face = frame.querySelector(".card").getBoundingClientRect();
              return [...frame.querySelectorAll(".held-preview")].map(
                (preview) => {
                  const rect = preview.getBoundingClientRect();
                  return { x: rect.left - face.left, y: rect.top - face.top };
                },
              );
            });
          await page.mouse.move(4, 100);
          await settleHand();
          const resting = await previewOffsets();
          await card("vale").hover();
          await settleHand();
          const hovered = await previewOffsets();
          assert(
            hovered.every(
              (offset, i) =>
                Math.abs(offset.x - resting[i].x) < 0.5 &&
                Math.abs(offset.y - resting[i].y) < 0.5,
            ),
            `Hover keeps the front card and its preview stack together: ${JSON.stringify({ resting, hovered })}`,
          );
        }
      }
      try {
        await page.goto(
          `http://127.0.0.1:${server.address().port}/?table=${table}`,
        );
        await card("vale").waitFor();
        const saved = await page.evaluate(
          (key) => localStorage.getItem(key),
          key,
        );
        const order = await page
          .locator("#hand [data-card]")
          .evaluateAll((cards) => cards.map((c) => c.dataset.card));
        assert.equal(
          await page.locator("#hand .avatar").first().getAttribute("data-card"),
          "vale",
        );
        await tap("vale");
        assert.equal(await frame("cloth").getAttribute("hidden"), null);
        await tap("vale");
        await collapsed();
        assert.equal(await frame("lamp").getAttribute("hidden"), "");
        await page.screenshot({
          path: new URL(`${table}-stack.png`, output).pathname,
        });
        await tap("vale");
        await tap("lamp");
        await tap("vale");
        await collapsed();
        assert.equal(await frame("lamp").getAttribute("hidden"), null);
        assert.deepEqual(await selected(), ["lamp"]);
        assert(
          await page.locator('#card-actions [data-action="light"]').count(),
        );
        // Opening the other holder and choosing its child preserves the first item.
        await tap("moth");
        await tap("bell");
        assert.deepEqual(await selected(), ["bell", "lamp"]);
        assert.equal(await card("moth").getAttribute("aria-expanded"), "false");
        assert.equal(
          await page.locator(".card-primary").innerText(),
          "Trade Lamp for Bell",
        );
        await tap("pond");
        assert.deepEqual(
          await selected(),
          ["pond"],
          "an unrelated third card starts a new selection",
        );
        assert.equal(await frame("oil").getAttribute("hidden"), null);
        await tap("oil");
        assert.deepEqual(await selected(), ["oil", "pond"]);
        assert.equal(await card("pond").getAttribute("aria-expanded"), "true");
        assert(
          await page.locator('#card-actions [data-action="take"]').count(),
        );
        await page.screenshot({
          path: new URL(`${table}-location-items.png`, output).pathname,
        });
        await tap("pond");
        assert.equal(await frame("oil").getAttribute("hidden"), "");
        assert.deepEqual(await selected(), []);
        await page.keyboard.press("Escape");
        assert.deepEqual(await selected(), []);
        assert.equal(await frame("cloth").getAttribute("hidden"), "");
        await tap("vale");
        const quest = page
          .locator('#hand .quest-frame[data-holder="vale"] .card')
          .first();
        await quest.scrollIntoViewIfNeeded();
        await quest.click();
        assert.equal(await quest.getAttribute("aria-pressed"), "true");
        assert(await quest.isVisible());
        await collapsed();
        assert.equal(await frame("lamp").getAttribute("hidden"), "");
        await page.screenshot({
          path: new URL(`${table}-quest.png`, output).pathname,
        });
        await page.locator("#stage").click({ position: { x: 20, y: 200 } });
        assert.deepEqual(await selected(), []);
        assert.equal(await quest.isVisible(), false);
        await collapsed();
        assert.deepEqual(
          await page
            .locator("#hand [data-card]")
            .evaluateAll((cards) => cards.map((c) => c.dataset.card)),
          order,
        );
        assert.equal(
          await page.evaluate((key) => localStorage.getItem(key), key),
          saved,
          "browsing preserves the saved world",
        );
        assert.deepEqual(requests, []);
        assert.deepEqual(errors, []);
        console.log(
          `${table}: avatar stack, chosen child, cross-holder pair, quest reading, Escape and outside reset passed`,
        );
      } catch (error) {
        await page.screenshot({
          path: new URL(`${table}-failure.png`, output).pathname,
        });
        throw error;
      } finally {
        await page.close();
      }
    }
  }
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
