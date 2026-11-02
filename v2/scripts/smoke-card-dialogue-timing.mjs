import { selectCard } from "./card-browser-helpers.mjs";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  addLog,
  createWorld,
  encodeSave,
  legalActions,
  nameOf,
  play,
} from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";

function fixture(kind) {
  let world = enableMotives(createWorld({ opening: true }));
  // The opening starts lit: douse it to open the mirror, then relight it at
  // the pond (#1653).
  for (const kind of ["snuff", "move", "light"])
    world = play(
      world,
      legalActions(world).find(
        (a) => a.kind === kind && (kind !== "move" || a.target === "pond"),
      ),
    ).state;
  world.actors.keeper.place = "pond";
  world.opening.met.keeper = 0;
  if (kind === "light") world.items.lamp.lit = false;
  // The keeper's pack is private until Vale's want names his cloth (#1791).
  if (kind === "ask")
    world.actors.vale.want = {
      kind: "item",
      target: "cloth",
      since: world.turn,
      refusals: 0,
    };
  const previous = kind === "ask" ? "keeper" : "moth";
  addLog(world, nameOf(previous), "The last conversation has ended.", {
    actorId: previous,
    entityId: previous,
    locationId: "pond",
    kind: "dialogue",
    generated: true,
  });
  return world;
}

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const output = new URL("../../output/dialogue-timing/", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [width, height, motion] of [
    [1440, 900, "reduce"],
    [390, 844, "reduce"],
    [320, 568, "reduce"],
    [390, 844, "no-preference"],
  ]) {
    for (const kind of ["ask", "talk", "light", "wait"]) {
      const page = await browser.newPage({
        viewport: { width, height },
        reducedMotion: motion,
      });
      page.setDefaultTimeout(10_000);
      const table = `timing-${kind}-${width}-${motion}`;
      const key = `cosyworld.reflected-shore.v1.${table}`;
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(
        ({ key, save }) => {
          localStorage.setItem(key, save);
          localStorage.setItem("cosyworld.dialogue.sound", "off");
        },
        { key, save: encodeSave(fixture(kind)) },
      );
      let request;
      await page.route("**/card-game/text", (route) => {
        request = { route, input: route.request().postDataJSON() };
      });
      const state = () =>
        page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
      const card = (id) => page.locator(`#hand [data-card="${id}"]`);
      const report = { width, height, motion, kind, errors };
      results.push(report);
      try {
        await page.goto(
          `http://127.0.0.1:${server.address().port}/?table=${table}`,
        );
        await page.waitForFunction(
          () =>
            document.querySelector("#dialogue-advance").dataset.revealing ===
            "false",
        );
        await page.locator("#dialogue-advance").click();
        await page.waitForFunction(
          () => document.querySelector("#hand").dataset.cooling === "false",
        );
        const id = {
          ask: "cloth",
          talk: "keeper",
          light: "lamp",
          wait: "pond",
        }[kind];
        await selectCard(page, id);
        if (kind === "light") {
          // An ordinary play is silent: no request, and the hand frees at once.
          await page.locator("#card-actions .card-primary").click();
          await page.waitForFunction(
            () => document.querySelector("#hand").dataset.cooling === "false",
          );
          await page.waitForTimeout(600);
          assert.equal(request, undefined);
          assert.equal(await card("vale").isDisabled(), false);
          const world = await state();
          assert.equal(world.items.lamp.lit, true);
          const cast = await page
            .locator('#cast [data-avatar][aria-hidden="false"]')
            .evaluateAll((nodes) => nodes.map((node) => node.dataset.avatar));
          // Pip wants the lamp, so Pip stays to ask Vale for it; the keeper
          // leaves for the bell at the station.
          assert.deepEqual(cast.sort(), ["moth", "vale"]);
          assert.equal(await card("keeper").count(), 0);
          assert.equal(world.actors.moth.want?.target, "lamp");
          assert.equal(world.actors.keeper.place, "station");
          assert.deepEqual(errors, []);
          report.passed = true;
          // Skip the speech checks below; the page still closes.
          throw null;
        }
        const requested = page.waitForRequest("**/card-game/text");
        const start = performance.now();
        await page.locator("#card-actions .card-primary").click();
        await requested;
        // A newly revealed location completes its discovery before pairing.
        await page.waitForFunction(
          () =>
            document.querySelector("#hand").getAttribute("aria-busy") ===
            "false",
        );
        report.pendingSpeaker = await page.locator("#speaker").innerText();
        report.pendingMs = Math.round(performance.now() - start);
        assert.equal(report.pendingSpeaker, "Vale");
        assert.equal(
          await page.locator("#speaker-portrait").getAttribute("data-entity"),
          "vale",
        );
        assert.equal(await page.locator("#dialogue-text").textContent(), "");
        assert.equal(request.input.speakers[0], "vale");
        assert.equal(await card("vale").isDisabled(), false);
        await page.screenshot({
          path: new URL(`${kind}-pending-${width}.png`, output).pathname,
        });
        // A slow request releases play execution; pairing stays available.
        await page.waitForFunction(
          () => document.querySelector("#hand").dataset.cooling === "false",
        );
        assert.equal(await page.locator("#speaker").innerText(), "Vale");
        await request.route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            revision: request.input.revision,
            model: "dialogue-timing-fixture",
            entries: request.input.entities.map(({ id }) => ({
              id,
              text: `${nameOf(id)} has a full reply. ${"There is time to hear every word. ".repeat(10)}`,
            })),
          }),
        });
        await page.waitForFunction(() =>
          document
            .querySelector("#dialogue-text")
            .textContent.startsWith("Vale has a full reply."),
        );
        assert.equal(await card("vale").isDisabled(), false);
        await page.waitForTimeout(2800);
        assert.equal(await card("vale").isDisabled(), false);
        const layout = await page.evaluate(() => {
          const portrait = document
            .querySelector("#speaker-portrait")
            .getBoundingClientRect();
          const text = document
            .querySelector("#dialogue-text")
            .getBoundingClientRect();
          const style = getComputedStyle(
            document.querySelector("#dialogue-text"),
          );
          const card = document
            .querySelector("#speech-row")
            .getBoundingClientRect();
          return {
            portraitBottom: portrait.bottom,
            textTop: text.top,
            textWidth: text.width,
            cardWidth: card.width,
            lines: text.height / parseFloat(style.lineHeight),
            font: parseFloat(style.fontSize),
          };
        });
        // The name and portrait head the card; the speech runs the card's
        // full width below them and grows to about seven lines (#1599).
        assert(
          layout.portraitBottom <= layout.textTop + 1,
          JSON.stringify(layout),
        );
        assert(
          layout.textWidth > layout.cardWidth * 0.8,
          JSON.stringify(layout),
        );
        assert(
          layout.lines >= 3 && layout.lines <= 8,
          `Speech shows three to seven lines: ${layout.lines}`,
        );
        assert(layout.font >= (width < 700 ? 14 : 15));
        await page.locator("#dialogue-advance").focus();
        if (motion !== "reduce")
          await page.locator("#dialogue-advance").click();
        await page.locator("#dialogue-advance").press("Home");
        await page.locator("#dialogue-advance").press("ArrowDown");
        // A line that fits is shown whole; a longer one scrolls by keyboard.
        assert(
          await page
            .locator("#dialogue-text")
            .evaluate(
              (el) =>
                el.scrollHeight <= el.clientHeight + 1 || el.scrollTop > 0,
            ),
          "Keyboard scroll reads the full speech",
        );
        await page.screenshot({
          path: new URL(`speech-${width}-${motion}.png`, output).pathname,
        });
        // A speaker who left this turn speaks at the destination (#1437), so
        // only the speakers still in this room take a turn here.
        const committed = await state();
        const speakers = request.input.speakers.filter(
          (id) => committed.actors[id]?.place === request.input.location,
        );
        assert.equal(speakers[0], "vale");
        const spoken = [];
        let queuedTurn = null;
        for (const [i, speaker] of speakers.entries()) {
          spoken.push(await page.locator("#speaker").innerText());
          assert.equal(spoken.at(-1), nameOf(speaker));
          assert.equal(
            await page.locator("#speaker-portrait").getAttribute("data-entity"),
            speaker,
          );
          if (
            (await page
              .locator("#dialogue-advance")
              .getAttribute("data-revealing")) === "true"
          )
            await page.locator("#dialogue-advance").click();
          assert.equal(await card("vale").isDisabled(), false);
          if (kind === "wait" && i === speakers.length - 1) {
            queuedTurn = (await state()).turn;
            await selectCard(page, "vale");
            await page.locator("#card-actions .card-primary").click();
            assert.equal(
              await page.locator("#card-actions .card-primary").innerText(),
              "Waiting…",
            );
            assert.equal((await state()).turn, queuedTurn);
          }
          await page.locator("#dialogue-advance").click();
          if (i < speakers.length - 1) {
            // The next beat arrives in front while the finished one recedes.
            assert.equal(await card("vale").isDisabled(), false);
            await page.waitForFunction(
              (name) => document.querySelector("#speaker").textContent === name,
              nameOf(speakers[i + 1]),
            );
          }
        }
        await page.waitForFunction(
          () => document.querySelector("#hand").dataset.cooling === "false",
        );
        assert.equal(await card("vale").isDisabled(), false);
        if (queuedTurn !== null)
          assert.equal((await state()).turn, queuedTurn + 1);
        report.spoken = spoken;
        report.finishedMs = Math.round(performance.now() - start);
        assert.deepEqual(errors, []);
        report.passed = true;
      } catch (error) {
        // The silent play's checks end early by throwing null.
        if (error !== null) report.error = error.stack;
        if (error !== null)
          await page.screenshot({
            path: new URL(`${kind}-failure-${width}.png`, output).pathname,
          });
      } finally {
        await page.close();
      }
      console.log(report);
    }
  }
  await writeFile(
    new URL("report.json", output),
    JSON.stringify(results, null, 2),
  );
  assert(
    results.every((result) => result.passed),
    "dialogue timing browser checks",
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
