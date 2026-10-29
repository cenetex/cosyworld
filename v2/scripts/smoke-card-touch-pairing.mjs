import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave, people } from "../card-game/world.mjs";
import { availableCards } from "../card-game/cards.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { installQuestCollection, programsFor } from "../card-game/quests.mjs";
import { registerPersonalQuest } from "../card-game/shared-quests.mjs";
import { questCards, questCardId } from "../card-game/quest-cards.mjs";

const browserName = process.env.CARD_BROWSER || "chromium";
const output = new URL(
  `../../output/card-touch-pairing-${browserName}/`,
  import.meta.url,
);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await { chromium, webkit }[browserName].launch();
function fixture() {
  const world = enableMotives(createWorld(), { personalQuests: true });
  world.actors.vale.place =
    world.actors.moth.place =
    world.actors.keeper.place =
      "station";
  delete world.opening;
  world.items.lamp.holder = world.items.cloth.holder = "vale";
  world.items.bell.holder = world.items.oil.holder = "moth";
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
        turn: 0,
      },
      createdTurn: 0,
      completedTurn: null,
    });
    collection.cards.push(record.key);
  }
  return world;
}
try {
  for (const [width, height, motion] of [
    [1440, 900, "no-preference"],
    [390, 844, "no-preference"],
    [320, 568, "reduce"],
    [667, 375, "reduce"],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      hasTouch: width < 700,
      reducedMotion: motion,
    });
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const world = fixture();
    const table = `touch-pairing-${width}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
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
    await page.route("**/card-game/text", (route) =>
      route.fulfill({ status: 503, json: { error: "fixture" } }),
    );
    const card = (id) => page.locator(`#hand [data-card="${id}"]`);
    const frame = (id) => card(id).locator("..");
    const checkHoverStack = async () => {
      if (width !== 1440) return;
      await card("vale").scrollIntoViewIfNeeded();
      const settle = () =>
        page.locator("#hand").evaluate(async (hand) => {
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
      const offsets = () =>
        frame("vale").evaluate((frame) => {
          const face = frame.querySelector(".card").getBoundingClientRect();
          return [...frame.querySelectorAll(".held-preview")].map((preview) => {
            const rect = preview.getBoundingClientRect();
            return { x: rect.left - face.left, y: rect.top - face.top };
          });
        });
      await page.mouse.move(4, 100);
      await settle();
      const resting = await offsets();
      assert.equal(resting.length, 2);
      await card("vale").hover();
      await settle();
      const hovered = await offsets();
      assert(
        hovered.every(
          (offset, i) =>
            Math.abs(offset.x - resting[i].x) < 0.5 &&
            Math.abs(offset.y - resting[i].y) < 0.5,
        ),
        `Hover keeps the face and preview stack together: ${JSON.stringify({ resting, hovered })}`,
      );
    };
    const tap = async (id) => {
      await card(id).scrollIntoViewIfNeeded();
      if (width < 700) await card(id).tap();
      else await card(id).click();
    };
    const selection = () =>
      page
        .locator('#hand .card[aria-pressed="true"]')
        .evaluateAll((cards) => cards.map((c) => c.dataset.card).sort());
    const quests = questCards(world, "vale").map((q) => questCardId(world, q));
    try {
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?table=${table}`,
      );
      await card("vale").waitFor();
      await checkHoverStack();
      assert.equal(await card("lamp").isVisible(), false);
      await tap("vale");
      assert.equal(await card("lamp").isVisible(), true);
      assert.equal(await frame("cloth").getAttribute("data-stacked"), "true");
      assert.equal(await frame(quests[1]).getAttribute("data-stacked"), "true");
      await tap("lamp");
      assert.deepEqual(
        await selection(),
        ["vale"],
        "opening the item stack keeps the active pair",
      );
      assert.equal(await frame("cloth").getAttribute("data-stacked"), "false");
      assert.equal(await frame(quests[1]).getAttribute("data-stacked"), "true");
      await tap(quests[0]);
      assert.equal(
        await frame(quests[1]).getAttribute("data-stacked"),
        "false",
      );
      assert.deepEqual(
        await selection(),
        ["vale"],
        "opening the quest stack keeps the active pair",
      );
      await tap("lamp");
      assert.deepEqual(await selection(), ["lamp", "vale"]);
      await tap("vale");
      assert.deepEqual(await selection(), ["lamp"]);
      assert.equal(await frame("cloth").getAttribute("data-stacked"), "true");
      assert.equal(await frame(quests[1]).getAttribute("data-stacked"), "true");
      await tap("moth");
      assert.equal(await card("lamp").isVisible(), true);
      await tap("keeper");
      assert.deepEqual(
        await selection(),
        ["lamp", "moth"],
        "a third card keeps the pair raised",
      );
      await page.locator("#stage").click({ position: { x: 20, y: 100 } });
      assert.deepEqual(
        await selection(),
        ["lamp", "moth"],
        "scene taps keep the pair",
      );
      await page.locator("#toolbar-menu-button").click();
      await page.locator("#menu-button").click();
      await page.keyboard.press("Escape");
      assert.deepEqual(await selection(), ["lamp", "moth"]);
      await tap("moth");
      await tap("lamp");
      assert.deepEqual(await selection(), []);
      assert.equal(
        await card("lamp").isVisible(),
        true,
        "the front item stays with its avatar after deselection",
      );
      // Choose Pip's second item, then fold his stacks and select both avatars.
      await tap("moth");
      await tap("oil");
      await tap("oil");
      await tap("moth");
      assert.deepEqual(await selection(), ["oil"]);
      await tap("oil");
      await tap("moth");
      await tap("vale");
      assert.deepEqual(await selection(), ["moth", "vale"]);
      const threat = page.locator('#card-actions [data-action="threaten"]');
      assert.equal(await threat.innerText(), "Threaten Pip for Oil flask");
      assert.equal(await frame("bell").getAttribute("data-stacked"), "true");
      assert.equal(await card("oil").isVisible(), true);
      assert.equal(await card("lamp").isVisible(), true);
      const before = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)).turn,
        key,
      );
      assert.equal(
        before,
        0,
        "stack browsing and selection keep the world turn",
      );
      await page.waitForFunction(() =>
        [...document.images]
          .filter((i) => i.getClientRects().length)
          .every((i) => i.complete && i.naturalWidth),
      );
      await page.screenshot({
        path: new URL(`compact-pair-${width}.png`, output).pathname,
      });
      await page.reload();
      await card("vale").waitFor();
      assert.equal(await frame("lamp").getAttribute("data-shown-item"), "true");
      assert.equal(await frame("oil").getAttribute("data-shown-item"), "true");
      await tap("moth");
      await tap("vale");
      assert.equal(await threat.innerText(), "Threaten Pip for Oil flask");
      assert.match(
        await card("vale").locator(".sr-only").innerText(),
        /Threaten Pip for Oil flask/,
      );
      if (width === 1440)
        await card("vale").dragTo(page.locator("#stage"), {
          targetPosition: { x: width / 2, y: 100 },
        });
      else await threat.click();
      await page.waitForFunction(
        ({ key, before }) =>
          JSON.parse(localStorage.getItem(key)).turn > before,
        { key, before },
      );
      assert.deepEqual(
        await selection(),
        ["moth", "vale"],
        "a completed play preserves available selected cards",
      );
      const saved = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)),
        key,
      );
      assert(
        saved.log.some((e) => e.verb === "threaten" && e.itemId === "oil"),
      );
      await page.keyboard.press("Escape");
      // Arrow buttons and both wheel directions browse independently of selection.
      await tap("vale");
      const hand = page.locator("#hand");
      await hand.evaluate((hand) => {
        hand.scrollLeft = 0;
      });
      await page.locator("#hand-next").click();
      await page.waitForFunction(
        () => document.querySelector("#hand").scrollLeft > 20,
      );
      assert.deepEqual(await selection(), ["vale"]);
      await hand.evaluate((hand) => {
        hand.scrollLeft = hand.scrollWidth;
      });
      const wheel = await hand.evaluate((hand) => {
        const event = new WheelEvent("wheel", {
          deltaX: 200,
          bubbles: true,
          cancelable: true,
        });
        hand.dispatchEvent(event);
        return event.defaultPrevented;
      });
      assert(wheel, "horizontal wheel input stays inside the hand at its end");
      assert.equal(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <= innerWidth + 1 &&
            document.documentElement.scrollHeight <= innerHeight + 1,
        ),
        true,
      );
      assert.deepEqual(errors, []);
      console.log(
        `${browserName} ${width}x${height}: compact stacks, two selections, front items, chosen threat, persistent pair and arrows passed.`,
      );
    } catch (error) {
      await page.screenshot({
        path: new URL(`failure-${width}.png`, output).pathname,
      });
      console.error({ width, errors });
      throw error;
    } finally {
      await page.close();
    }
  }
  for (const width of [1440, 390]) {
    const world = enableMotives(createWorld(), { personalQuests: true });
    world.actors.vale.place = "greek-gate";
    world.crossings["pond-greek-harbor"].discovered = true;
    world.items.lamp.holder = world.items.oil.holder = "greek-gate";
    const table = `location-stacks-${width}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 900 },
      hasTouch: width === 390,
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
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
    await page.route("**/card-game/text", (route) =>
      route.fulfill({ status: 503, json: { error: "fixture" } }),
    );
    const card = (id) => page.locator(`#hand [data-card="${id}"]`);
    const frame = (id) => card(id).locator("..");
    const tap = async (id) => {
      await card(id).scrollIntoViewIfNeeded();
      if (width === 390) await card(id).tap();
      else await card(id).click();
    };
    try {
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?table=${table}`,
      );
      await card("greek-gate").waitFor();
      assert.equal(await card("greek-well").isVisible(), false);
      assert.equal(
        await card("greek-gate").getAttribute("aria-expanded"),
        "false",
      );
      await tap("greek-gate");
      assert.equal(
        await card("greek-gate").getAttribute("aria-expanded"),
        "true",
      );
      assert.equal(await card("lamp").isVisible(), true);
      assert.equal(await frame("oil").getAttribute("data-stacked"), "true");
      assert.equal(
        await frame("greek-well").getAttribute("data-stacked"),
        "true",
      );
      const itemFront = await page
        .locator(
          '#hand [data-holder="greek-gate"][data-stack-kind="item"][data-stack-index="0"] .card',
        )
        .getAttribute("data-card");
      await tap(itemFront);
      assert.equal(await frame("oil").getAttribute("data-stacked"), "false");
      assert.equal(
        await frame("greek-well").getAttribute("data-stacked"),
        "true",
      );
      await tap("greek-courtyard");
      assert.equal(
        await frame("greek-well").getAttribute("data-stacked"),
        "false",
      );
      await tap("oil");
      await tap("greek-gate");
      assert.equal(await frame("oil").getAttribute("data-stack-index"), "0");
      assert.equal(await frame("lamp").getAttribute("data-stacked"), "true");
      assert.equal(
        await frame("greek-well").getAttribute("data-stacked"),
        "true",
      );
      await tap("oil");
      await tap("greek-courtyard");
      await tap("greek-well");
      assert.equal(
        await page.locator('#card-actions [data-action="move"]').innerText(),
        "Travel",
      );
      await page.screenshot({
        path: new URL(`location-stacks-${width}.png`, output).pathname,
      });
      await page.locator('#card-actions [data-action="move"]').click();
      await page.waitForFunction(
        (key) =>
          JSON.parse(localStorage.getItem(key)).actors.vale.place ===
          "greek-well",
        key,
      );
      assert.deepEqual(errors, []);
      console.log(
        `${browserName} ${width}px: current place, separate item and route stacks, folding, front item and travel passed.`,
      );
    } catch (error) {
      await page.screenshot({
        path: new URL(`location-failure-${width}.png`, output).pathname,
      });
      throw error;
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
