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
  holdChoice,
  nameOf,
  play,
} from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { SPEECH_OCCASIONS } from "../card-game/speech-occasions.mjs";

function fixture(kind) {
  let world = enableMotives(createWorld({ opening: true }));
  // Hold/stow replaced the retired Light/Snuff actions. Cross using the
  // actual dark mirror, then leave the hand empty for the selected pairing.
  holdChoice(world, "vale", { item: null, revision: world.revision });
  const crossing = legalActions(world).find(
    (action) => action.kind === "move" && action.target === "pond",
  );
  assert.ok(crossing, "The stowed lamp opens the mirror crossing");
  world = play(world, crossing).state;
  world.actors.keeper.place = "pond";
  world.opening.met.keeper = world.turn;
  if (kind === "take") {
    world.items.lamp.holder = "pond";
    holdChoice(world, "vale", { item: null, revision: world.revision });
    assert.equal(world.items.lamp.lit, true, "The grounded fueled lamp is lit");
    assert.ok(
      legalActions(world).some((a) => a.kind === "take" && a.item === "lamp"),
    );
  }
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
    for (const kind of ["ask", "talk", "take", "wait"]) {
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
      let request,
        requestCount = 0;
      await page.route("**/card-game/text", (route) => {
        requestCount += 1;
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
          take: "lamp",
          wait: "pond",
        }[kind];
        await selectCard(page, id);
        const action = page.locator(
          '#card-actions .card-primary:not([data-revealing="true"])',
        );
        await action.waitFor();
        assert.equal(await action.getAttribute("data-action"), kind);
        const requested = page.waitForRequest("**/card-game/text");
        const start = performance.now();
        await action.click();
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
        // Vale's name is written in Vale's card colour, through the same
        // reveal (card-names.mjs).
        assert.deepEqual(
          await page.$eval("#dialogue-text .card-name", (run) => [
            run.textContent,
            run.style.getPropertyValue("--tier-color"),
          ]),
          ["Vale", "#c8dce6"],
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
        // full width below them and grows to fit the whole reply.
        assert(
          layout.portraitBottom <= layout.textTop + 1,
          JSON.stringify(layout),
        );
        assert(
          layout.textWidth > layout.cardWidth * 0.8,
          JSON.stringify(layout),
        );
        assert(layout.lines >= 3, `Speech grows to fit: ${layout.lines}`);
        assert(layout.font >= (width < 700 ? 14 : 15));
        await page.locator("#dialogue-advance").focus();
        if (motion !== "reduce")
          await page.locator("#dialogue-advance").click();
        assert(
          await page
            .locator("#dialogue-text")
            .evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
          "The card shows the whole reply",
        );
        await page.screenshot({
          path: new URL(`speech-${width}-${motion}.png`, output).pathname,
        });
        // A speaker who left this turn speaks at the destination (#1437), so
        // only the speakers still in this room take a turn here.
        const committed = await state();
        if (kind === "take") {
          assert.equal(committed.items.lamp.lit, true);
          const cast = await page
            .locator('#cast [data-avatar][aria-hidden="false"]')
            .evaluateAll((nodes) => nodes.map((node) => node.dataset.avatar));
          assert.deepEqual(cast.sort(), ["moth", "vale"]);
          assert.equal(committed.actors.moth.want?.target, "lamp");
          assert.equal(committed.actors.keeper.place, "station");
          assert.equal(await card("keeper").count(), 0);
          assert.deepEqual(request.input.speakers, ["vale"]);
        }
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
            const asked = requestCount;
            await selectCard(page, "vale");
            await action.click();
            assert.equal(await page.locator("#card-actions button").count(), 0);
            if (SPEECH_OCCASIONS.includes("first_wait")) {
              await page.waitForFunction(
                ({ key, turn }) =>
                  JSON.parse(localStorage.getItem(key)).turn === turn,
                { key, turn: queuedTurn + 1 },
              );
              assert.equal(
                requestCount,
                asked,
                "The visit's second Wait keeps its action card",
              );
              assert.match(
                await page.locator("#beat-captions").textContent(),
                /wait/u,
              );
            } else {
              // Earlier speech rules ask again while reflection is still due.
              await page.waitForFunction(
                () => document.querySelector("#story-status").hidden === false,
              );
            }
            break;
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
        report.error = error.stack;
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
