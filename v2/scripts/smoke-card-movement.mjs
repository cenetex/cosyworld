import { selectCard } from "./card-browser-helpers.mjs";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  createWorld,
  encodeSave,
  legalActions,
  nameOf,
  play,
} from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";

function fixture(kind) {
  let s = enableMotives(createWorld({ opening: true }), {
    questPrograms: true,
    personalQuests: true,
  });
  s = play(
    s,
    legalActions(s).find((a) => a.kind === "light"),
  ).state;
  if (kind !== "resident") {
    s = play(
      s,
      legalActions(s).find((a) => a.kind === "move" && a.target === "pond"),
    ).state;
    s.actors.vale.place = s.actors.moth.place = "attic";
    s.items.lamp.holder = "vale";
    s.items.lamp.fuel = 8;
  }
  return s;
}

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const output = new URL("../../output/movement/", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [kind, width, motion, latency] of [
    ["follow", 1440, "no-preference", 0],
    ["follow", 390, "no-preference", 2500],
    ["shared", 1440, "no-preference", 0],
    ["resident", 390, "no-preference", 0],
    ["follow", 390, "reduce", 0],
    ["reset", 390, "no-preference", 0],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: motion,
    });
    page.setDefaultTimeout(15000);
    const table = `movement-${kind}-${width}-${motion}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
    const report = { kind, width, motion, latency, errors: [] };
    results.push(report);
    page.on("pageerror", (error) => report.errors.push(error.message));
    await page.addInitScript(
      ({ key, save }) => {
        localStorage.setItem(key, save);
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false }),
        );
        window.movementCheck = { frames: [], animations: [] };
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (...args) {
          const avatar = this.closest("[data-avatar]")?.dataset.avatar;
          if (avatar && window.movementCheck.active) {
            const entry = {
              avatar,
              start: performance.now(),
              opacity: Number(
                getComputedStyle(document.querySelector("#travel")).opacity,
              ),
              delay: args[1]?.delay || 0,
            };
            window.movementCheck.animations.push(entry);
            const result = animate.apply(this, args);
            void result.finished.then(
              () => (entry.end = performance.now()),
              () => {},
            );
            return result;
          }
          return animate.apply(this, args);
        };
      },
      { key, save: encodeSave(fixture(kind)) },
    );
    let request;
    await page.route("**/card-game/text", async (route) => {
      request = route.request().postDataJSON();
      if (latency) await new Promise((resolve) => setTimeout(resolve, latency));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          revision: request.revision,
          model: "movement-fixture",
          entries: request.entities.map(({ id }) => ({
            id,
            text: `${nameOf(id)} has something to say. The air is cool beside the water.`,
          })),
        }),
      });
    });
    try {
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?table=${table}`,
      );
      // A longer CSS fade also checks that travel follows rendered completion.
      if (kind === "follow" && width === 1440) {
        report.fadeMs = 800;
        await page.locator("#travel").evaluate((veil) => {
          veil.style.transitionDuration = "800ms";
        });
      }
      const card = (id) => page.locator(`#hand [data-card="${id}"]`);
      await card("pond").waitFor({ state: "attached" });
      await page.waitForFunction(
        () => document.querySelector("#cast .entering") === null,
      );
      await page.evaluate(() => {
        window.movementCheck.active = true;
        function sample() {
          if (!window.movementCheck.active) return;
          window.movementCheck.frames.push({
            at: performance.now(),
            backdrop: document.querySelector("#backdrop").getAttribute("src"),
            opacity: Number(
              getComputedStyle(document.querySelector("#travel")).opacity,
            ),
            speech: Boolean(document.querySelector("#dialogue-text .revealed")),
            cooling: document.querySelector("#hand").dataset.cooling,
          });
          requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
      if (kind === "shared") await selectCard(page, "moth");
      await selectCard(page, "pond");
      await page.locator("#card-actions .card-primary").click();
      if (kind === "reset") {
        await page.locator("#menu-button").click();
        await page.locator("#new-game").click();
        await page.locator("#confirm-reset").click();
        await page.waitForTimeout(2000);
        await page.evaluate(() => {
          window.movementCheck.active = false;
        });
        const saved = await page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)),
          key,
        );
        assert.equal(saved.turn, 0);
        assert.equal(saved.actors.vale.place, "attic");
        assert.equal(
          await page.locator("#backdrop").getAttribute("src"),
          "./assets/attic.png",
        );
        assert.equal(
          await page
            .locator("#travel")
            .evaluate((el) => Number(getComputedStyle(el).opacity)),
          0,
        );
        assert.equal(await page.locator("#cast .entering").count(), 0);
        assert.equal(await card("vale").isDisabled(), false);
        assert.equal(await page.locator("#dialogue-text").textContent(), "");
        assert.deepEqual(report.errors, []);
        report.passed = true;
        continue;
      }
      await page.waitForFunction(() =>
        document.querySelector("#dialogue-text .revealed"),
      );
      const captured = await page.evaluate(() => {
        window.movementCheck.active = false;
        return window.movementCheck;
      });
      report.animations = captured.animations;
      const firstPond = captured.frames.find((f) =>
        f.backdrop?.endsWith("/pond.png"),
      );
      const firstSpeech = captured.frames.find((f) => f.speech);
      report.firstPond = firstPond;
      report.firstSpeech = firstSpeech;
      if (motion !== "reduce") {
        assert(
          firstPond.opacity >= 0.99,
          "The old scene stays until the travel screen is opaque.",
        );
        assert(
          firstSpeech.opacity <= 0.01,
          "Speech starts after the travel screen clears.",
        );
        assert(
          captured.animations.every((a) => a.opacity <= 0.01),
          "Entrances play in view.",
        );
        assert(
          captured.animations.every((a) => a.end <= firstSpeech.at),
          "Speech follows the entrances.",
        );
        const vale = captured.animations.find((a) => a.avatar === "vale");
        const pip = captured.animations.find((a) => a.avatar === "moth");
        assert(vale);
        if (kind === "follow")
          assert(
            pip.start + pip.delay >= vale.start + 200,
            "Pip follows in a separate entrance.",
          );
        if (kind === "shared")
          assert(
            Math.abs(pip.start + pip.delay - vale.start - vale.delay) < 100,
            "Agreed companions arrive together.",
          );
        if (kind === "resident") assert.equal(pip, undefined);
      }
      const caption = await page.locator("#movement-caption").innerText();
      assert.match(
        caption,
        kind === "shared"
          ? /Pip travels with Vale/
          : kind === "resident"
            ? /Pip is waiting here/
            : /Pip follows from Mirror attic/,
      );
      report.caption = caption;
      assert.equal(await card("vale").isDisabled(), true);
      assert.deepEqual(
        request.outcome.avatars.find((a) => a.id === "moth").travel
          ?.companions ?? [],
        kind === "shared" ? ["vale"] : [],
      );
      await page.screenshot({ path: new URL(`${table}.png`, output).pathname });
      assert.deepEqual(report.errors, []);
      report.passed = true;
    } catch (error) {
      report.error = error.message;
    } finally {
      await page.close();
    }
    console.log(report);
  }
  await writeFile(
    new URL("report.json", output),
    JSON.stringify(results, null, 2),
  );
  assert(
    results.every((r) => r.passed),
    "Movement browser checks",
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
