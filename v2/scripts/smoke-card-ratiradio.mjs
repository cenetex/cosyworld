import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave, legalActions, play } from "../card-game/world.mjs";
import { availableCards } from "../card-game/cards.mjs";
import { packPeople, packDefinition } from "../card-game/pack-registry.mjs";
import { clearSelection, revealCard, tapCard, readyActionButton } from "./card-browser-helpers.mjs";

// This prerequisite can land before the pack. Its integration run must play
// the mounted pack; absence is reported plainly, never as passed gameplay.
if (!packPeople["ratiradio-rati"]) {
  console.log("RatiRadio not mounted; gameplay check not run.");
  process.exit(0);
}
const output = fileURLToPath(new URL("../../output/ratiradio/", import.meta.url));
const id = (name) => `ratiradio-${name}`;
const home = id("listening-room"), raven = id("raven"), rati = id("rati");
// The doors are three different locks: the Beanie held, the Thermos set down
// at the Dispatch Window, and a Talk with RATi while holding the figurine.
const route = [
  ["take", id("station-key")], ["move", "station"],
  ["move", id("staff-kitchen")], ["drop", id("station-key")],
  ["take", id("red-beanie")], ["take", id("thermos")],
  ["take", id("raven-figurine")], ["move", id("dispatch-window")],
  ["drop", id("thermos")], ["move", home],
  ["talk", rati], ["drop", id("red-beanie")],
  ["move", id("broadcast-booth")],
  ["take", id("glass")], ["move", home],
  ["drop", id("glass")], ["drop", id("raven-figurine")],
];
let start = createWorld({ opening: true, seed: 17 });
// Gate/return smoke: objects have already been fetched and left in the rooms.
// Fresh external placement and its voyage are covered by card-radio-scatter.
for (const [id, item] of Object.entries(packDefinition("ratiradio").items))
  if (item.scatterOutside) start.items[id].holder = item.holder;
// Fetched keepsakes wait in the kitchen. The Thermos opens the Listening Room
// only when set down at the Dispatch Window; carrying the figurine to RATi
// opens the Booth only when they Talk.
for (const keepsake of ["thermos", "raven-figurine"]) start.items[id(keepsake)].holder = id("staff-kitchen");
// A real local journey retains its opening ledger after leaving the forest.
start.opening.crossed = true;
start.opening.met.moth = 0;
start.locations.attic.anchored = true;
start.actors.vale.place = "pond";
start.actors.vale.visited.push("pond");
for (const item of Object.values(start.items)) if (item.holder === "vale") item.holder = "pond";
for (const [kind, target] of route.slice(0, 8)) {
  const action = legalActions(start).find((a) => a.kind === kind && (a.item === target || a.target === target));
  assert(action, `${kind} ${target}`);
  const result = play(start, action);
  assert(result.ok, result.error);
  start = result.state;
}
const server = createServer();
await new Promise((done) => server.listen(0, "127.0.0.1", done));
await mkdir(output, { recursive: true });
const reports = [];
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const report = { width, height, browser: browser.version(), checks: [], errors: [], console: [], assetErrors: [], serviceFailures: [], screenshots: [] };
    reports.push(report);
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 700, reducedMotion: "no-preference" });
    page.setDefaultTimeout(20000);
    const table = `ratiradio-qa-${width}`, key = `cosyworld.reflected-shore.v1.${table}`;
    page.on("pageerror", (error) => report.errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) report.console.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() < 400) return;
      const entry = { status: response.status(), url: response.url(), type: response.request().resourceType() };
      (/[\/]assets[\/]|[.](webp|mp3)([?]|$)/u.test(entry.url) ? report.assetErrors : report.serviceFailures).push(entry);
    });
    await page.addInitScript(({ key, save, seen }) => {
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, save);
        localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
      }
      localStorage.setItem("cosyworld.dialogue.sound", "off");
      localStorage.setItem("cosyworld.room-music", JSON.stringify({ enabled: true, volume: 0.1 }));
      window.__ratiAudio = [];
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (...args) {
        const value = play.apply(this, args);
        Promise.resolve(value).then(
          () => window.__ratiAudio.push({ ok: true, src: this.currentSrc || this.src, paused: this.paused, time: this.currentTime }),
          (error) => window.__ratiAudio.push({ ok: false, src: this.currentSrc || this.src, error: error.message }),
        );
        return value;
      };
    }, { key, save: encodeSave(start), seen: availableCards(start) });
    await page.route("**/card-game/text", (request) => {
      const input = request.request().postDataJSON();
      return request.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ revision: input.revision, model: "ratiradio-browser-qa", entries: input.entities.map(({ id }) => ({ id, text: "A quiet voice comes through the radio." })) }) });
    });
    const state = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    const card = (which) => page.locator(`#hand [data-card="${which}"]`);
    const ready = async () => {
      for (let attempt = 0; attempt < 300; attempt++) {
        if ((await page.locator("#hand").getAttribute("data-cooling")) === "false") return;
        if (await page.locator("#dialogue-advance").isVisible() && !await page.locator("#action-beat").isVisible()) await page.locator("#dialogue-advance").click();
        await page.waitForTimeout(40);
      }
      throw new Error("Dialogue kept the hand busy");
    };
    const choose = async (which) => {
      const frame = card(which).locator("..");
      const holder = await frame.getAttribute("hidden") !== null ? await frame.getAttribute("data-holder") : null;
      const target = await revealCard(page, which);
      await page.waitForFunction((id) => !document.querySelector(`#hand [data-card="${id}"]`)?.dataset.revealing, which);
      if (await target.getAttribute("aria-pressed") !== "true") await tapCard(target);
      if (holder && await card(holder).getAttribute("aria-pressed") === "true" && !await card(holder).evaluate((node) => node.classList.contains("location"))) await tapCard(card(holder));
    };
    const shot = async (name) => {
      await page.waitForFunction(() => [...document.images].filter((img) => img.getClientRects().length > 0).every((img) => img.complete && img.naturalWidth > 0));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "viewport has no horizontal overflow");
      const path = join(output, `${name}-${width}.png`);
      await page.screenshot({ path, fullPage: true });
      report.screenshots.push(path);
    };
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/?table=${table}`);
      // Start at the Dispatch Window with the Thermos in hand. Carrying it in
      // opens nothing: the Listening Room stays a locked box until the Thermos
      // is set down on the plate. Exercise the actual small Travel cue too.
      await card(home).waitFor({ state: "attached" });
      await ready();
      assert.equal(await card(home).getAttribute("data-locked"), "true");
      assert.equal((await state()).items[id("thermos")].holder, "vale");
      report.checks.push("Listening Room is a locked box while the Thermos is only carried");
      await clearSelection(page);
      await choose(id("thermos"));
      await choose(id("dispatch-window"));
      const put = (await state()).revision;
      await readyActionButton(page, "drop").click();
      await page.waitForFunction(({ key, put }) => JSON.parse(localStorage.getItem(key)).revision > put, { key, put });
      await ready();
      assert.equal((await state()).items[id("thermos")].holder, id("dispatch-window"));
      assert.equal(await card(home).getAttribute("data-locked"), "false");
      report.checks.push("Setting the Thermos down at the Dispatch Window opens the Listening Room");
      await clearSelection(page);
      await choose(home);
      const travel = readyActionButton(page, "move");
      await travel.waitFor();
      const bounds = await travel.boundingBox();
      await travel.click({ position: { x: bounds.width - 25, y: bounds.height - 8 } });
      await page.waitForFunction(({ key, home }) => JSON.parse(localStorage.getItem(key)).actors.vale.place === home, { key, home });
      report.checks.push("Tap to travel enters Listening Room from Dispatch Window");
      await card(rati).waitFor();
      await ready();
      assert.equal((await state()).actors[rati].place, home);
      assert.equal(await card(rati).getAttribute("data-locked"), "false");
      await choose(rati);
      await shot("rati-at-home");
      report.checks.push("RATi appears as a normal avatar at his Listening Room home");
      await clearSelection(page);
      await choose(raven);
      assert.equal(await card(raven).getAttribute("data-locked"), "true");
      assert.match(await page.locator(".action-beat-heading").textContent(), /^\s*Find something, and bring it to Listening Room\s*$/u);
      assert.equal(await page.locator('#card-actions [data-action="talk"], #card-actions [data-action="give"], #card-actions [data-action="threaten"]').count(), 0);
      await shot("raven-locked");
      report.checks.push("Locked Raven shows the return descriptor without interaction actions");
      for (const [kind, target] of route.slice(10)) {
        await ready();
        await clearSelection(page);
        if (kind === "talk") {
          // The Booth stays shut while the figurine is only held in the room.
          const booth = id("broadcast-booth");
          assert.equal(await card(booth).getAttribute("data-locked"), "true");
          assert.equal((await state()).packs.ratiradio.flags["booth-open"], undefined);
        }
        await choose(target);
        if (kind === "drop") await choose((await state()).actors.vale.place);
        const before = (await state()).revision;
        await readyActionButton(page, kind).click();
        await page.waitForFunction(({ key, before }) => JSON.parse(localStorage.getItem(key)).revision > before, { key, before });
        await ready();
        report.checks.push(`${kind} ${target}`);
        if (kind === "talk") {
          assert.equal((await state()).packs.ratiradio.flags["booth-open"], true);
          assert.equal(await card(id("broadcast-booth")).getAttribute("data-locked"), "false");
          report.checks.push("Talking with RATi while holding the figurine opens the Broadcast Booth");
        }
        if (kind === "move" && target === id("broadcast-booth")) {
          await page.waitForFunction(() => window.__ratiAudio.some((entry) => entry.ok && entry.src.includes("night-shift-on-ratiradio-remastered")));
          report.audio = await page.evaluate(() => window.__ratiAudio.filter((entry) => entry.src.includes("night-shift-on-ratiradio-remastered")));
          report.receipts = await page.evaluate(() => Object.keys(localStorage).filter((name) => name.startsWith("cosyworld.performance:") && name.endsWith(":ratiradio")).map((name) => [name, localStorage.getItem(name)]));
          assert.equal(report.receipts.length, 1);
          assert.equal(report.receipts[0][1], "1");
          await shot("broadcast-playing");
        }
        if (kind === "drop" && target === id("glass")) {
          assert.equal(Boolean((await state()).packs.ratiradio.flags["raven-awake"]), false);
          assert.equal(await card(raven).getAttribute("data-locked"), "true");
        }
      }
      const final = await state();
      assert.equal(final.packs.ratiradio.flags["raven-awake"], true);
      assert.equal(final.actors[raven].place, home);
      assert.equal(await card(raven).getAttribute("data-locked"), "false");
      await clearSelection(page);
      await choose(raven);
      await readyActionButton(page, "talk").waitFor();
      await shot("raven-revealed");
      report.checks.push("The third direct deposit immediately reveals a normal Raven avatar");
      assert.deepEqual(report.errors, []);
      assert.deepEqual(report.console, []);
      assert.deepEqual(report.assetErrors, []);
      report.passed = true;
    } catch (error) {
      report.passed = false;
      report.failure = error.stack;
      await page.screenshot({ path: join(output, `failure-${width}.png`), fullPage: true }).catch(() => {});
    } finally { await page.close(); }
  }
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
  await writeFile(join(output, "report.json"), JSON.stringify(reports, null, 2) + "\n");
  console.log(JSON.stringify(reports, null, 2));
}
if (reports.length !== 2 || reports.some((report) => !report.passed)) process.exitCode = 1;
