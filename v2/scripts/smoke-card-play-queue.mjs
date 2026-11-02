import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { addLog, createWorld, encodeSave } from "../card-game/world.mjs";
import { availableCards } from "../card-game/cards.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

const output = new URL("../../output/card-play-queue/", import.meta.url);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const reports = [];
try {
  for (const width of [1512, 390]) {
    for (const stale of [false, true]) {
      let world = dispatchShared({
        op: "create",
        save: encodeSave(createWorld()),
      }).world;
      world.items.lamp.holder = "vale";
      addLog(world, "Vale", "There is time to choose the next step.", {
        actorId: "vale",
        entityId: "vale",
        locationId: "station",
        kind: "dialogue",
        generated: true,
      });
      let queue = [{ id: "earlier-play", actor: "vale", status: "playing" }];
      const plays = [],
        errors = [];
      let heldReply;
      const page = await browser.newPage({
        viewport: { width, height: width === 390 ? 844 : 754 },
        reducedMotion: "reduce",
        hasTouch: width === 390,
      });
      page.setDefaultTimeout(10000);
      page.on("pageerror", (error) => errors.push(error.message));
      const view = () => ({
        ...dispatchShared({
          op: "view",
          world,
          actor: "vale",
          claimed: ["vale"],
          present: ["vale"],
        }),
        id: "play-queue",
        version: "full-card-world/12",
        claimed: [1, 0, 0, 0, 0, 0, 0, 0],
        present: [1, 0, 0, 0, 0, 0, 0, 0],
        now: Date.now(),
        queue,
        history: [],
      });
      await page.route("**/auth/account", (route) =>
        route.fulfill({ json: { authenticated: true } }),
      );
      await page.route(
        /\/card-game\/shared\/worlds\/play-queue(?:\/command)?$/,
        async (route) => {
          const body = route.request().postDataJSON();
          if (body?.op === "play") {
            plays.push(body);
            const result = dispatchShared({
              op: "play",
              world,
              actor: "vale",
              claimed: ["vale"],
              present: ["vale"],
              action: body.action,
            });
            assert(result.ok);
            world = result.world;
            queue = [{ id: body.key, actor: "vale", status: "playing" }];
            if (plays.length === 1) {
              heldReply = () => route.fulfill({ json: view() });
              return;
            }
          }
          await route.fulfill({ json: view() });
        },
      );
      await page.addInitScript(
        ({ seen }) => {
          localStorage.setItem(
            "cosyworld.reflected-shore.v1.shared.play-queue.vale.seen",
            JSON.stringify(seen),
          );
          localStorage.setItem("cosyworld.dialogue.sound", "off");
          localStorage.setItem(
            "cosyworld.room-music",
            JSON.stringify({ enabled: false }),
          );
        },
        { seen: availableCards({ ...world, playerActorId: "vale" }) },
      );
      try {
        await page.goto(`${origin}/?world=play-queue`);
        await page.waitForFunction(() => document.body.inert === false);
        await page.waitForFunction(
          () =>
            document.querySelector("#dialogue-advance").dataset.revealing ===
            "false",
        );
        await page.evaluate(async () => {
          await Promise.all(
            [...document.images]
              .filter((image) => image.getClientRects().length)
              .map((image) => image.decode()),
          );
        });
        const layout = () =>
          page.evaluate(() => {
            const hand = document.querySelector("#hand");
            const rect = (selector) => {
              const { x, y, width, height, right, bottom } = document
                .querySelector(selector)
                .getBoundingClientRect();
              return { x, y, width, height, right, bottom };
            };
            return {
              dialogue: rect(".dialogue"),
              hand: rect("#hand"),
              cardWidth: parseFloat(
                getComputedStyle(document.querySelector(".card-frame")).width,
              ),
              // Both sides of the hand share one inline padding.
              handPadding: 2 * parseFloat(getComputedStyle(hand).paddingLeft),
            };
          });
        const resting = await layout();
        if (width === 1512) {
          assert(resting.dialogue.right < resting.hand.x);
          assert(
            Math.abs(
              resting.hand.width -
                (resting.cardWidth * 2 + 14 + resting.handPadding),
            ) < 2,
          );
        }
        assert.equal(await page.locator(".hand-scroll").count(), 0);
        await page.screenshot({
          path: new URL(`resting-${width}-${stale}.png`, output).pathname,
        });
        await selectCard(page, "vale");
        const play = page.locator('#card-actions [data-action="wait"]');
        assert.equal(await play.isDisabled(), false);
        // The resize observer places speech after the expanded hand is measured.
        await page.waitForFunction(() => {
          const measured = parseFloat(
            document.documentElement.style.getPropertyValue("--dock-height"),
          );
          const height = document
            .querySelector(".play-dock")
            .getBoundingClientRect().height;
          return Math.abs(measured - height) < 1;
        });
        const open = await layout();
        // Every width lays speech over the open hand's foot, below the
        // raised cards' tops.
        assert(open.dialogue.y > open.hand.y + 100);
        // Wide screens centre it over the raised row; it rested beside the
        // small deck and slid here with the cards.
        if (width === 1512)
          assert(
            Math.abs(open.dialogue.x + open.dialogue.width / 2 - width / 2) <
              2 && open.dialogue.width <= 720,
          );
        // Waiting plays have no chips (owner, 2026-11-01).
        assert.equal(await page.locator(".shared-play-avatar").count(), 0);
        await play.click();
        assert.equal(await play.innerText(), "Waiting…");
        assert.equal(await play.isDisabled(), false);
        assert.equal(plays.length, 0);
        // A second tap keeps the queued play; cancelling has its own control.
        await play.click();
        assert.equal(await play.innerText(), "Waiting…");
        await page.locator("#card-actions [data-cancel-play]").click();
        assert.equal(await play.innerText(), "Wait");
        await play.click();
        await page.keyboard.press("Escape");
        await selectCard(page, "lamp");
        const light = page.locator('#card-actions [data-action="light"]');
        assert.equal(await light.getAttribute("data-queued"), "false");
        await light.click();
        assert.equal(await light.innerText(), "Lighting…");
        if (stale) {
          world.items.lamp.lit = true;
          world.revision++;
          queue = [];
          await page.waitForFunction(
            () =>
              document.querySelector("#play-status").textContent ===
              "The table changed. Choose a current play.",
          );
          assert.equal(plays.length, 0);
        } else {
          await page.keyboard.press("Escape");
          await selectCard(page, "vale");
          await play.click();
          await page.screenshot({
            path: new URL(`queued-${width}.png`, output).pathname,
          });
          await page.waitForTimeout(1100);
          assert.equal(plays.length, 0);
          queue = [];
          await page.waitForFunction(
            () =>
              document.querySelector('#card-actions [data-action="wait"]')
                .dataset.queued === "false",
          );
          // Clearing the queued label precedes the asynchronous request handler.
          for (let attempt = 0; attempt < 100 && plays.length === 0; attempt++)
            await page.waitForTimeout(100);
          assert.equal(plays.length, 1);
          // A second choice made while the first request is in flight survives its reply.
          assert.equal(await play.isDisabled(), false);
          await play.click();
          assert.equal(await play.innerText(), "Waiting…");
          await heldReply();
          await page.waitForTimeout(1100);
          assert.equal(await play.innerText(), "Waiting…");
          assert.equal(plays.length, 1);
          queue = [];
          await page.waitForFunction(
            () =>
              document.querySelectorAll('#hand .card[aria-pressed="true"]')
                .length === 0,
          );
          assert.equal(plays.length, 2);
          assert.equal(world.turn, 2);
          await page.waitForTimeout(1100);
          assert.equal(plays.length, 2);
        }
        assert.deepEqual(errors, []);
        reports.push({
          width,
          stale,
          resting,
          open,
          plays: plays.length,
          errors,
        });
      } finally {
        await page.close();
      }
    }
    const page = await browser.newPage({
      viewport: { width, height: 844 },
      reducedMotion: "reduce",
    });
    const world = createWorld();
    addLog(world, "Vale", "I am ready for the next step.", {
      actorId: "vale",
      entityId: "vale",
      kind: "dialogue",
      generated: true,
    });
    await page.addInitScript(
      ({ save, seen }) => {
        localStorage.setItem("cosyworld.reflected-shore.v1.queue-local", save);
        localStorage.setItem(
          "cosyworld.reflected-shore.v1.queue-local.seen",
          JSON.stringify(seen),
        );
        localStorage.setItem("cosyworld.dialogue.sound", "off");
      },
      { save: encodeSave(world), seen: availableCards(world) },
    );
    await page.goto(`${origin}/?table=queue-local`);
    await page.waitForFunction(
      () =>
        document.querySelector("#dialogue-advance").dataset.revealing ===
        "false",
    );
    // A tap on the finished front card moves the exchange on.
    await page.locator("#dialogue-advance").click();
    await page.waitForFunction(
      () => document.querySelector("#hand").dataset.cooling === "false",
    );
    await page.close();
  }
} finally {
  await writeFile(
    new URL("report.json", output),
    JSON.stringify(reports, null, 2),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(JSON.stringify(reports));
