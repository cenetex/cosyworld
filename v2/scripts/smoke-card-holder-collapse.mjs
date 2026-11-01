import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave, people } from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { availableCards } from "../card-game/cards.mjs";
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
      const world = enableMotives(createWorld());
      world.actors.vale.place = "pond";
      world.actors.moth.place = "pond";
      world.items.cloth.holder = "vale";
      world.items.lamp.holder = "vale";
      world.items.bell.holder = "moth";
      world.items.oil.holder = "pond";
      // Pip stays content at the pond, so the hand under test holds still.
      world.actors.moth.want = null;
      world.actors.keeper.want = null;
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
          seen: availableCards(world),
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
        assert.equal(stack.length, 1, "one carried thing peeks out");
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
          ["lamp", "pond"],
          "a held item stays raised when a third card replaces its partner",
        );
        // A place left out of the new pair is lowered, not drawn raised.
        await tap("moth");
        assert(!(await selected()).includes("pond"), "Black pond is lowered");
        assert.equal(await card("pond").getAttribute("aria-pressed"), "false");
        assert.equal(await frame("oil").getAttribute("hidden"), "");
        await tap("pond");
        assert.deepEqual(await selected(), ["lamp", "pond"]);
        await tap("lamp");
        assert.deepEqual(await selected(), ["pond"]);
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
        // Quests have no cards; Vale's stack holds only belongings.
        await tap("vale");
        assert.equal(await page.locator("#hand .quest-frame").count(), 0);
        assert.equal(await page.locator("#hand .quest-preview").count(), 0);
        // An outside click folds the hand and keeps the choice.
        await page.locator("#stage").click({ position: { x: 20, y: 200 } });
        assert.deepEqual(await selected(), ["vale"]);
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
        // Only an outside click, Escape or a play folds the hand. Choosing,
        // changing the pair and deselecting all keep it open.
        const open = () =>
          page.evaluate(() => document.body.dataset.handExpanded);
        assert.equal(await open(), "false", "an outside click folds the hand");
        await tap("vale");
        assert.equal(await open(), "true", "a tap opens the hand");
        assert.deepEqual(await selected(), ["vale"], "as it was");
        await tap("vale");
        assert.deepEqual(await selected(), []);
        assert.equal(await open(), "true", "deselecting keeps the hand open");
        await tap("moth");
        await tap("pond");
        await tap("moth");
        assert.deepEqual(await selected(), ["pond"]);
        assert.equal(await open(), "true", "changing the pair keeps it open");
        await card("pond").focus();
        await page.keyboard.press("Enter");
        assert.deepEqual(await selected(), []);
        assert.equal(await open(), "true", "a keyboard deselect keeps it open");
        if (width === 390)
          await page.locator("#hand").tap({ position: { x: 4, y: 4 } });
        else await page.locator("#hand").click({ position: { x: 4, y: 4 } });
        assert.equal(await open(), "true", "empty hand space keeps it open");
        // The scroll arrows hide as the hand reaches an end, so dispatch the click.
        for (const arrow of ["#hand-next", "#hand-previous"]) {
          await page.locator(arrow).dispatchEvent("click");
          assert.equal(await open(), "true", "the hand arrows keep it open");
        }
        await page.locator("#stage").click({ position: { x: 20, y: 200 } });
        assert.equal(await open(), "false", "an outside click folds it");
        await tap("vale");
        await page.keyboard.press("Escape");
        assert.equal(await open(), "false", "Escape folds it");
        // A held item stays raised until the player lowers it or it leaves
        // their hands.
        const action = (kind) =>
          page.locator(`#card-actions [data-action="${kind}"]`);
        const settled = () =>
          page.waitForFunction(
            () =>
              !document.querySelector('#card-actions [data-queued="true"]') &&
              document.querySelector("#hand").dataset.cooling === "false" &&
              document.querySelector("#hand").getAttribute("aria-busy") ===
                "false",
          );
        await tap("vale");
        await tap("lamp");
        assert.deepEqual(await selected(), ["lamp", "vale"]);
        await action("light").click();
        await settled();
        await action("snuff").waitFor();
        assert.equal(await open(), "false", "a play folds the hand");
        assert.deepEqual(
          await selected(),
          ["lamp", "vale"],
          "lighting the lamp keeps it in hand",
        );
        assert.equal(await action("light").count(), 0);
        await page.waitForTimeout(600);
        await action("snuff").click();
        await settled();
        await action("light").waitFor();
        assert.deepEqual(await selected(), ["lamp", "vale"]);
        await page.waitForTimeout(600);
        // The Light slot becomes Put out; a quick second tap must not land on it.
        if (width === 390) {
          await action("light").tap();
          await action("snuff").tap();
        } else await action("light").dblclick();
        await page.waitForTimeout(1200);
        await settled();
        assert.equal(await action("snuff").count(), 1, "the lamp stays lit");
        assert.equal(await action("light").count(), 0);
        assert.deepEqual(await selected(), ["lamp", "vale"]);
        await page.keyboard.press("Escape");
        assert.deepEqual(await selected(), []);
        // An outside click keeps a held item but still lowers other cards.
        await tap("vale");
        await tap("lamp");
        await page.locator("#stage").click({ position: { x: 20, y: 200 } });
        assert.deepEqual(await selected(), ["lamp", "vale"]);
        // That click folds the row; the lit lamp stays raised with Put out.
        const handExpanded = () =>
          page.evaluate(() => document.body.dataset.handExpanded);
        assert.equal(await handExpanded(), "false", "the row folds");
        assert.equal(await card("vale").getAttribute("aria-expanded"), "false");
        assert.equal(await frame("cloth").getAttribute("hidden"), "");
        assert.equal(await action("snuff").count(), 1);
        await page.screenshot({
          path: new URL(`${table}-held-folded.png`, output).pathname,
        });
        await page.locator("#stage").click({ position: { x: 20, y: 200 } });
        assert.deepEqual(await selected(), ["lamp", "vale"]);
        // Tapping the folded row opens it with the same choice.
        await tap("vale");
        assert.equal(await handExpanded(), "true", "the row opens again");
        assert.deepEqual(await selected(), ["lamp", "vale"]);
        assert.equal(await frame("lamp").getAttribute("hidden"), null);
        assert.equal(await action("snuff").count(), 1, "Put out is offered");
        await page.screenshot({
          path: new URL(`${table}-held-opened.png`, output).pathname,
        });
        await page.locator("#stage").click({ position: { x: 20, y: 200 } });
        assert.equal(await handExpanded(), "false");
        await page.locator(".play-dock").dispatchEvent("click");
        assert.equal(await handExpanded(), "true");
        assert.deepEqual(await selected(), ["lamp", "vale"]);
        // A tap on the beats while the hand is up only lowers the hand.
        const beat = await page.evaluate(
          () => document.querySelector("#speaker").textContent,
        );
        await page.locator("#dialogue-advance").click();
        assert.equal(await handExpanded(), "false", "a beat tap folds the hand");
        assert.equal(
          await page.evaluate(() => document.querySelector("#speaker").textContent),
          beat,
        );
        // A second tap still lowers the lamp, and Escape still clears.
        await tap("lamp");
        await tap("lamp");
        assert.deepEqual(await selected(), ["vale"]);
        await page.keyboard.press("Escape");
        assert.deepEqual(await selected(), []);
        await tap("vale");
        await tap("lamp");
        await page.locator("#stage").click({ position: { x: 20, y: 200 } });
        await page.keyboard.press("Escape");
        assert.deepEqual(await selected(), []);
        await tap("vale");
        await tap("lamp");
        await page.locator("#stage").click({ position: { x: 20, y: 200 } });
        await page.keyboard.press("Escape");
        await tap("moth");
        await page.locator("#stage").click({ position: { x: 20, y: 200 } });
        assert.deepEqual(await selected(), ["moth"]);
        await page.keyboard.press("Escape");
        await tap("vale");
        await tap("lamp");
        await tap("moth");
        assert.deepEqual(
          await selected(),
          ["lamp", "moth"],
          "a new target keeps the held item",
        );
        assert.equal(await action("give").count(), 1);
        await page.waitForTimeout(600);
        await action("give").click();
        await settled();
        assert(
          !(await selected()).includes("lamp"),
          "a given item leaves the selection",
        );
        await page.keyboard.press("Escape");
        await tap("vale");
        await tap("cloth");
        await tap("pond");
        assert.deepEqual(await selected(), ["cloth", "pond"]);
        await page.waitForTimeout(600);
        await action("drop").click();
        await settled();
        assert.deepEqual(
          await selected(),
          [],
          "a put-down item leaves the selection",
        );
        // An item that arrives in the player's hands is raised there.
        await tap("pond");
        await tap("oil");
        assert.deepEqual(await selected(), ["oil", "pond"]);
        await page.waitForTimeout(600);
        await action("take").click();
        await settled();
        assert.deepEqual(
          await selected(),
          ["oil"],
          "a taken item is raised in the hand",
        );
        assert.equal(await frame("oil").getAttribute("hidden"), null);
        await tap("moth");
        await tap("bell");
        assert.deepEqual(await selected(), ["bell", "oil"]);
        assert.equal(
          await page.locator(".card-primary").innerText(),
          "Trade Oil flask for Bell",
        );
        await page.waitForTimeout(600);
        await action("trade").click();
        await settled();
        assert.deepEqual(
          await selected(),
          ["bell"],
          "Pip's side of the trade is raised in the hand",
        );
        assert.equal(await frame("bell").getAttribute("hidden"), null);
        await page.screenshot({
          path: new URL(`${table}-received.png`, output).pathname,
        });
        assert.deepEqual(errors, []);
        console.log(
          `${table}: avatar stack, chosen child, cross-holder pair, quest-free stacks, Escape and outside reset, held item through Light, Give and Put down, raised Take and Trade passed`,
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
        ({ seen }) => {
          const key = "cosyworld.reflected-shore.v1.shared.remote-stack.vale";
          localStorage.setItem(key + ".seen", JSON.stringify(seen));
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
