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
  let world = enableMotives(createWorld({ opening: true }), {
    questPrograms: true,
    personalQuests: true,
  });
  for (const kind of ["light", "move"])
    world = play(
      world,
      legalActions(world).find(
        (a) => a.kind === kind && (kind !== "move" || a.target === "pond"),
      ),
    ).state;
  world.actors.keeper.place = "pond";
  world.opening.met.keeper = 0;
  if (kind === "light") world.items.lamp.lit = false;
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
  for (const width of [1440, 390]) {
    for (const kind of ["ask", "talk", "light"]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
      });
      page.setDefaultTimeout(10_000);
      const table = `dialogue-timing-${kind}-${width}`;
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
      const report = { width, kind, errors };
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
        const id = { ask: "cloth", talk: "keeper", light: "lamp" }[kind];
        await selectCard(page, id);
        const requested =
          kind === "light" ? null : page.waitForRequest("**/card-game/text");
        const start = performance.now();
        await page.locator("#card-actions .card-primary").click();
        if (kind === "light") {
          const world = await state();
          const here = world.actors.vale.place;
          assert.equal(world.items.lamp.lit, true);
          assert.equal(world.actors.moth.place, "station");
          assert.equal(world.actors.keeper.place, "station");
          const cast = await page
            .locator("#cast [data-avatar]")
            .evaluateAll((nodes) => nodes.map((node) => node.dataset.avatar));
          assert.deepEqual(cast, ["vale"]);
          assert(cast.every((id) => world.actors[id].place === here));
          assert.equal(await card("moth").count(), 0);
          assert.equal(await card("keeper").count(), 0);
          assert.equal(request, undefined);
        } else {
          await requested;
          report.pendingSpeaker = await page.locator("#speaker").innerText();
          report.pendingMs = Math.round(performance.now() - start);
          assert.equal(report.pendingSpeaker, "Vale");
          assert.equal(await page.locator("#dialogue-text").textContent(), "");
          assert.equal(request.input.speakers[0], "vale");
          assert.equal(await card("vale").isDisabled(), true);
          await page.screenshot({
            path: new URL(`${kind}-pending-${width}.png`, output).pathname,
          });
          // A slow request releases the hand; completed words take it back.
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
                text: `${nameOf(id)} has a full reply. ${"There is time to hear every word. ".repeat(6)}`,
              })),
            }),
          });
          await page.waitForFunction(() =>
            document
              .querySelector("#dialogue-text")
              .textContent.startsWith("Vale has a full reply."),
          );
          assert.equal(await card("vale").isDisabled(), true);
          await page.waitForTimeout(2800);
          assert.equal(await card("vale").isDisabled(), true);
          const spoken = [];
          for (const speaker of request.input.speakers) {
            spoken.push(await page.locator("#speaker").innerText());
            assert.equal(spoken.at(-1), nameOf(speaker));
            assert.equal(await card("vale").isDisabled(), true);
            await page.locator("#dialogue-advance").click();
          }
          assert.equal(await card("vale").isDisabled(), false);
          report.spoken = spoken;
          report.finishedMs = Math.round(performance.now() - start);
        }
        assert.deepEqual(errors, []);
        report.passed = true;
      } catch (error) {
        report.error = error.message;
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
