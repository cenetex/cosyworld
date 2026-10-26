import { selectCard } from "./card-browser-helpers.mjs";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, webkit } from "playwright";
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
const type = process.env.CARD_BROWSER || "chromium";
const output = new URL(
  `../../output/dialogue-timing${type === "chromium" ? "" : `-${type}`}/`,
  import.meta.url,
);
await mkdir(output, { recursive: true });
const browser = await { chromium, webkit }[type].launch({ headless: true });
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
          if (!localStorage.getItem(key)) localStorage.setItem(key, save);
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
        const requested = page.waitForRequest("**/card-game/text");
        const start = performance.now();
        await page.locator("#card-actions .card-primary").click();
        await requested;
        report.pendingSpeaker = await page.locator("#speaker").innerText();
        report.pendingMs = Math.round(performance.now() - start);
        assert.equal(report.pendingSpeaker, "Vale");
        assert.equal(
          await page.locator("#speaker-portrait").getAttribute("data-entity"),
          "vale",
        );
        assert.equal(await page.locator("#dialogue-text").textContent(), "");
        assert.equal(
          await page.locator("#prior-text").textContent(),
          "The last conversation has ended.",
        );
        assert.equal(await page.locator("#prior-response").isVisible(), true);
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
        if (kind === "ask" && width === 390 && motion === "reduce") {
          await request.route.fulfill({ status: 422, body: "Invalid scene" });
          await page.locator("#story-retry").waitFor({ state: "visible" });
          assert.equal(
            await page.locator("#prior-text").textContent(),
            "The last conversation has ended.",
            "The last reply stays through a failed request",
          );
          const retried = page.waitForRequest("**/card-game/text");
          await page.locator("#story-retry").click();
          await retried;
        }
        const departure = (id) =>
          request.input.outcome.avatars.find(
            (avatar) =>
              avatar.id === id &&
              avatar.travel?.from === request.input.location &&
              avatar.travel.to !== request.input.location,
          );
        const reply = (id) =>
          departure(id)
            ? `I'm heading to ${nameOf(departure(id).travel.to)}. I want a quiet moment to myself.`
            : `${nameOf(id)} has a full reply. ${"There is time to hear every word. ".repeat(10)}`.trim();
        if (kind === "light") {
          assert.equal(
            await page.locator("#movement-caption").isVisible(),
            false,
          );
          for (const id of ["moth", "keeper"])
            assert.equal(
              await page
                .locator(`#cast [data-avatar="${id}"]`)
                .getAttribute("aria-hidden"),
              "false",
              "A departing avatar waits for their own words",
            );
        }
        await request.route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            revision: request.input.revision,
            model: "dialogue-timing-fixture",
            entries: request.input.entities.map(({ id }) => ({
              id,
              text: reply(id),
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
          const prior = document.querySelector("#prior-response");
          const priorStyle = getComputedStyle(prior);
          return {
            portraitRight: portrait.right,
            textLeft: text.left,
            lines: text.height / parseFloat(style.lineHeight),
            font: parseFloat(style.fontSize),
            priorFont: parseFloat(priorStyle.fontSize),
            priorLines: prior.clientHeight / parseFloat(priorStyle.lineHeight),
            stageLeft: document.querySelector("#stage").scrollLeft,
          };
        });
        assert(layout.portraitRight < layout.textLeft);
        assert(layout.lines >= 2.95 && layout.lines <= 3.05);
        assert(layout.font >= 15);
        assert(layout.priorFont < layout.font);
        assert(layout.priorLines > 0 && layout.priorLines <= 2.05);
        assert.equal(layout.stageLeft, 0);
        report.layout = layout;
        await page.locator("#dialogue-advance").focus();
        if (motion !== "reduce")
          await page.locator("#dialogue-advance").click();
        await page.locator("#dialogue-advance").press("Home");
        await page.locator("#dialogue-advance").press("ArrowDown");
        assert(
          await page
            .locator("#dialogue-text")
            .evaluate((el) => el.scrollTop > 0),
          "Keyboard scroll reads the full speech",
        );
        await page.screenshot({
          path: new URL(`speech-${width}-${motion}.png`, output).pathname,
        });
        const spoken = [];
        for (const [i, speaker] of request.input.speakers.entries()) {
          spoken.push(await page.locator("#speaker").innerText());
          assert.equal(spoken.at(-1), nameOf(speaker));
          assert.equal(
            await page.locator("#speaker-portrait").getAttribute("data-entity"),
            speaker,
          );
          assert.equal(
            await page.locator("#prior-text").textContent(),
            i
              ? reply(request.input.speakers[i - 1])
              : "The last conversation has ended.",
          );
          if (departure(speaker))
            assert.equal(
              await page
                .locator(`#cast [data-avatar="${speaker}"]`)
                .getAttribute("aria-hidden"),
              "false",
              "The avatar stays through their farewell",
            );
          if (
            (await page
              .locator("#dialogue-advance")
              .getAttribute("data-revealing")) === "true"
          )
            await page.locator("#dialogue-advance").click();
          assert.equal(await card("vale").isDisabled(), true);
          await page.locator("#dialogue-advance").click();
          if (i < request.input.speakers.length - 1) {
            if (motion !== "reduce") {
              assert.equal(
                await page.locator("#speaker").innerText(),
                nameOf(speaker),
              );
              assert.equal(await card("vale").isDisabled(), true);
            }
            await page.waitForFunction(
              (name) => document.querySelector("#speaker").textContent === name,
              nameOf(request.input.speakers[i + 1]),
            );
            if (departure(speaker))
              assert.equal(
                await page
                  .locator(`#cast [data-avatar="${speaker}"]`)
                  .getAttribute("aria-hidden"),
                "true",
                "The visible exit follows the farewell",
              );
          }
        }
        await page.waitForFunction(
          () => document.querySelector("#hand").dataset.cooling === "false",
        );
        assert.equal(await card("vale").isDisabled(), false);
        report.spoken = spoken;
        report.finishedMs = Math.round(performance.now() - start);
        if (kind === "light") {
          const world = await state();
          assert.equal(world.items.lamp.lit, true);
          const cast = await page
            .locator('#cast [data-avatar][aria-hidden="false"]')
            .evaluateAll((nodes) => nodes.map((node) => node.dataset.avatar));
          assert.deepEqual(cast, ["vale"]);
          assert.equal(await card("moth").count(), 0);
          assert.equal(await card("keeper").count(), 0);
          assert.equal(world.actors.moth.place, "station");
          assert.equal(world.actors.keeper.place, "station");
          await page.screenshot({
            path: new URL(`farewells-${width}-${motion}.png`, output).pathname,
          });
          if (width === 390 && motion === "reduce") {
            await page.reload();
            await page.waitForFunction(
              () => document.querySelector("#previous-line").disabled === false,
            );
            assert.deepEqual(await state(), world);
            assert.equal(
              await page.locator("#prior-text").textContent(),
              reply("moth"),
            );
            await page.locator("#previous-line").click();
            assert.equal(
              await page.locator("#speaker").innerText(),
              nameOf("moth"),
            );
            assert.equal(
              await page.locator("#prior-text").textContent(),
              reply("vale"),
            );
            assert.equal(
              await page
                .locator('#cast [data-avatar="moth"][aria-hidden="false"]')
                .count(),
              0,
              "Review keeps the current cast",
            );
          }
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
