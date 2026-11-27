import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { holdItem } from "./card-browser-helpers.mjs";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  createWorld,
  encodeSave,
  legalActions,
  play,
} from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";

let fixture = enableMotives(createWorld({ opening: true }));
// The opening starts lit: put the lamp out to open the mirror, then hold it
// again at the pond (#1653, #2580).
fixture = holdItem(fixture, null);
fixture = play(
  fixture,
  legalActions(fixture).find((a) => a.kind === "move" && a.target === "pond"),
).state;
fixture = holdItem(fixture, "lamp");
const save = encodeSave(fixture),
  key = "cosyworld.reflected-shore.v1.dialogue-recovery";
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  await mkdir("output/dialogue-recovery", { recursive: true });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    const errors = [],
      requests = [],
      abandoned = [];
    let mode = "unavailable";
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("requestfailed", (request) => {
      if (request.url().endsWith("/card-game/text"))
        abandoned.push(request.postDataJSON().revision);
    });
    await page.addInitScript(
      ({ key, save }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        localStorage.setItem(
          `${key}.seen`,
          JSON.stringify([
            "vale",
            "moth",
            "keeper",
            "badger",
            "lamp",
            "oil",
            "cloth",
            "bell",
            "attic",
            "pond",
            "station",
            "clearing",
          ]),
        );
      },
      { key, save },
    );
    await page.route("**/card-game/text", async (route) => {
      const input = route.request().postDataJSON();
      requests.push(input);
      if (mode === "hang") return;
      if (mode === "slow") await new Promise((r) => setTimeout(r, 8000));
      await route.fulfill(
        mode === "unavailable"
          ? {
              status: 503,
              contentType: "application/json",
              body: '{"error":"fixture unavailable"}',
            }
          : {
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                revision: input.revision,
                model: "browser-fixture",
                entries: input.entities.map(({ id }) => ({
                  id,
                  text:
                    mode === "invalid"
                      ? " "
                      : `${id} speaks on turn ${input.turn}.`,
                })),
              }),
            },
      );
    });
    const ready = async () => {
      for (let i = 0; i < 250; i++) {
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
        if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        await page.waitForTimeout(40);
      }
      throw new Error("The hand stayed busy.");
    };
    const state = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    // Unavailable dialogue keeps the next play ready.
    const noFailureUi = async () => {
      assert.equal(await page.locator("#story-retry, #story-error").count(), 0);
      assert.equal(await page.locator("[data-retry-words]").count(), 0);
      assert.doesNotMatch(
        await page.locator("body").innerText(),
        /didn.t arrive|Retry dialogue|\bRetry\b/u,
      );
    };
    // The front beat shows the missing reply as a single status.
    const silentBeat = async () => {
      await page.waitForFunction(
        () =>
          document.querySelector("#speech-row")?.dataset.beat === "silent" &&
          document.querySelector("#dialogue-text").textContent.trim() === "Reply unavailable",
        null,
        { timeout: 6000 },
      );
      await noFailureUi();
    };
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=dialogue-recovery`,
    );
    // Loading a quiet scene is silent. Explicit conversation requests words.
    const person = page.locator('#hand [data-card="moth"]');
    await person.click();
    await page.locator("#card-actions .card-primary").click();
    await silentBeat();
    await page.waitForFunction(
      () => document.querySelector("#hand").dataset.cooling === "false",
      null,
      { timeout: 6000 },
    );
    assert.equal(requests.length, 1, "one request, no second try");
    assert.equal(await page.locator(".dialogue").isVisible(), true);
    assert.equal(await page.locator("#story-status").isVisible(), false);
    // The status appears on the beat of the expected speaker.
    assert.notEqual((await page.locator("#speaker").innerText()).trim(), "");
    const captionBounds = await page.locator("#beat-captions").boundingBox();
    assert(
      !captionBounds || captionBounds.width > 100,
      "the saved action caption remains readable",
    );
    await page.screenshot({
      path: `output/dialogue-recovery/silent-${width}.png`,
    });
    const before = await state();
    await page.waitForTimeout(1500);
    assert.equal(requests.length, 1);
    // The next play is available at once. Invalid content also shows a status, and
    // nothing is saved for it.
    mode = "invalid";
    const choose = async () => {
      if ((await person.getAttribute("aria-pressed")) !== "true")
        await person.click();
    };
    await choose();
    await page.locator("#card-actions .card-primary").click();
    assert.equal((await state()).turn, before.turn + 1, "the next play runs");
    await silentBeat();
    assert.equal(await page.locator("#story-status").isVisible(), false);
    assert.doesNotMatch(
      await page.locator(".dialogue").innerText(),
      /incomplete|Retry this scene/,
    );
    const failed = await state();
    assert.equal(failed.turn, before.turn + 1);
    assert.equal(
      failed.log.some((e) => e.turn === failed.turn && e.generated),
      false,
    );
    // Keep the existing history, without an extra status banner over the cast.
    assert.equal(await page.locator("#turn-receipt").count(), 0);
    assert.equal(
      failed.log.some((e) => e.turn === failed.turn && e.kind === "action"),
      true,
    );
    await page.evaluate(() =>
      document.querySelector("#history-button").click(),
    );
    assert.doesNotMatch(await page.locator("#messages").innerText(), /Turn \d/);
    await page.evaluate(() =>
      document.querySelector("#history-dialog").close(),
    );
    // A reload after words failed never asks again and shows no failure:
    // the hand is free and the caption stands.
    const failedRequests = requests.length;
    await page.reload();
    await page.waitForFunction(
      () => document.querySelector("#hand").dataset.cooling === "false",
    );
    await page.waitForTimeout(1000);
    assert.equal(requests.length, failedRequests, "no re-ask after a failure");
    assert.equal(await page.locator("#story-status").isVisible(), false);
    await noFailureUi();
    // Slow words release the hand rather than holding it.
    mode = "hang";
    await choose();
    await page.locator("#card-actions .card-primary").click();
    await page.waitForFunction(
      () => document.querySelector("#hand").dataset.cooling === "false",
      null,
      { timeout: 6000 },
    );
    const hung = (await state()).turn;
    assert.equal(hung, failed.turn + 1);
    assert.equal(
      (await state()).log.some((e) => e.turn === hung && e.kind === "action"),
      true,
    );
    const pendingRequests = requests.length;
    mode = "ready";
    await page.reload();
    await ready();
    await page.waitForTimeout(1000);
    assert.equal(requests.length, pendingRequests, "no re-ask on reload");
    await noFailureUi();
    assert.equal(
      (await state()).log.some((e) => e.turn === hung && e.generated),
      false,
    );
    await choose();
    await page.locator("#card-actions .card-primary").click();
    await ready();
    assert.equal((await state()).turn, hung + 1);
    assert.match(
      await page.textContent("#dialogue-text"),
      new RegExp(`speaks on turn ${hung + 1}`),
    );
    await page.reload();
    await ready();
    assert.match(
      await page.textContent("#dialogue-text"),
      new RegExp(`speaks on turn ${hung + 1}`),
    );
    // Slow words keep the Thinking card but not the hand: after a short
    // grace the next choice is offered, and the late line still types in.
    mode = "slow";
    await choose();
    await page.locator("#card-actions .card-primary").click();
    const slow = await state();
    const started = Date.now();
    await page.waitForFunction(
      () => document.querySelector("#hand").dataset.cooling === "false",
    );
    if (!(await page.locator("#card-actions .card-primary").isVisible())) {
      await page.keyboard.press("Escape");
      await choose();
    }
    await page
      .locator("#card-actions .card-primary")
      .waitFor({ state: "visible", timeout: 7000 });
    assert(Date.now() - started < 7500, "the next choice waits only a grace");
    assert.doesNotMatch(
      await page.textContent("#dialogue-text"),
      new RegExp(`speaks on turn ${slow.turn}`),
    );
    // Playing a voiced choice (Wait, here at the pond) while the line is
    // late keeps the line: the next play waits behind it, as at a shared
    // seat, then speaks in turn.
    await page.keyboard.press("Escape");
    await page.locator('#hand [data-card="pond"]').click();
    await page.locator("#card-actions .card-primary").click();
    assert.equal((await state()).turn, slow.turn, "the next play waits");
    // A line waits for a tap before the next one, so read on while waiting.
    const lineFor = async (turn) => {
      const shown = () =>
        page.evaluate(
          (turn) =>
            document
              .querySelector("#dialogue-text")
              .textContent.includes(`speaks on turn ${turn}`),
          turn,
        );
      for (let i = 0; i < 300 && !(await shown()); i++) {
        if (turn > slow.turn && (await page.locator("#dialogue-advance").isVisible()))
          await page.locator("#dialogue-advance").click();
        await page.waitForTimeout(40);
      }
      assert(await shown(), `the line for turn ${turn} came`);
    };
    await lineFor(slow.turn);
    assert(!abandoned.includes(slow.revision), "the late line is not dropped");
    await noFailureUi();
    mode = "ready";
    await lineFor(slow.turn + 1);
    const spoken = (await state()).log.filter((entry) =>
      /speaks on turn \d+/u.test(entry.text || ""),
    );
    const late = spoken.findIndex((entry) =>
      entry.text.endsWith(`speaks on turn ${slow.turn}.`),
    );
    const next = spoken.findIndex((entry) =>
      entry.text.endsWith(`speaks on turn ${slow.turn + 1}.`),
    );
    assert(late >= 0 && next > late, "the late line comes before the next");
    assert.equal(spoken[late].turn, slow.turn);
    await noFailureUi();
    await page.locator("#toolbar-menu-button").click();
    await page.locator("#world-menu").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    assert.deepEqual(errors, []);
    console.log(
      `Unavailable reply status, next play, late line and reload passed at ${width}px.`,
    );
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
